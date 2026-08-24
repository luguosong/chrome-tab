import { Hono } from 'hono'
import { asRec, BadRequest, ConflictError, str, type Rec } from './common'

/**
 * 滴答清单待办代理(CONTEXT.md「待办」):单例图标的取数与写回——首个可写图标类型。
 * 认证 = API 口令(滴答网页版「设置→账户与安全→API 口令」生成,Authorization: Bearer),
 * env 注入不入前端(同「天气」范式,ADR-0009)。
 *
 * 读 = POST /open/v1/task/search(status=[0] 未完成,dueTo=今晚 23:59:59+08:00):
 *   「今日待办」= 今日到期 + 过期;无日期任务不在列(速记落收集箱,归期整理在滴答侧)。
 * 写 = POST /open/v1/task(速记:仅 title,不指定清单即落收集箱)
 *   + POST /open/v1/project/{projectId}/task/{taskId}/complete(点掉即完成)。
 * 读缓存 = 内存单键 TTL 60s + lastGood 降级(宁旧勿空,从未成功 null,同 aihot);
 * 写直通并清读缓存(自己勾掉/速记的下一次读即见)。并发不去重(单例 + react-query 已去重)。
 * 未配置口令 → 400 透出提示(区别于上游失败的 502,前端可区分「去生成口令」与「稍后重试」)。
 */

const TTL_MS = 60_000
const DEFAULT_BASE = 'https://api.dida365.com'

// ── wire DTO(裁剪为前端消费的字段子集;防御式读取,脏条目跳过)──────────────────

export interface TodoTaskDto {
  id: string
  projectId: string
  title: string
  /** 0 无 1 低 3 中 5 高(滴答原值)。 */
  priority: number
  /** 到期时间(ISO),今日+过期口径下必有;null 兜底排尾。 */
  dueDate: string | null
}

/** UTC+8 的今晚 23:59:59(服务器时区无关)——「今日待办」窗口右端,过期任务全含。纯函数可直测。 */
export function endOfTodayPlus8(now = new Date()): string {
  const t = new Date(now.getTime() + 8 * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T23:59:59+08:00`
}

/** 解析 search 响应:非数组抛;条目缺 id/title 跳过;按到期升序(最紧迫在前,null 排尾)。 */
export function parseTodoTasks(resp: unknown): TodoTaskDto[] {
  if (!Array.isArray(resp)) throw new Error('滴答 search 响应缺任务数组')
  const out: TodoTaskDto[] = []
  for (const o of resp) {
    const m = asRec(o)
    const id = str(m, 'id')
    const title = str(m, 'title')
    if (!m || !id || !title) continue
    out.push({
      id,
      projectId: str(m, 'projectId') ?? '',
      title,
      priority: typeof m['priority'] === 'number' ? m['priority'] : 0,
      dueDate: str(m, 'dueDate'),
    })
  }
  const due = (t: TodoTaskDto) => t.dueDate ?? '9999'
  out.sort((a, b) => due(a).localeCompare(due(b)))
  return out
}

// ── 服务(HTTP + 缓存)──────────────────────────────────────────────────────────

export type DidaConfig = { token: string }

export function createDidaService(cfg: DidaConfig, baseUrl = DEFAULT_BASE) {
  const { token } = cfg
  let cached: { at: number; data: TodoTaskDto[] } | null = null
  let lastGood: TodoTaskDto[] | null = null

  function requireConfigured() {
    if (!token.trim()) throw new BadRequest('滴答清单未配置(DIDA365_TOKEN 缺失)')
  }

  /** 非 2xx → 502 透上游状态(读侧被 catch 降级,写侧直达 app.onError)。 */
  async function postJson(path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new ConflictError(502, `滴答上游 HTTP ${res.status}`)
    const ct = res.headers.get('content-type')
    return ct?.includes('application/json') ? res.json() : undefined
  }

  return {
    /** 今日待办;上游失败沿用旧数据,从未成功 null;未配置抛 400(永久态不降级)。 */
    async todayTodos(): Promise<TodoTaskDto[] | null> {
      requireConfigured()
      if (cached && Date.now() - cached.at < TTL_MS) return cached.data
      try {
        const data = parseTodoTasks(
          await postJson('/open/v1/task/search', { status: [0], dueTo: endOfTodayPlus8() }),
        )
        cached = { at: Date.now(), data }
        lastGood = data
        return data
      } catch (e) {
        console.warn(`滴答待办取数失败: ${e}`)
        return lastGood
      }
    },
    /** 速记:仅标题,不指定清单即落收集箱。 */
    async createTask(title: string): Promise<void> {
      requireConfigured()
      cached = null
      await postJson('/open/v1/task', { title })
    },
    /** 点掉即完成。 */
    async completeTask(projectId: string, taskId: string): Promise<void> {
      requireConfigured()
      cached = null
      await postJson(`/open/v1/project/${projectId}/task/${taskId}/complete`)
    },
  }
}

/**
 * 端点(须在 requireAuth 之后挂载):
 * GET  /api/todo          → 今日待办(TodoTaskDto[];从未成功为 null,HTTP 仍 200)
 * POST /api/todo          → 速记({title} → 落收集箱)
 * POST /api/todo/complete → 点掉完成({projectId, taskId})
 */
export function didaRoutes(cfg?: DidaConfig, baseUrl?: string): Hono {
  const svc = createDidaService(cfg ?? { token: '' }, baseUrl)
  const readStr = async (c: { req: { json(): Promise<unknown> } }, key: string): Promise<string> => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const v = body[key]
    return typeof v === 'string' ? v.trim() : ''
  }
  return new Hono()
    .get('/api/todo', async (c) => c.json(await svc.todayTodos()))
    .post('/api/todo', async (c) => {
      const title = await readStr(c, 'title')
      if (!title) throw new BadRequest('title: 必填')
      await svc.createTask(title)
      return c.json({ ok: true })
    })
    .post('/api/todo/complete', async (c) => {
      const projectId = await readStr(c, 'projectId')
      const taskId = await readStr(c, 'taskId')
      if (!projectId || !taskId) throw new BadRequest('projectId/taskId: 必填')
      await svc.completeTask(projectId, taskId)
      return c.json({ ok: true })
    })
}
