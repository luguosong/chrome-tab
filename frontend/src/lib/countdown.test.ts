import { describe, expect, it } from 'vitest'
import {
  buildCellMarks,
  buildMonthGrid,
  cellModel,
  describeDays,
  draftToImportantDate,
  getAllCountdowns,
  getCountdowns,
  holidaysInMonth,
  importantDatesInMonth,
  isoWeekNumber,
  lunarDayText,
  toIsoDate,
  type ImportantDateDraft,
} from './countdown'
import type { ImportantDate } from 'chrome-tab-shared'

// 对拍基准:农历节日公历日期已用 lunar-typescript 实测核对(2026/2027 两年),
// 浮动节日与公认公历核对(2026:复活节 4-5、母亲节 5-10、父亲节 6-21、感恩节 11-26)。
// 断言变动 = 清单或算法变更,须人工复核。
const user = (over: Partial<ImportantDate>): ImportantDate => ({
  id: 'u1',
  name: '测试日',
  date: '2000-01-01',
  calendar: 'solar',
  repeat: 'annual',
  ...over,
})

describe('getCountdowns 节假日', () => {
  it('2026-09-01:中秋(9-25)24 天、国庆(10-1)恰 30 天入窗,升序;万圣节 60 天出窗', () => {
    const items = getCountdowns(new Date(2026, 8, 1), [])
    const names = items.map((i) => i.name)
    expect(names).toEqual(['中秋', '国庆'])
    expect(items[0]).toMatchObject({ days: 24, source: 'holiday' })
    expect(items[1].days).toBe(30)
  })

  it('2026-08-26:中秋距 30 天恰入窗(边界含);2026-08-25 则 31 天恰出窗', () => {
    expect(getCountdowns(new Date(2026, 7, 26), []).map((i) => i.name)).toEqual(['中秋'])
    expect(getCountdowns(new Date(2026, 7, 25), [])).toEqual([])
  })

  it('2026-09-25 中秋当天:days=0(「今天」由 UI 措辞);国庆/重阳同窗随其后', () => {
    const items = getCountdowns(new Date(2026, 8, 25), [])
    expect(items.map((i) => i.name)).toEqual(['中秋', '国庆', '重阳'])
    expect(items[0]).toMatchObject({ days: 0, source: 'holiday' })
  })

  it('2027-01-10:腊八(1-15)5 天、除夕(2-5)26 天、春节(2-6)27 天,升序', () => {
    const items = getCountdowns(new Date(2027, 0, 10), [])
    expect(items.map((i) => i.name)).toEqual(['腊八', '除夕', '春节'])
    expect(items[1].days).toBe(26)
  })

  it('2026-04-01:清明与复活节同为 4-5(4 天);2026-11-01:感恩节 11-26 为 25 天', () => {
    const april = getCountdowns(new Date(2026, 3, 1), [])
    expect(april.filter((i) => i.name === '清明' || i.name === '复活节').every((i) => i.days === 4)).toBe(true)
    const nov = getCountdowns(new Date(2026, 10, 1), [])
    expect(nov.find((i) => i.name === '感恩节')?.days).toBe(25)
    expect(nov.find((i) => i.name === '圣诞')).toBeUndefined() // 54 天,出窗
  })

  it('浮动节日锚点:2026 母亲节 5-10、父亲节 6-21;复活节 2027=3-28、2028=4-16', () => {
    const may = getCountdowns(new Date(2026, 4, 1), [])
    expect(may.find((i) => i.name === '母亲节')?.days).toBe(9)
    expect(may.find((i) => i.name === '父亲节')).toBeUndefined() // 6-21 距 5-1 为 51 天,出窗
    const jun = getCountdowns(new Date(2026, 5, 1), [])
    expect(jun.find((i) => i.name === '父亲节')?.days).toBe(20)
    const e27 = getCountdowns(new Date(2027, 2, 1), [])
    expect(e27.find((i) => i.name === '复活节')?.days).toBe(27)
    const e28 = getCountdowns(new Date(2028, 2, 20), [])
    expect(e28.find((i) => i.name === '复活节')?.days).toBe(27)
  })

  it('年度滚年:2026-12-15 时元旦滚到 2027-01-01(17 天),非 2026-01-01', () => {
    const items = getCountdowns(new Date(2026, 11, 15), [])
    expect(items.find((i) => i.name === '元旦')?.days).toBe(17)
  })
})

describe('getCountdowns 重要日子', () => {
  it('公历 annual:今年未过取今年;已过滚次年(出窗即不显)', () => {
    const birthday = user({ name: '生日', date: '1990-09-10' })
    expect(getCountdowns(new Date(2026, 7, 25), [birthday])).toEqual([
      expect.objectContaining({ name: '生日', days: 16, source: 'user' }),
    ])
    // 2026-09-11 时生日已过滚 2027-09-10(364 天出窗);中秋(9-25)等节假日照常在窗
    const after = getCountdowns(new Date(2026, 8, 11), [birthday])
    expect(after.filter((i) => i.source === 'user')).toEqual([])
  })

  it('农历 annual:按当年换算公历(2026 农历七月十四 = 08-26,明天)', () => {
    const lunarBd = user({ name: '农历生日', date: '1990-07-14', calendar: 'lunar' })
    expect(getCountdowns(new Date(2026, 7, 25), [lunarBd])).toEqual([
      expect.objectContaining({ name: '农历生日', days: 1 }),
    ])
  })

  it('once:未过期正常显示,过期即消失', () => {
    const once = user({ name: '交房', date: '2026-09-05', repeat: 'once' })
    expect(getCountdowns(new Date(2026, 7, 25), [once])[0].days).toBe(11)
    const stale = getCountdowns(new Date(2026, 7, 26), [user({ name: '旧事', date: '2026-08-01', repeat: 'once' })])
    expect(stale.find((i) => i.source === 'user')).toBeUndefined()
  })

  it('非法农历月日跳过不抛', () => {
    const bad = user({ date: '2000-13-01', calendar: 'lunar' })
    expect(getCountdowns(new Date(2026, 7, 25), [bad])).toEqual([])
  })

  it('与节假日混排:按剩余天数升序,不分来源', () => {
    const items = getCountdowns(new Date(2026, 8, 20), [user({ name: '纪念日', date: '2000-09-23' })])
    expect(items.map((i) => i.name)).toEqual(['纪念日', '中秋', '国庆', '重阳'])
  })
})

describe('getAllCountdowns 全量口径(图标块内下一条/Modal 节假日分区,不限 30 天窗)', () => {
  it('出窗条目仍在列:2026-08-01 时圣诞(12-25)146 天、腊八滚 2027-01-15', () => {
    const items = getAllCountdowns(new Date(2026, 7, 1), [])
    expect(items.find((i) => i.name === '圣诞')?.days).toBe(146)
    expect(items.find((i) => i.name === '腊八')?.days).toBe(167)
  })

  it('用户 annual 滚次年仍显示(块内常显下一条哪怕 364 天):首个=全量最近', () => {
    const birthday = user({ name: '生日', date: '1990-09-10' })
    const items = getAllCountdowns(new Date(2026, 8, 11), [birthday])
    expect(items[0]).toMatchObject({ name: '中秋', days: 14 })
    expect(items.find((i) => i.source === 'user')).toMatchObject({ name: '生日', days: 364 })
  })

  it('同日撞期:用户重要日子排节假日前(块内下一条/弹层首行不被内置清单遮蔽)', () => {
    const birthday = user({ name: '生日', date: '2000-10-01' })
    const items = getAllCountdowns(new Date(2026, 8, 20), [birthday])
    // 中秋(9-25,5 天)在前;并列的 11 天组内 user 先于 holiday(sort 稳定,入列顺序决出)
    const tied = items.filter((i) => i.days === 11)
    expect(tied.map((i) => i.name)).toEqual(['生日', '国庆'])
  })

  it('农历节日带 lunar 农历月日(公历反查);公历节日与用户条目无', () => {
    const items = getAllCountdowns(new Date(2026, 8, 1), [user({ name: '农历生日', date: '1990-07-14', calendar: 'lunar' })])
    expect(items.find((i) => i.name === '中秋')?.lunar).toBe('八月十五')
    expect(items.find((i) => i.name === '国庆')?.lunar).toBeUndefined()
    expect(items.find((i) => i.source === 'user')?.lunar).toBeUndefined()
  })

  it('除夕 lunar 随腊月大小浮动,非写死(2027 除夕=2-5 反查腊月廿九)', () => {
    const items = getAllCountdowns(new Date(2027, 0, 10), [])
    expect(items.find((i) => i.name === '除夕')?.lunar).toBe('腊月廿九')
  })

  it('窗口口径是其子集:getCountdowns 恒为 getAllCountdowns 的 30 天切片', () => {
    const dates = [user({ name: '生日', date: '1990-09-10' }), user({ name: '交房', date: '2026-09-05', repeat: 'once' })]
    const all = getAllCountdowns(new Date(2026, 7, 25), dates)
    expect(all.map((i) => i.name).slice(0, 3)).toEqual(['交房', '生日', '中秋']) // 中秋 31 天仅在全量
    expect(getCountdowns(new Date(2026, 7, 25), dates).every((i) => i.days <= 30)).toBe(true)
  })
})

describe('describeDays 措辞映射', () => {
  it('0=今天、1=明天、其余「N 天」(弹层/块内/Modal 三处共用)', () => {
    expect(describeDays(0)).toBe('今天')
    expect(describeDays(1)).toBe('明天')
    expect(describeDays(24)).toBe('24 天')
    expect(describeDays(364)).toBe('364 天')
  })
})

describe('日历月视图(ADR-0054):当月内实例化,区别于「下一次出现」口径', () => {
  it('toIsoDate 零填充(与后端休/班 date 同形)', () => {
    expect(toIsoDate(new Date(2026, 8, 3))).toBe('2026-09-03')
  })

  it('buildMonthGrid:周一起始、42 格固定、首尾补位 inMonth=false、weekend 标记', () => {
    const grid = buildMonthGrid(2026, 8) // 2026-09:1 日是周二 → 首格补 8-31(周一)
    expect(grid).toHaveLength(42)
    expect(grid[0]).toMatchObject({ iso: '2026-08-31', day: 31, inMonth: false, weekend: false })
    expect(grid[1]).toMatchObject({ iso: '2026-09-01', day: 1, inMonth: true, weekend: false })
    expect(grid[5]).toMatchObject({ iso: '2026-09-05', weekend: true }) // 周六
    expect(grid[41]).toMatchObject({ iso: '2026-10-11', day: 11, inMonth: false, weekend: true }) // 周日
    expect(grid[1]!.date).toEqual(new Date(2026, 8, 1)) // 本地 Date 随格透传(副行农历用)
  })

  it('isoWeekNumber:周四定年,跨年归属按 ISO(1-1 属上年初、12 月末可属下年 W1)', () => {
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1) // 1-1 恰周四 = W1 起点日
    expect(isoWeekNumber(new Date(2026, 8, 3))).toBe(36) // 当日(2026-09-03,周四)
    expect(isoWeekNumber(new Date(2026, 11, 31))).toBe(53) // 1-1 是周四的年有 53 个 ISO 周
    expect(isoWeekNumber(new Date(2024, 11, 30))).toBe(1) // 2024-12-30(周一)已属 2025 W1
  })

  it('lunarDayText:节气日显节气名,否则农历日(「二十/廿一」形态;与参考图对拍)', () => {
    expect(lunarDayText(new Date(2026, 8, 3))).toBe('廿二') // 2026-09-03(参考图「今」格)
    expect(lunarDayText(new Date(2026, 8, 7))).toBe('白露') // 节气压农历日
    expect(lunarDayText(new Date(2026, 8, 25))).toBe('十五') // 中秋当日(节日名由内置清单另管)
    expect(lunarDayText(new Date(2026, 8, 1))).toBe('二十')
  })

  it('holidaysInMonth:已过节日也返回(10 月中旬开日历,国庆须在格上)', () => {
    // getAllCountdowns 在 10-08 只给 2027 国庆;月视图要的是当月已过的 10-01
    const october = holidaysInMonth(2026, 9)
    expect(october.find((h) => h.name === '国庆')?.date.getMonth()).toBe(9)
    expect(toIsoDate(october.find((h) => h.name === '国庆')!.date)).toBe('2026-10-01')
    expect(holidaysInMonth(2026, 8).map((h) => h.name)).toContain('中秋')
    expect(holidaysInMonth(2026, 8).map((h) => h.name)).not.toContain('春节')
  })

  it('importantDatesInMonth:annual 公历/农历按该年换算,once 判当年当月', () => {
    const dates = [
      user({ id: 'a', name: '生日', date: '2000-05-20' }),
      user({ id: 'b', name: '农历纪念日', date: '1990-08-15', calendar: 'lunar' }), // 2026 年换算 = 9-25(中秋同日)
      user({ id: 'c', name: '交房', date: '2026-09-10', repeat: 'once' }),
    ]
    const sept = importantDatesInMonth(dates, 2026, 8)
    expect(sept.map((i) => i.id)).toEqual(['c', 'b']) // 按日升序:9-10(once)在 9-25(农历换算)前
  })

  it('importantDatesInMonth:annual 公历 2-29 非闰年不标(进位 3-1 被月过滤排除)', () => {
    const dates = [user({ id: 'leap', name: '闰日', date: '2000-02-29' })]
    expect(importantDatesInMonth(dates, 2026, 1)).toEqual([]) // 2026 非闰年:2 月无标
    expect(importantDatesInMonth(dates, 2028, 1).map((i) => i.id)).toEqual(['leap'])
  })
})

describe('日历格语义(ADR-0056):三源合并与逐格决策单点,组件只做渲染映射', () => {
  // 2026-10:1 日周四、3/4 周末、11 周日(与上文 buildMonthGrid/isoWeekNumber 锚点同源)
  const grid = buildMonthGrid(2026, 9)
  const cell = (iso: string) => grid.find((c) => c.iso === iso)!

  it('buildCellMarks:同 iso 三源共存(撞期个人/节日名/休互不覆盖,由渲染层各取所司)', () => {
    const marks = buildCellMarks(
      [
        { date: '2026-10-01', kind: 'rest' },
        { date: '2026-10-11', kind: 'work' },
      ],
      2026,
      [9],
      [user({ id: 'a', name: '纪念日', date: '1990-10-01' })],
    )
    expect(marks.get('2026-10-01')).toEqual({ rest: true, holiday: '国庆', importantId: 'a' })
    expect(marks.get('2026-10-11')).toEqual({ work: true }) // 周日补班格(九月初二),无内置节日
    expect(marks.get('2026-10-18')?.holiday).toBe('重阳') // 农历换算:2026 九月初九
    expect(marks.get('2026-10-31')?.holiday).toBe('万圣节') // 文化节日同入 map
  })

  it('buildCellMarks:months 决定铺开范围(月视图单月/年视图全年 12 月)', () => {
    expect(buildCellMarks([], 2026, [8], []).get('2026-10-01')).toBeUndefined()
    const wholeYear = buildCellMarks([], 2026, Array.from({ length: 12 }, (_, i) => i), [])
    expect(wholeYear.get('2026-09-25')?.holiday).toBe('中秋') // 9 月节日进入年视图铺开
  })

  it('cellModel:底色四层优先级 重要日子 > 休 > 班 > 周末 > 常规(上层赢,2026-09-03 用户定案)', () => {
    const oct1 = cell('2026-10-01') // 周四平日
    expect(cellModel(oct1, { importantId: 'a', rest: true, holiday: '国庆' }).bg).toBe('bg-amber-300/15')
    expect(cellModel(oct1, { rest: true }).bg).toBe('bg-emerald-500/20')
    expect(cellModel(oct1, { work: true }).bg).toBe('bg-red-400/10')
    const saturday = grid.find((c) => c.weekend && c.inMonth)! // 10-03 周六
    expect(cellModel(saturday, undefined).bg).toBe('bg-emerald-300/10')
    expect(cellModel(saturday, { work: true }).bg).toBe('bg-red-400/10') // 补班红盖周末淡绿
    expect(cellModel(oct1, undefined).bg).toBe('bg-white/[0.04]')
  })

  it('cellModel:副行节日名优先,无节日走节气/农历;角标与可点性随源', () => {
    const full = cellModel(cell('2026-10-01'), { rest: true, holiday: '国庆', importantId: 'a' })
    expect(full.subline).toBe('国庆')
    expect(full.corner).toBe('rest')
    expect(full.clickable).toBe(true)
    // 10-02 无内置节日:中秋 9-25(八月十五)后 7 天 = 八月廿二(与 lunarDayText 同源)
    expect(cellModel(cell('2026-10-02'), undefined).subline).toBe('廿二')
    expect(cellModel(cell('2026-10-11'), { work: true }).corner).toBe('work')
    expect(cellModel(cell('2026-10-01'), undefined).corner).toBeNull()
    expect(cellModel(cell('2026-10-01'), undefined).clickable).toBe(false)
  })
})

describe('draftToImportantDate(ADR-0056):表单校验与成形,文案与表单直显一致', () => {
  const draft = (over: Partial<ImportantDateDraft>): ImportantDateDraft => ({
    id: null,
    name: '生日',
    calendar: 'solar',
    repeat: 'annual',
    year: '',
    month: '10',
    day: '1',
    ...over,
  })

  it('校验三关:名称空白/月日越界/once 无年份', () => {
    expect(draftToImportantDate(draft({ name: '  ' }))).toEqual({ ok: false, error: '名称不能为空' })
    expect(draftToImportantDate(draft({ month: '13' }))).toEqual({ ok: false, error: '日期不完整' })
    expect(draftToImportantDate(draft({ day: '0' }))).toEqual({ ok: false, error: '日期不完整' })
    expect(draftToImportantDate(draft({ repeat: 'once' }))).toEqual({ ok: false, error: '仅一次的日期需要年份' })
  })

  it('annual 年份占位 2000;名称 trim;id 复用草稿携带、新增生成 uuid', () => {
    const fresh = draftToImportantDate(draft({ name: ' 生日 ' }))
    expect(fresh).toMatchObject({
      ok: true,
      item: { name: '生日', date: '2000-10-01', calendar: 'solar', repeat: 'annual' },
    })
    expect(fresh.ok && fresh.item.id).toMatch(/^[\da-f-]{36}$/) // crypto.randomUUID
    expect(draftToImportantDate(draft({ id: 'u1' }))).toMatchObject({ ok: true, item: { id: 'u1' } })
  })
})
