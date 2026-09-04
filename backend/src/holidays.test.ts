import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { openDb } from './db'
import { bootstrap } from './seed'
import { createHolidayService, holidayRoutes, parseIcs, REST_ICS_URL, type HolidayService } from './holidays'

/**
 * 节假日休/班上游测试(ADR-0054):解析器直测(CRLF 真实形态)+ 服务降级语义
 * (合流 / 从未成功 null / 宁旧勿空)+ 路由空数组降级。cachedOrNull 原语本身
 * 已在 common.test.ts 覆盖,此处不重复 TTL 行为。
 */

/** 真实形态:muhan 源为 CRLF 行尾、VEVENT 内 DTSTART 在 SUMMARY 前。 */
const ics = (events: Array<{ date: string; summary: string }>): string =>
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Rank Technology//Chinese Holidays//EN\r\n' +
  events
    .map(
      (e) =>
        `BEGIN:VEVENT\r\nUID:20130101-0001\r\nDTSTART;VALUE=DATE:${e.date}\r\nSUMMARY:${e.summary}\r\nDESCRIPTION:假期第1天 / 共1天\r\nEND:VEVENT\r\n`,
    )
    .join('') +
  'END:VCALENDAR\r\n'

describe('parseIcs', () => {
  it('CRLF 真实形态:逐 VEVENT 取日期,SUMMARY 剥「假期/补班」后缀', () => {
    const days = parseIcs(
      ics([
        { date: '20260215', summary: '春节假期' },
        { date: '20260216', summary: '春节假期' },
      ]),
      'rest',
    )
    expect(days).toEqual([
      { date: '2026-02-15', kind: 'rest', name: '春节' },
      { date: '2026-02-16', kind: 'rest', name: '春节' },
    ])
    expect(parseIcs(ics([{ date: '20260131', summary: '春节补班' }]), 'work')).toEqual([
      { date: '2026-01-31', kind: 'work', name: '春节' },
    ])
  })

  it('组合名「国庆节、中秋节假期」仅剥后缀保留顿号', () => {
    expect(parseIcs(ics([{ date: '20201001', summary: '国庆节、中秋节假期' }]), 'rest')[0]!.name).toBe('国庆节、中秋节')
  })

  it('缺 DTSTART / 日期非法的块跳过,不致命', () => {
    const text =
      'BEGIN:VEVENT\r\nSUMMARY:无日期事件\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261332\r\nSUMMARY:非法日期\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260501\r\nSUMMARY:劳动节假期\r\nEND:VEVENT\r\n'
    expect(parseIcs(text, 'rest')).toEqual([{ date: '2026-05-01', kind: 'rest', name: '劳动节' }])
  })

  it('非 ics(HTML 错误页)/ 零 VEVENT 抛——空数据不得污染 lastGood', () => {
    expect(() => parseIcs('<html>502 Bad Gateway</html>', 'rest')).toThrow()
    expect(() => parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR', 'rest')).toThrow()
  })
})

describe('createHolidayService', () => {
  const rest = ics([{ date: '20260101', summary: '元旦假期' }, { date: '20260215', summary: '春节假期' }])
  const work = ics([{ date: '20260131', summary: '元旦补班' }])

  it('两源合流,kind 各归各;按日期排序', async () => {
    const fetchText = vi.fn((url: string) =>
      url === REST_ICS_URL ? Promise.resolve(rest) : Promise.resolve(work),
    )
    const svc = createHolidayService({ fetchText })
    expect(await svc.days()).toEqual([
      { date: '2026-01-01', kind: 'rest', name: '元旦' },
      { date: '2026-01-31', kind: 'work', name: '元旦' },
      { date: '2026-02-15', kind: 'rest', name: '春节' },
    ])
  })

  it('一源失败即整体失败:首次无 lastGood → null(半新半旧比全旧更有害)', async () => {
    const fetchText = vi.fn((url: string) =>
      url === REST_ICS_URL ? Promise.resolve(rest) : Promise.reject(new Error('upstream 500')),
    )
    const svc = createHolidayService({ fetchText })
    expect(await svc.days()).toBeNull()
  })

  it('先成功后失败:回落 lastGood(宁旧勿空)', async () => {
    let workOk = true
    const fetchText = vi.fn((url: string) =>
      url === REST_ICS_URL
        ? Promise.resolve(rest)
        : workOk ? Promise.resolve(work) : Promise.reject(new Error('down')),
    )
    const svc = createHolidayService({ fetchText })
    expect(await svc.days()).toHaveLength(3)
    workOk = false
    expect(await svc.days()).toHaveLength(3)
  })
})

describe('GET /api/holidays', () => {
  const rest = ics([{ date: '20260101', summary: '元旦假期' }])
  const work = ics([{ date: '20260131', summary: '元旦补班' }])

  const app = (fetchText: (url: string) => Promise<string>) => {
    const routes = new Hono()
    // 401 横切由契约测试统一覆盖,此处直挂路由(weather.test 同口径)
    routes.route('/', holidayRoutes(createHolidayService({ fetchText })))
    return routes
  }

  it('成功 → 200 全量 days', async () => {
    const fetchText = (url: string) => (url === REST_ICS_URL ? Promise.resolve(rest) : Promise.resolve(work))
    const res = await app(fetchText).request('/api/holidays')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      days: [
        { date: '2026-01-01', kind: 'rest', name: '元旦' },
        { date: '2026-01-31', kind: 'work', name: '元旦' },
      ],
    })
  })

  it('上游从未成功 → 200 空数组(降级非 500:无休/班标是日历合法形态)', async () => {
    const res = await app(() => Promise.reject(new Error('down'))).request('/api/holidays')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ days: [] })
  })
})

describe('createApp 装配 seam(ADR-0054 注记)', () => {
  it('注入桩 service → 200 桩数据;缺省不挂 → 404', async () => {
    const { db } = openDb(':memory:')
    await bootstrap(db, { username: 'admin', password: 'admin-pw' })
    const stub: HolidayService = {
      days: async () => [{ date: '2026-10-01', kind: 'rest', name: '国庆节' }],
    }
    const withHolidays = createApp({ db, holidays: stub })
    // login 取 cookie 过 requireAuth 横切(未认证 401 会盖住挂载差异,须认证后断言)
    const login = await withHolidays.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-pw' }),
    })
    const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!
    const res = await withHolidays.request('/api/holidays', { headers: { cookie } })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      days: [{ date: '2026-10-01', kind: 'rest', name: '国庆节' }],
    })
    // 同 db 有效 session 下缺省不挂 → 404:「可选参数仅测试 seam」的挂载护栏
    const bare = createApp({ db })
    const res404 = await bare.request('/api/holidays', { headers: { cookie } })
    expect(res404.status).toBe(404)
  })
})
