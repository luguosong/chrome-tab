import { Hono } from 'hono'
import type { AuthEnv } from './auth'
import { BadRequest, ConflictError, jsonBody, numericParam, reqInt, reqName, touchVersion } from './common'
import type { Db } from './db'

/**
 * Page 写操作四端点(api-contract §4)。页面是一等公民:增/改名/重排/删。
 * 修正白名单②:建成功 201(Java 是 200);DELETE 维持 204。
 * ⑤:reorder 按新序(sortOrder,id)返回。任意写事务末尾 bump config_version(ADR-0006)。
 */
export function pageRoutes(db: Db) {
  return new Hono<AuthEnv>()
    .post('/api/pages', async (c) => {
      const name = reqName(await jsonBody(c))
      const userId = c.get('user')!.id
      return await db.transaction().execute(async (tx) => {
        const pages = await tx
          .selectFrom('pages')
          .select(['id', 'sort_order'])
          .where('user_id', '=', userId)
          .orderBy('sort_order', 'asc')
          .orderBy('id', 'asc')
          .execute()
        const nextOrder = pages.length ? pages[pages.length - 1]!.sort_order + 1 : 0
        const saved = await tx
          .insertInto('pages')
          .values({ user_id: userId, name, sort_order: nextOrder, created_at: new Date().toISOString() })
          .returning(['id', 'name', 'sort_order'])
          .executeTakeFirstOrThrow()
        await touchVersion(tx, userId)
        return c.json(pageWire(saved), 201)
      })
    })
    .patch('/api/pages/reorder', async (c) => {
      const items = await parseReorderItems(c)
      const userId = c.get('user')!.id
      const saved = await db.transaction().execute(async (tx) => {
        const pages = await tx
          .selectFrom('pages')
          .selectAll()
          .where('user_id', '=', userId)
          .orderBy('sort_order', 'asc')
          .orderBy('id', 'asc')
          .execute()
        // 重复 id 首个生效(对齐 Java findFirst 语义)
        const byId = new Map<number, number>()
        for (const it of items) if (!byId.has(it.id)) byId.set(it.id, it.sortOrder)
        for (const p of pages) {
          const so = byId.get(p.id)
          if (so !== undefined && so !== p.sort_order) {
            await tx.updateTable('pages').set({ sort_order: so }).where('id', '=', p.id).execute()
            p.sort_order = so
          }
        }
        await touchVersion(tx, userId)
        // 修正白名单⑤:按更新后的 (sortOrder, id) 序返回(Java 按读库旧序)
        return [...pages].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      })
      return c.json(saved.map(pageWire))
    })
    .put('/api/pages/:id', async (c) => {
      const name = reqName(await jsonBody(c))
      const id = numericParam(c, 'id')
      const userId = c.get('user')!.id
      return await db.transaction().execute(async (tx) => {
        const saved = await tx
          .updateTable('pages')
          .set({ name })
          .where('id', '=', id)
          .where('user_id', '=', userId)
          .returning(['id', 'name', 'sort_order'])
          .executeTakeFirstOrThrow(() => new ConflictError(404, '页面不存在'))
        await touchVersion(tx, userId)
        return c.json(pageWire(saved))
      })
    })
    .delete('/api/pages/:id', async (c) => {
      const id = numericParam(c, 'id')
      const userId = c.get('user')!.id
      await db.transaction().execute(async (tx) => {
        const page = await tx
          .selectFrom('pages')
          .select('id')
          .where('id', '=', id)
          .where('user_id', '=', userId)
          .executeTakeFirstOrThrow(() => new ConflictError(404, '页面不存在'))
        const hasIcons = await tx
          .selectFrom('icons')
          .select('id')
          .where('page_id', '=', page.id)
          .limit(1)
          .executeTakeFirst()
        if (hasIcons) throw new ConflictError(409, '该页非空，请先移动或删除页内图标')
        await tx.deleteFrom('pages').where('id', '=', page.id).execute()
        await touchVersion(tx, userId)
      })
      return c.body(null, 204)
    })
}

/** Page 出参 wire(camelCase),对齐 Java PageResponse(config 聚合复用)。 */
export const pageWire = (p: { id: number; name: string; sort_order: number }) => ({
  id: p.id,
  name: p.name,
  sortOrder: p.sort_order,
})

/** reorder 请求体:[{id, sortOrder}](sortOrder 缺省 0,对齐 Java int 原始类型)。 */
async function parseReorderItems(c: { req: { json(): Promise<unknown> } }): Promise<Array<{ id: number; sortOrder: number }>> {
  const body = await jsonBody(c)
  if (!Array.isArray(body)) throw new BadRequest('请求体必须是 [{id, sortOrder}] 数组')
  return body.map((raw, idx) => {
    const it = (raw ?? {}) as Record<string, unknown>
    const id = reqInt(it, 'id', { prefix: `items[${idx}]` })
    // sortOrder 不套 optInt:null 在此端点必须 400(显式置 null 是协议错),optInt 会静默落 0——两语义刻意分家(ADR-0048)
    const so = it.sortOrder === undefined ? 0 : it.sortOrder
    if (typeof so !== 'number' || !Number.isInteger(so)) {
      throw new BadRequest(`items[${idx}].sortOrder: 必须是整数`)
    }
    return { id, sortOrder: so }
  })
}
