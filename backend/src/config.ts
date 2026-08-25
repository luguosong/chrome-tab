import { Hono } from 'hono'
import type { AuthEnv } from './auth'
import { BadRequest, ConflictError, touchVersion } from './common'
import type { Db } from './db'
import { CAPACITY_CELLS, ICON_TYPES, SINGLETON_TYPES, iconWire, spanOf, validateIconData } from './icons'
import { readLayout, updateLayout } from './layout'
import { pageWire } from './pages'

/**
 * 配置聚合两端点(ADR-0006):GET 一次取齐 pages/icons/layoutSettings + updatedAt;
 * PUT 全量替换——离线重连推送与导入「完全替换」共用。清空当前 user 的 icons+pages 后按
 * blob 重建、**服务端重分配全部 id**(blob 内 id 仅为客户端键);layout 非 null 则 upsert;
 * 同事务 bump config_version。排序承诺显式化:pages 按 (sortOrder,id)、icons 按
 * (pageId,sortOrder,id) 升序。
 */

/** 聚合读取装配(GET 与 PUT 回读共用,避免两处拼装漂移;等价 Java ConfigAssembler)。 */
export async function readConfig(db: Db, userId: number) {
  const [pages, icons, layoutSettings, version] = await Promise.all([
    db
      .selectFrom('pages')
      .select(['id', 'name', 'sort_order'])
      .where('user_id', '=', userId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute(),
    db
      .selectFrom('icons')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('page_id', 'asc')
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .execute(),
    readLayout(db, userId),
    db.selectFrom('config_version').select('updated_at').where('user_id', '=', userId).executeTakeFirst(),
  ])
  return {
    pages: pages.map(pageWire),
    icons: icons.map(iconWire),
    layoutSettings,
    updatedAt: version?.updated_at ?? null,
  }
}

export function configRoutes(db: Db) {
  return new Hono<AuthEnv>()
    .get('/api/config', async (c) => c.json(await readConfig(db, c.get('user')!.id)))
    .put('/api/config', async (c) => {
      const userId = c.get('user')!.id
      const body = await c.req.json().catch(() => null)
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new BadRequest('请求体必须是配置对象')
      }
      const req = parseReplaceRequest(body as Record<string, unknown>)
      validate(req)
      await db.transaction().execute(async (tx) => {
        // 1. 全清当前 user 的 icons + pages。parent FK 是 RESTRICT(ADR-0011),
        //    必须先删成员行、再删顶层行(单条全删语句会撞 FK 500)。
        const old = await tx.selectFrom('icons').select(['id', 'parent_id']).where('user_id', '=', userId).execute()
        for (const side of [true, false]) {
          const ids = old.filter((i) => (i.parent_id !== null) === side).map((i) => i.id)
          if (ids.length) await tx.deleteFrom('icons').where('id', 'in', ids).execute()
        }
        await tx.deleteFrom('pages').where('user_id', '=', userId).execute()
        // 2. 重建 pages,建立 clientPageId → 新 DB id 映射
        const pageIdMap = new Map<number, number>()
        const now = new Date().toISOString()
        for (const p of req.pages) {
          const { id } = await tx
            .insertInto('pages')
            .values({ user_id: userId, name: p.name, sort_order: p.sortOrder, created_at: now })
            .returning('id')
            .executeTakeFirstOrThrow()
          pageIdMap.set(p.id, id)
        }
        // 3. 重建 icons:先顶层行(建 clientIconId → 新 DB id 映射),再成员行(经两个 map
        //    重定向;组行先落库,成员的 parent FK 才有目标可指)
        const iconIdMap = new Map<number, number>()
        // 先顶层(false:parentId 为 null)再成员(true)——成员插入时组行映射已就绪
        for (const pass of [false, true]) {
          for (const ii of req.icons.filter((i) => (i.parentId !== null) === pass)) {
            const { id } = await tx
              .insertInto('icons')
              .values({
                user_id: userId,
                page_id: pageIdMap.get(ii.pageId)!,
                parent_id: ii.parentId === null ? null : iconIdMap.get(ii.parentId)!,
                type: ii.type,
                sort_order: ii.sortOrder,
                data: ii.data === null ? null : JSON.stringify(ii.data),
                created_at: now,
              })
              .returning('id')
              .executeTakeFirstOrThrow()
            iconIdMap.set(ii.id, id)
          }
        }
        // 4. layout 可选:null/缺省则保留现有行
        if (req.layoutSettings !== null && req.layoutSettings !== undefined) {
          await updateLayout(tx, userId, req.layoutSettings)
        }
        // 5. bump 版本(写事务末尾,回滚则不前进)
        await touchVersion(tx, userId)
      })
      return c.json(await readConfig(db, userId))
    })
}

// ── 请求解析(结构校验 → 400)────────────────────────────────────────────────

interface PageItem {
  id: number
  name: string
  sortOrder: number
}
interface IconItem {
  id: number
  pageId: number
  parentId: number | null
  type: (typeof ICON_TYPES)[number]
  sortOrder: number
  data: Record<string, unknown> | null
}

function parseReplaceRequest(body: Record<string, unknown>): {
  pages: PageItem[]
  icons: IconItem[]
  layoutSettings: Record<string, unknown> | null | undefined
} {
  if (!Array.isArray(body.pages) || body.pages.length < 1) {
    throw new BadRequest('pages: 不能为空')
  }
  if (!Array.isArray(body.icons)) throw new BadRequest('icons: must not be null')
  return {
    pages: body.pages.map((raw, idx) => {
      const p = (raw ?? {}) as Record<string, unknown>
      if (typeof p.id !== 'number' || !Number.isInteger(p.id)) throw new BadRequest(`pages[${idx}].id: must not be null`)
      if (typeof p.name !== 'string' || !p.name.trim()) throw new BadRequest(`pages[${idx}].name: must not be blank`)
      if (p.name.length > 64) throw new BadRequest(`pages[${idx}].name: size must be between 0 and 64`)
      if (typeof p.sortOrder !== 'number' || !Number.isInteger(p.sortOrder)) {
        throw new BadRequest(`pages[${idx}].sortOrder: must not be null`)
      }
      return { id: p.id, name: p.name, sortOrder: p.sortOrder }
    }),
    icons: body.icons.map((raw, idx) => {
      const i = (raw ?? {}) as Record<string, unknown>
      if (typeof i.id !== 'number' || !Number.isInteger(i.id)) throw new BadRequest(`icons[${idx}].id: must not be null`)
      if (typeof i.pageId !== 'number' || !Number.isInteger(i.pageId)) {
        throw new BadRequest(`icons[${idx}].pageId: must not be null`)
      }
      if (i.parentId !== undefined && i.parentId !== null && (typeof i.parentId !== 'number' || !Number.isInteger(i.parentId))) {
        throw new BadRequest(`icons[${idx}].parentId: 必须是整数`)
      }
      if (typeof i.type !== 'string' || !(ICON_TYPES as readonly string[]).includes(i.type)) {
        throw new BadRequest(`icons[${idx}].type: 非法的图标类型`)
      }
      if (typeof i.sortOrder !== 'number' || !Number.isInteger(i.sortOrder)) {
        throw new BadRequest(`icons[${idx}].sortOrder: must not be null`)
      }
      if (i.data !== undefined && i.data !== null && (typeof i.data !== 'object' || Array.isArray(i.data))) {
        throw new BadRequest(`icons[${idx}].data: 必须是对象`)
      }
      validateIconData(i.data as Record<string, unknown> | null | undefined)
      return {
        id: i.id,
        pageId: i.pageId,
        parentId: (i.parentId ?? null) as number | null,
        type: i.type as IconItem['type'],
        sortOrder: i.sortOrder,
        data: (i.data ?? null) as Record<string, unknown> | null,
      }
    }),
    layoutSettings:
      body.layoutSettings === undefined || body.layoutSettings === null
        ? null
        : ((typeof body.layoutSettings === 'object' && !Array.isArray(body.layoutSettings))
            ? (body.layoutSettings as Record<string, unknown>)
            : (() => {
                throw new BadRequest('layoutSettings: 必须是对象或 null')
              })()),
  }
}

/** 业务校验(→ 409,消息逐字照 Java):孤儿引用 / 每页容量(只计顶层) / 分组关系。 */
function validate(req: { pages: PageItem[]; icons: IconItem[] }): void {
  const pageIds = new Set(req.pages.map((p) => p.id))
  const cellsByPage = new Map<number, number>()
  const byId = new Map<number, IconItem>()
  const groupsWithMember = new Set<number>()
  const singletonSeen = new Set<string>()
  req.icons.forEach((i, idx) => {
    if (byId.has(i.id)) throw new ConflictError(409, `icons[${idx}] 的 id 重复:${i.id}`)
    byId.set(i.id, i)
    if (SINGLETON_TYPES.includes(i.type)) {
      if (singletonSeen.has(i.type)) {
        throw new ConflictError(409, `icons[${idx}] 单例类型 ${i.type} 出现多次，全局仅一个实例`)
      }
      singletonSeen.add(i.type)
    }
  })
  req.icons.forEach((i, idx) => {
    if (!pageIds.has(i.pageId)) throw new ConflictError(409, `icons[${idx}] 引用了不存在的页面:${i.pageId}`)
    if (i.parentId !== null) {
      const parent = byId.get(i.parentId)
      if (!parent) throw new ConflictError(409, `icons[${idx}] 引用了不存在的分组:${i.parentId}`)
      if (parent.type !== 'GROUP') throw new ConflictError(409, `icons[${idx}] 的 parentId 指向的不是分组`)
      if (parent.parentId !== null) throw new ConflictError(409, '分组不能嵌套(组行自身带 parentId)')
      if (i.type !== 'NAV') throw new ConflictError(409, `icons[${idx}] 只有网站链接可以作为分组成员`)
      if (i.pageId !== parent.pageId) throw new ConflictError(409, `icons[${idx}] 分组成员必须与分组同页`)
      groupsWithMember.add(i.parentId)
    } else {
      // 容量只计顶层行:组内成员不计(ADR-0011);跨格类型按 w×h 计(ADR-0021)
      const used = (cellsByPage.get(i.pageId) ?? 0) + spanOf(i.type)
      cellsByPage.set(i.pageId, used)
      if (used > CAPACITY_CELLS) throw new ConflictError(409, `页面(blob 内 ${i.pageId})容量超过 ${CAPACITY_CELLS} 格`)
    }
    // CHANGELOG 已非单例(ADR-0020):每实例绑一个外源,可多行
  })
  // 空组不存活:每个组行至少 1 个成员
  for (const [id, i] of byId) {
    if (i.type === 'GROUP' && !groupsWithMember.has(id)) {
      throw new ConflictError(409, `分组(blob 内 ${id})没有成员,空组不被接受`)
    }
  }
}
