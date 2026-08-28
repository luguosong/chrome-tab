import { Hono } from 'hono'
import { asRec, BadRequest, cachedOrNull, ConflictError, str } from './common'

/**
 * 滴答清单待办代理(CONTEXT.md「待办」):单例图标的取数与写回——首个可写图标类型。
 * 认证 = API 口令(滴答网页版「设置→账户与安全→API 口令」生成,Authorization: Bearer),
 * env 注入不入前端(同「天气」范式,ADR-0009)。
 *
 * 读 = 三视图 bundle(2026-08-24 3×2 迭代):
 *   - week:POST /task/search(status=[0],dueTo=+7 天 23:59:59+08:00)= 未来 7 天 + 过期;
 *   - today:week 中到期 ≤ 今晚 的子集(后端分拣,毫秒比较不吃偏移格式差异);
 *   - inbox:POST /task/filter(projectIds=["inbox"]——收集箱保留 id 字面量,status=[0]),
 *     无日期杂项速记落此(线上实测 search 不吃 projectIds,filter 吃)。
 * 写 = POST /open/v1/task(速记:仅 title,不指定清单即落收集箱)
 *   + POST /open/v1/project/{projectId}/task/{taskId}/complete(点掉即完成)。
 * 读缓存 = 内存单键 TTL 60s + lastGood 降级(宁旧勿空,从未成功 null,同 aihot);
 * 写直通并清读缓存(自己勾掉/速记的下一次读即见)。并发不去重(单例 + react-query 已去重)。
 * 未配置口令 → 400 透出提示(区别于上游失败的 502,前端可区分「去生成口令」与「稍后重试」)。
 */

const TTL_MS = 60_000
const DEFAULT_BASE = 'https://api.dida365.com'
/** 收集箱保留 projectId 字面量(滴答 Open API 约定,线上实测 filter/data 端点均收)。 */
const INBOX_PROJECT_ID = 'inbox'
/** 「7 天待办」窗口:今天起第 7 天的 +08 日末。 */
const WEEK_DAYS = 7

// ── wire DTO(裁剪为前端消费的字段子集;防御式读取,脏条目跳过)──────────────────

export interface TodoTaskDto {
  id: string
  projectId: string
  title: string
  /** 0 无 1 低 3 中 5 高(滴答原值)。 */
  priority: number
  /** 到期时间(ISO),week/today 口径下必有;null 兜底排尾。 */
  dueDate: string | null
  /** 备注(markdown,「待办详情」只读渲染)。上游字段名 content(非 note,线上实测);缺失/空 = 无备注。 */
  content: string
}

/** 三视图 bundle:tile 主显 inbox,Modal 按 tab 分取;week 含 today(7 天全量)。 */
export interface TodoBundleDto {
  today: TodoTaskDto[]
  week: TodoTaskDto[]
  inbox: TodoTaskDto[]
}

/** UTC+8 起算第 addDays 天的日末 23:59:59(服务器时区无关)。today=0、week=7。纯函数可直测。 */
export function endOfPlus8(now = new Date(), addDays = 0): string {
  const t = new Date(now.getTime() + (8 + addDays * 24) * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T23:59:59+08:00`
}

/** 解析响应:非数组抛;条目缺 id/title 跳过。优先级降序为主键(高置顶);due 视图同级按到期升序(最紧迫在前,null 排尾),inbox 同级保留上游序。 */
export function parseTodoTasks(resp: unknown, view: 'due' | 'inbox' = 'due'): TodoTaskDto[] {
  if (!Array.isArray(resp)) throw new Error('滴答响应缺任务数组')
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
      content: str(m, 'content') ?? '',
    })
  }
  const due = (t: TodoTaskDto) => t.dueDate ?? '9999'
  out.sort((a, b) => b.priority - a.priority || (view === 'due' ? due(a).localeCompare(due(b)) : 0))
  return out
}

/**
 * 从 week 全量分拣 today(到期 ≤ 今晚,毫秒比较——偏移格式混用时字符串序不可靠)。
 * today ⊆ week。纯函数可直测。
 */
export function splitToday(week: TodoTaskDto[], now = new Date()): TodoTaskDto[] {
  const tonight = Date.parse(endOfPlus8(now, 0))
  return week.filter((t) => {
    if (!t.dueDate) return false
    const ms = Date.parse(t.dueDate)
    return Number.isFinite(ms) && ms <= tonight
  })
}

// ── 服务(HTTP + 缓存)──────────────────────────────────────────────────────────

export type DidaConfig = { token: string }

export function createDidaService(cfg: DidaConfig, baseUrl = DEFAULT_BASE) {
  const { token } = cfg
  // 三视图 bundle 的取数源:TTL/宁旧勿空/从未成功 null 三不变量走 cachedOrNull
  // 原语(ADR-0042);单键闭包传常量键,写操作 invalidate 强制下读重拉。
  const bundleSource = cachedOrNull<string, TodoBundleDto>({
    ttlMs: TTL_MS,
    fetch: async () => {
      const now = new Date()
      const [week, inbox] = await Promise.all([
        postJson('/open/v1/task/search', {
          keywords: '', // 上游 2026-08-24 起缺失即 500(空串 = 不过滤,线上实测)
          status: [0],
          dueTo: endOfPlus8(now, WEEK_DAYS),
        }).then((r) => parseTodoTasks(r, 'due')),
        postJson('/open/v1/task/filter', {
          projectIds: [INBOX_PROJECT_ID],
          status: [0],
        }).then((r) => parseTodoTasks(r, 'inbox')),
      ])
      return { today: splitToday(week, now), week, inbox }
    },
    warnLabel: () => '滴答待办取数失败',
  })

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
    /** 三视图 bundle;上游失败沿用旧数据,从未成功 null;未配置抛 400(永久态不降级)。 */
    async todoBundle(): Promise<TodoBundleDto | null> {
      requireConfigured()
      return bundleSource.get('bundle')
    },
    /** 速记:仅标题,不指定清单即落收集箱。 */
    async createTask(title: string): Promise<void> {
      requireConfigured()
      bundleSource.invalidate('bundle')
      await postJson('/open/v1/task', { title })
    },
    /** 点掉即完成。 */
    async completeTask(projectId: string, taskId: string): Promise<void> {
      requireConfigured()
      bundleSource.invalidate('bundle')
      await postJson(`/open/v1/project/${projectId}/task/${taskId}/complete`)
    },
  }
}

/**
 * 端点(须在 requireAuth 之后挂载):
 * GET  /api/todo          → 三视图 bundle(TodoBundleDto;从未成功为 null,HTTP 仍 200)
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
    .get('/api/todo', async (c) => c.json(await svc.todoBundle()))
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
