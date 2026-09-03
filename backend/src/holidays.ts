import { Hono } from 'hono'
import { cachedOrNull, chromeHeaders, FETCH_TIMEOUT, fetchText } from './common'

/**
 * 节假日休/班上游(CONTEXT.md「节假日」②轨,ADR-0054):ical.muhan.org 双 ics 订阅
 * (rest=法定放假日、work=调休补班日),单日 VEVENT(DTSTART;VALUE=DATE,SUMMARY
 * 「XX假期/补班」),2013 起全量(~62KB+14KB)。手写解析零新依赖(backend CJS 依赖
 * 的 ESM bundle 崩溃坑)。取数走 cachedOrNull(ADR-0042):TTL 24h(数据一年一变,
 * 次年安排惯例 10-11 月公布),上游失败回落 lastGood、从未成功回 null——端点收敛
 * 空数组降级(定案:无休/班标不报错,节日名小字在前端由内置清单独立承载)。无 cron:
 * 按需 lazy 取 + 启动预热;ical.muhan.org 国内直连(compose NO_PROXY,契约扫描含本文件)。
 */

export const REST_ICS_URL = 'https://ical.muhan.org/rest.ics'
export const WORK_ICS_URL = 'https://ical.muhan.org/work.ics'

export type HolidayKind = 'rest' | 'work'

/** 单日休/班标记(date = YYYY-MM-DD;name 为剥「假期/补班」后缀的节日名,展示备用)。 */
export interface HolidayDay {
  date: string
  kind: HolidayKind
  name: string
}

/**
 * 解析单文件 ics:逐 VEVENT 取 DTSTART(带或不带 VALUE=DATE 参数)与 SUMMARY。
 * 块缺 DTSTART / 日期非法跳过;非 ics(如上游返回 HTML 错误页)或零 VEVENT 抛——
 * cachedOrNull 语义下空数据不得当成功污染 lastGood。不处理长行折行(本源 SUMMARY 均短行)。
 */
export function parseIcs(text: string, kind: HolidayKind): HolidayDay[] {
  const days: HolidayDay[] = []
  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const end = block.indexOf('END:VEVENT')
    if (end < 0) continue
    const start = /DTSTART(?:;[^:\r\n]*)?:\s*(\d{8})/.exec(block.slice(0, end))
    if (!start) continue
    const raw = start[1]!
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    if (Number.isNaN(Date.parse(`${date}T00:00:00`))) continue
    const summary = /SUMMARY[^:\r\n]*:([^\r\n]+)/.exec(block.slice(0, end))
    const name = summary?.[1]?.trim().replace(/(假期|补班)$/, '') ?? ''
    days.push({ date, kind, name })
  }
  if (days.length === 0) throw new Error(`ics 零 VEVENT(kind=${kind})`)
  return days
}

export interface HolidayDeps {
  fetchText: (url: string) => Promise<string>
}

export function prodHolidayDeps(): HolidayDeps {
  return { fetchText: (url) => fetchText(url, FETCH_TIMEOUT, chromeHeaders()) }
}

const TTL_MS = 24 * 60 * 60_000
const KEY = 'all'

export function createHolidayService(deps: HolidayDeps) {
  const source = cachedOrNull<string, HolidayDay[]>({
    ttlMs: TTL_MS,
    fetch: async () => {
      // 两源一成一败即整体失败回落——半新半旧的休/班标记比全旧更有害(调休标反)
      const [rest, work] = await Promise.all([deps.fetchText(REST_ICS_URL), deps.fetchText(WORK_ICS_URL)])
      return [...parseIcs(rest, 'rest'), ...parseIcs(work, 'work')].sort((a, b) => a.date.localeCompare(b.date))
    },
    warnLabel: () => '节假日休/班取数失败',
  })
  return { days: () => source.get(KEY) }
}

/**
 * GET /api/holidays(须在 requireAuth 之后挂载)→ { days: HolidayDay[] } 全量
 * (2013 起平铺,~500 条;前端自建 YYYY-MM-DD map,免按年过滤逻辑)。降级:上游
 * 从未成功 → days 空数组(200,非 500——日历无休/班标是合法形态)。
 */
export function holidayRoutes(deps = prodHolidayDeps()): Hono {
  const svc = createHolidayService(deps)
  void svc.days().catch(() => {}) // 启动预热(fire-and-forget;失败由 cachedOrNull 记因,首请求重试)
  return new Hono().get('/api/holidays', async (c) => {
    const days = await svc.days()
    return c.json({ days: days ?? [] })
  })
}
