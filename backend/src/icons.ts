import { Hono, type Context } from 'hono'
import type { AuthEnv } from './auth'
import { BadRequest, ConflictError, numericParam, touchVersion } from './common'
import type { Db } from './db'

/**
 * Icon 写操作六端点(api-contract §5,ADR-0011/0016)。核心约束:
 * - 页面容量 = 每页顶层行数 ≤ 64(组行占 1 格、组内成员不计);
 * - 组行只能经 merge 创建、空组不存活;CHANGELOG 已非单例(ADR-0020,每实例绑一个外源);
 * - 排序无空洞(0..n-1);所有读写按 userId 隔离;任意写事务末尾 bump config_version。
 * 修正白名单②:POST/merge 建成功 201;④:move 入组分支尊重 toIndex 并夹紧;⑥:PATCH /{id} 补参数校验。
 */

/** 页面容量 = 每页顶层格数上限(ADR-0002/0016;config 全量替换校验复用)。 */
export const CAPACITY_CELLS = 64
/** icon type 大写枚举 wire(config 全量替换校验复用)。 */
export const ICON_TYPES = ['NAV', 'STOCK', 'CHANGELOG', 'WEATHER', 'AIHOT', 'GROUP'] as const
type IconType = (typeof ICON_TYPES)[number]

/** 单例类型(见 CONTEXT.md「单例类型」):全局仅一个实例,新增/全量替换两入口同校验。 */
export const SINGLETON_TYPES: readonly IconType[] = ['AIHOT']

type IconRow = {
  id: number
  user_id: number
  page_id: number
  parent_id: number | null
  type: string
  sort_order: number
  data: string | null
  created_at: string
}

/** Icon 出参 wire(camelCase,data 反序列化回对象),对齐 Java IconResponse。 */
export const iconWire = (r: IconRow) => ({
  id: r.id,
  pageId: r.page_id,
  parentId: r.parent_id,
  type: r.type,
  sortOrder: r.sort_order,
  data: r.data === null ? null : (JSON.parse(r.data) as Record<string, unknown>),
})

export function iconRoutes(db: Db) {
  return new Hono<AuthEnv>()
    .post('/api/icons', async (c) => {
      const userId = c.get('user')!.id
      const body = (await readJson(c)) as Record<string, unknown>
      const pageId = requireInt(body, 'pageId')
      const type = requireType(body)
      requireDataField(body)
      return await db.transaction().execute(async (tx) => {
        if (type === 'GROUP') throw new ConflictError(409, '分组需经合并创建，不能直接新建')
        if (SINGLETON_TYPES.includes(type)) await rejectExistingSingleton(tx, userId, type)
        const page = await tx
          .selectFrom('pages')
          .select('id')
          .where('id', '=', pageId)
          .where('user_id', '=', userId)
          .executeTakeFirstOrThrow(() => new ConflictError(404, '页面不存在'))
        await requireCapacity(tx, userId, page.id, 1, '页面')
        const siblings = await topLevel(tx, userId, page.id)
        const saved = await tx
          .insertInto('icons')
          .values({
            user_id: userId,
            page_id: page.id,
            parent_id: null,
            type,
            sort_order: siblings.length ? siblings[siblings.length - 1]!.sort_order + 1 : 0,
            data: dataToJson(body.data),
            created_at: new Date().toISOString(),
          })
          .returningAll()
          .executeTakeFirstOrThrow()
        await touchVersion(tx, userId)
        return c.json(iconWire(saved), 201)
      })
    })
    // 字面子路径,先于 PATCH /:id 匹配
    .patch('/api/icons/move', async (c) => {
      const userId = c.get('user')!.id
      const body = (await readJson(c)) as Record<string, unknown>
      const req = {
        id: requireInt(body, 'id'),
        toPageId: requireInt(body, 'toPageId'),
        toIndex: optInt(body, 'toIndex'),
        parentId: optNullableInt(body, 'parentId'),
      }
      return await db.transaction().execute(async (tx) => {
        const saved = await move(tx, userId, req)
        await touchVersion(tx, userId)
        return c.json(iconWire(saved))
      })
    })
    // 字面子路径,先于 POST /:id/dissolve 之外的动态路由匹配
    .post('/api/icons/merge', async (c) => {
      const userId = c.get('user')!.id
      const body = (await readJson(c)) as Record<string, unknown>
      const pageId = requireInt(body, 'pageId')
      if (!Array.isArray(body.memberIds)) throw new BadRequest('memberIds: must not be null')
      const memberIds = body.memberIds.map((v, idx) => {
        if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`memberIds[${idx}]: 必须是整数`)
        return v
      })
      return await db.transaction().execute(async (tx) => {
        const saved = await merge(tx, userId, { pageId, memberIds })
        await touchVersion(tx, userId)
        return c.json(iconWire(saved), 201)
      })
    })
    .post('/api/icons/:id/dissolve', async (c) => {
      const userId = c.get('user')!.id
      const id = numericParam(c, 'id')
      await db.transaction().execute(async (tx) => {
        const group = await findIcon(tx, userId, id, '分组不存在')
        if (group.type !== 'GROUP') throw new ConflictError(409, '该图标不是分组')
        const members = await membersOf(tx, userId, group.id)
        // 组行自身让出 1 格;成员落回顶层各占 1 格
        if ((await topLevel(tx, userId, group.page_id)).length - 1 + members.length > CAPACITY_CELLS) {
          throw new ConflictError(409, '页面容量不足，请先移出部分图标后再解散')
        }
        // 成员自组行 sort_order 位置起按组内序洒回本页顶层(在含组行的旧序列里展开)
        const seq: Array<{ id: number }> = []
        for (const i of await topLevel(tx, userId, group.page_id)) {
          if (i.id === group.id) seq.push(...members)
          else seq.push(i)
        }
        // 先解除成员引用再删组行(FK RESTRICT:顺序颠倒会 500)
        await tx.updateTable('icons').set({ parent_id: null }).where('parent_id', '=', group.id).execute()
        await tx.deleteFrom('icons').where('id', '=', group.id).execute()
        await renumber(tx, seq)
        await touchVersion(tx, userId)
      })
      return c.body(null, 200)
    })
    .patch('/api/icons/:id', async (c) => {
      const userId = c.get('user')!.id
      const id = numericParam(c, 'id')
      // 修正白名单⑥:补参数校验(对齐其他写端点的 400 行为;Java 侧唯一无校验的写端点)
      const body = await readJson(c)
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new BadRequest('请求体必须是 {data: object|null} 对象')
      }
      requireDataField(body as Record<string, unknown>)
      return await db.transaction().execute(async (tx) => {
        const icon = await findIcon(tx, userId, id, '图标不存在')
        // data 仅在提供时覆盖(部分更新;null 表示不动)
        const data = (body as Record<string, unknown>).data
        if (data !== undefined && data !== null) {
          await tx
            .updateTable('icons')
            .set({ data: JSON.stringify(data) })
            .where('id', '=', icon.id)
            .execute()
        }
        const saved = await tx.selectFrom('icons').selectAll().where('id', '=', icon.id).executeTakeFirstOrThrow()
        await touchVersion(tx, userId)
        return c.json(iconWire(saved))
      })
    })
    .delete('/api/icons/:id', async (c) => {
      const userId = c.get('user')!.id
      const id = numericParam(c, 'id')
      await db.transaction().execute(async (tx) => {
        const icon = await findIcon(tx, userId, id, '图标不存在')
        if (icon.type === 'GROUP') {
          const members = await membersOf(tx, userId, icon.id)
          if (members.length) throw new ConflictError(409, '分组内还有图标，请先解散分组')
          const pageId = icon.page_id
          await tx.deleteFrom('icons').where('id', '=', icon.id).execute()
          await renumber(tx, await topLevel(tx, userId, pageId))
        } else if (icon.parent_id !== null) {
          // 删成员:组内补洞;组因此变空 → 空组不存活,连带删组行(子行先删,父行后删)
          const groupId = icon.parent_id
          await tx.deleteFrom('icons').where('id', '=', icon.id).execute()
          const rest = await membersOf(tx, userId, groupId)
          if (!rest.length) {
            const group = await tx.selectFrom('icons').selectAll().where('id', '=', groupId).executeTakeFirst()
            if (group) {
              await tx.deleteFrom('icons').where('id', '=', group.id).execute()
              await renumber(tx, await topLevel(tx, userId, group.page_id))
            }
          } else {
            await renumber(tx, rest)
          }
        } else {
          const pageId = icon.page_id
          await tx.deleteFrom('icons').where('id', '=', icon.id).execute()
          await renumber(tx, await topLevel(tx, userId, pageId))
        }
        await touchVersion(tx, userId)
      })
      return c.body(null, 204)
    })
}

// ── move / merge 业务实现(照搬 Java IconService,分支注释同源)─────────────────

/**
 * 移动/重排(同页与跨页统一),三分支(ADR-0011):
 * 组行自身 / 入组·组内重排 / 落页面顶层。修正白名单④:入组(新进组)也按 toIndex
 * 插入并夹紧(Java 恒落组内末尾);组内重排语义不变。
 */
async function move(
  tx: Db,
  userId: number,
  req: { id: number; toPageId: number; toIndex: number; parentId: number | null },
): Promise<IconRow> {
  const icon = await findIcon(tx, userId, req.id, '图标不存在')

  // ── 分支一:组行自身移动(不可入组:无嵌套)──
  if (icon.type === 'GROUP') {
    if (req.parentId !== null) throw new ConflictError(409, '分组不能嵌套入组')
    const target = await requirePage(tx, userId, req.toPageId)
    const crossPage = icon.page_id !== target.id
    if (crossPage) await requireCapacity(tx, userId, target.id, 1, '目标页面')
    const fromPageId = icon.page_id
    const seq = (await topLevel(tx, userId, target.id)).filter((i) => i.id !== icon.id)
    seq.splice(clamp(req.toIndex, seq.length), 0, icon)
    await renumber(tx, seq)
    await tx.updateTable('icons').set({ page_id: target.id }).where('id', '=', icon.id).execute()
    if (crossPage) {
      await renumber(tx, await topLevel(tx, userId, fromPageId))
      // 组跨页:事务内同步成员行 page_id(成员不计目标页容量,组内 sortOrder 保留)
      await tx.updateTable('icons').set({ page_id: target.id }).where('parent_id', '=', icon.id).execute()
    }
    return (await reload(tx, icon.id))!
  }

  // ── 分支二:入组 / 组内重排 ──
  if (req.parentId !== null) {
    if (icon.type !== 'NAV') throw new ConflictError(409, '只有网站链接图标可加入分组')
    const group = await findIcon(tx, userId, req.parentId, '目标分组不存在')
    if (group.type !== 'GROUP') throw new ConflictError(409, 'parentId 指向的不是分组')
    const alreadyInside = req.parentId === icon.parent_id
    if (!alreadyInside) {
      // 离开原位置:原组(移出,空则删组行)或原页顶层序列(补洞)
      if (icon.parent_id !== null) {
        await removeFromGroup(tx, userId, icon)
      } else {
        await renumber(tx, (await topLevel(tx, userId, icon.page_id)).filter((i) => i.id !== icon.id))
      }
    }
    const seq = (await membersOf(tx, userId, group.id)).filter((i) => i.id !== icon.id)
    // 修正白名单④:入组与组内重排统一按 toIndex 夹紧插入
    seq.splice(clamp(req.toIndex, seq.length), 0, icon)
    await renumber(tx, seq)
    await tx
      .updateTable('icons')
      .set({ page_id: group.page_id, parent_id: group.id })
      .where('id', '=', icon.id)
      .execute()
    return (await reload(tx, icon.id))!
  }

  // ── 分支三:落页面序列(顶层)──
  const target = await requirePage(tx, userId, req.toPageId)
  const wasInGroup = icon.parent_id !== null
  const crossPage = icon.page_id !== target.id
  // 同页顶层纯重排不校验容量(占用不变);跨页、或从组内移出(开始占格)才校验
  if (crossPage || wasInGroup) {
    let needed = 1
    if (wasInGroup && !crossPage) {
      // 同页移出且源组因此变空:组行让出 1 格,净占 0(对齐 dissolve 的 -1)
      if ((await membersOf(tx, userId, icon.parent_id!)).length === 1) needed -= 1
    }
    await requireCapacity(tx, userId, target.id, needed, '目标页面')
  }
  if (wasInGroup) await removeFromGroup(tx, userId, icon)
  const fromPageId = icon.page_id
  const seq = (await topLevel(tx, userId, target.id)).filter((i) => i.id !== icon.id)
  seq.splice(clamp(req.toIndex, seq.length), 0, icon)
  await renumber(tx, seq)
  await tx.updateTable('icons').set({ page_id: target.id, parent_id: null }).where('id', '=', icon.id).execute()
  if (crossPage && !wasInGroup) {
    // 组内成员的源「页」顶层序列本就不含它,无需补洞
    await renumber(tx, await topLevel(tx, userId, fromPageId))
  }
  return (await reload(tx, icon.id))!
}

/**
 * 建组(ADR-0011)。memberIds 有序:首位 = 被拖图标 A、末位 = 悬停目标 B。
 * 建组行(type=GROUP,data={"name":"新建分组"},继承 B 的 sort_order)+ 成员挂 parent_id
 * (组内序 0..n-1 按 memberIds 序)+ 页面序列在 B 原位换成组行、其余成员位置消失重排。
 */
async function merge(tx: Db, userId: number, req: { pageId: number; memberIds: number[] }): Promise<IconRow> {
  const page = await tx
    .selectFrom('pages')
    .select('id')
    .where('id', '=', req.pageId)
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow(() => new ConflictError(404, '页面不存在'))
  if (req.memberIds.length < 2) throw new ConflictError(409, '合并成分组至少需要 2 个图标')
  if (new Set(req.memberIds).size !== req.memberIds.length) throw new ConflictError(409, '成员存在重复')

  const topLevelRows = await topLevel(tx, userId, page.id)
  const topById = new Map(topLevelRows.map((i) => [i.id, i]))
  const members: IconRow[] = []
  for (const mid of req.memberIds) {
    const m = topById.get(mid)
    // 覆盖三种违例:不在本页(跨页/不存在)、组行、已入组图标(不在顶层集内)
    if (!m || m.type !== 'NAV') {
      throw new ConflictError(409, '成员必须都是本页顶层的网站链接图标')
    }
    members.push(m)
  }

  const group = await tx
    .insertInto('icons')
    .values({
      user_id: userId,
      page_id: page.id,
      parent_id: null,
      type: 'GROUP',
      sort_order: 0,
      data: JSON.stringify({ name: '新建分组' }),
      created_at: new Date().toISOString(),
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  // 组行继承末位成员(悬停目标 B)的 sort_order:在序列里 B 的位置放组、其余成员位置消失
  const lastId = req.memberIds[req.memberIds.length - 1]!
  const seq: Array<{ id: number; sort_order: number }> = []
  for (const i of topLevelRows) {
    if (req.memberIds.includes(i.id)) {
      if (i.id === lastId) seq.push(group)
    } else {
      seq.push(i)
    }
  }
  await renumber(tx, seq)
  for (let k = 0; k < members.length; k++) {
    await tx
      .updateTable('icons')
      .set({ parent_id: group.id, sort_order: k })
      .where('id', '=', members[k]!.id)
      .execute()
  }
  // renumber 已把组行落到末位成员位置;回读携带最终 sort_order
  return (await reload(tx, group.id))!
}

/**
 * 把 icon 移出其所属组:组内补洞重排;组因此变空则删组行(空组不存活)。
 * ponytail: Java 在删空组行后不重排页面序列,留下排序洞;此处补上 renumber
 * (票据验收:move 后排序无空洞),若 Java 行为有消费者再对齐。
 */
async function removeFromGroup(tx: Db, userId: number, icon: IconRow): Promise<void> {
  const rest = (await membersOf(tx, userId, icon.parent_id!)).filter((m) => m.id !== icon.id)
  if (!rest.length) {
    // 先解除子行引用(防 FK RESTRICT),再删空组行 + 重排页面顶层补洞
    await tx.updateTable('icons').set({ parent_id: null }).where('id', '=', icon.id).execute()
    const group = await tx.selectFrom('icons').selectAll().where('id', '=', icon.parent_id!).executeTakeFirst()
    if (group) {
      await tx.deleteFrom('icons').where('id', '=', group.id).execute()
      await renumber(tx, await topLevel(tx, userId, group.page_id))
    }
  } else {
    await renumber(tx, rest)
  }
}

// ── 查询/校验小件 ─────────────────────────────────────────────────────────────

/** 页面顶层序列(parent_id IS NULL,按 sort_order,id 升序)。 */
function topLevel(tx: Db, userId: number, pageId: number) {
  return tx
    .selectFrom('icons')
    .selectAll()
    .where('user_id', '=', userId)
    .where('page_id', '=', pageId)
    .where('parent_id', 'is', null)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute()
}

/** 组内成员(同 parent_id,按 sort_order,id 升序)。 */
function membersOf(tx: Db, userId: number, groupId: number) {
  return tx
    .selectFrom('icons')
    .selectAll()
    .where('user_id', '=', userId)
    .where('parent_id', '=', groupId)
    .orderBy('sort_order', 'asc')
    .orderBy('id', 'asc')
    .execute()
}

async function findIcon(tx: Db, userId: number, id: number, notFoundMsg: string): Promise<IconRow> {
  return tx
    .selectFrom('icons')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow(() => new ConflictError(404, notFoundMsg))
}

/** 单例类型已存在实例 → 409(前端抽屉已置灰,此为竞态兜底)。 */
async function rejectExistingSingleton(
  tx: Db,
  userId: number,
  type: IconType,
): Promise<void> {
  const dup = await tx
    .selectFrom('icons')
    .select('id')
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .limit(1)
    .executeTakeFirst()
  if (dup) throw new ConflictError(409, '该类型图标已存在，单例类型全局仅可添加一个')
}

async function requirePage(tx: Db, userId: number, pageId: number): Promise<{ id: number }> {
  return tx
    .selectFrom('pages')
    .select('id')
    .where('id', '=', pageId)
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow(() => new ConflictError(404, '目标页面不存在'))
}

/** 容量校验:已用格子 + needed > 64 → 409,message 带剩余格数;subject 为消息前缀。 */
async function requireCapacity(
  tx: Db,
  userId: number,
  pageId: number,
  needed: number,
  subject: '页面' | '目标页面',
): Promise<void> {
  const remaining = CAPACITY_CELLS - (await topLevel(tx, userId, pageId)).length
  if (needed > remaining) throw new ConflictError(409, `${subject}容量不足，剩余 ${remaining} 格`)
}

/** 按列表顺序重排 sortOrder 为 0..n-1。 */
async function renumber(tx: Db, rows: ReadonlyArray<{ id: number }>): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    await tx.updateTable('icons').set({ sort_order: i }).where('id', '=', rows[i]!.id).execute()
  }
}

async function reload(tx: Db, id: number): Promise<IconRow | undefined> {
  return tx.selectFrom('icons').selectAll().where('id', '=', id).executeTakeFirst()
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max))

// ── 请求体小件(400 校验)────────────────────────────────────────────────────

async function readJson(c: Context<AuthEnv>): Promise<unknown> {
  return c.req.json().catch(() => null)
}

function requireInt(body: Record<string, unknown>, key: string): number {
  const v = body[key]
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`${key}: must not be null`)
  return v
}

function optInt(body: Record<string, unknown>, key: string): number {
  // 缺省或显式 null 都落 0(对齐 Java int 原始类型的 Jackson 默认)
  const v = body[key] === undefined || body[key] === null ? 0 : body[key]
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`${key}: 必须是整数`)
  return v
}

function optNullableInt(body: Record<string, unknown>, key: string): number | null {
  const v = body[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new BadRequest(`${key}: 必须是整数`)
  return v
}

function requireType(body: Record<string, unknown>): IconType {
  const v = body.type
  if (typeof v !== 'string' || !(ICON_TYPES as readonly string[]).includes(v)) {
    throw new BadRequest('type: 非法的图标类型')
  }
  return v as IconType
}

/** data 字段存在时必须是 object|null(其余端点同形校验)。 */
function requireDataField(body: Record<string, unknown>): void {
  const v = body.data
  if (v !== undefined && v !== null && (typeof v !== 'object' || Array.isArray(v))) {
    throw new BadRequest('data: 必须是对象')
  }
}

const dataToJson = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))
