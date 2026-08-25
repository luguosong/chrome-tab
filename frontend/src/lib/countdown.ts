import { Lunar } from 'lunar-typescript'
import type { ImportantDate } from 'chrome-tab-shared'

/**
 * 倒计时(CONTEXT.md;时钟 hover 弹层的日期临近视图):汇集内置「节假日」与用户
 * 配置「重要日子」,凡距今 ≤30 天者按剩余天数升序混排。纯函数、前端本地推算,
 * 与农历宜忌同为确定性计算(按天重算,10s 心跳不触发)。
 */

export const COUNTDOWN_WINDOW_DAYS = 30

export type CountdownItem = {
  /** 节假日用内置 key,重要日子用其 id(React key 稳定)。 */
  key: string
  name: string
  /** 0=今天、1=明天;措辞映射在展示层。 */
  days: number
  date: Date
  source: 'holiday' | 'user'
}

// ── 节假日:内置清单,代码即配置(同「外源」枚举模式),用户不可增删 ──────────

type HolidayDef = { key: string; name: string; dateInYear: (gy: number) => Date | null }

/** 农历月日 → 指定公历年内的公历日期。农历年跨公历年(腊月/正月),须试相邻两个
 *  农历年取落在 gy 者;该农历年无此月日(库抛错)则次候选,全无 → null。 */
function lunarDateInGregorianYear(lm: number, ld: number, gy: number): Date | null {
  for (const ly of [gy - 1, gy]) {
    try {
      const s = Lunar.fromYmd(ly, lm, ld).getSolar()
      if (s.getYear() === gy) return new Date(gy, s.getMonth() - 1, s.getDay())
    } catch {
      /* 月日非法(如闰月年结构差异),换下一个候选农历年 */
    }
  }
  return null
}

const solarOn = (month: number, day: number) => (gy: number) => new Date(gy, month - 1, day)
const lunarOn = (lm: number, ld: number) => (gy: number) => lunarDateInGregorianYear(lm, ld, gy)

/** 清明:节气浮动在 4/4~4/6,扫 4 月上旬找节气「清明」(getJieQi 仅当日恰逢才返回)。 */
const qingming = (gy: number) => {
  for (let d = 1; d <= 10; d++) {
    if (Lunar.fromDate(new Date(gy, 3, d)).getJieQi() === '清明') return new Date(gy, 3, d)
  }
  return null
}

/** 除夕 = 当公历年春节前一日(春节最早 1-21,减一日必仍在年内;有的年份腊月只有廿九)。 */
const chuxi = (gy: number) => {
  const spring = lunarOn(1, 1)(gy)
  return spring && new Date(spring.getFullYear(), spring.getMonth(), spring.getDate() - 1)
}

/** 当月第 n 个星期 weekday(0=周日)。 */
const nthWeekday = (month: number, n: number, weekday: number) => (gy: number) => {
  const first = new Date(gy, month - 1, 1)
  return new Date(gy, month - 1, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7)
}

/** 复活节(Meeus/Jones/Butcher 公历算法):春分后首个满月后的首个周日。 */
function easter(gy: number): Date {
  const a = gy % 19
  const b = Math.floor(gy / 100)
  const c = gy % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(gy, month - 1, day)
}

/** 21 项内置节假日(grilling 定案:法定 7 + 传统 5 + 国际/西方固定 5 + 浮动 4)。 */
const HOLIDAYS: HolidayDef[] = [
  { key: 'new-year', name: '元旦', dateInYear: solarOn(1, 1) },
  { key: 'chuxi', name: '除夕', dateInYear: chuxi },
  { key: 'spring-festival', name: '春节', dateInYear: lunarOn(1, 1) },
  { key: 'lantern', name: '元宵', dateInYear: lunarOn(1, 15) },
  { key: 'valentine', name: '情人节', dateInYear: solarOn(2, 14) },
  { key: 'women', name: '妇女节', dateInYear: solarOn(3, 8) },
  { key: 'qingming', name: '清明', dateInYear: qingming },
  { key: 'easter', name: '复活节', dateInYear: easter },
  { key: 'labor', name: '劳动节', dateInYear: solarOn(5, 1) },
  { key: 'mothers-day', name: '母亲节', dateInYear: nthWeekday(5, 2, 0) },
  { key: 'children', name: '儿童节', dateInYear: solarOn(6, 1) },
  { key: 'fathers-day', name: '父亲节', dateInYear: nthWeekday(6, 3, 0) },
  { key: 'dragon-boat', name: '端午', dateInYear: lunarOn(5, 5) },
  { key: 'qixi', name: '七夕', dateInYear: lunarOn(7, 7) },
  { key: 'mid-autumn', name: '中秋', dateInYear: lunarOn(8, 15) },
  { key: 'national-day', name: '国庆', dateInYear: solarOn(10, 1) },
  { key: 'halloween', name: '万圣节', dateInYear: solarOn(10, 31) },
  { key: 'chongyang', name: '重阳', dateInYear: lunarOn(9, 9) },
  { key: 'thanksgiving', name: '感恩节', dateInYear: nthWeekday(11, 4, 4) },
  { key: 'christmas', name: '圣诞', dateInYear: solarOn(12, 25) },
  { key: 'laba', name: '腊八', dateInYear: lunarOn(12, 8) },
]

// ── 重要日子:下一次出现(CONTEXT.md「重要日子」;annual 年份无意义)──────────

/** 「今天」锚点:当日零点。 */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** 年度日循环的下一个出现:今年已过(含今天之后才开始比)滚次年。 */
function nextAnnual(thisYear: (y: number) => Date | null, today: Date): Date | null {
  const cur = thisYear(today.getFullYear())
  if (cur && cur.getTime() >= today.getTime()) return cur
  return thisYear(today.getFullYear() + 1)
}

function nextUserDate(d: ImportantDate, today: Date): Date | null {
  const [, m, day] = d.date.split('-').map(Number)
  const year = Number(d.date.slice(0, 4))
  if (d.repeat === 'annual') {
    return d.calendar === 'lunar'
      ? nextAnnual((y) => lunarDateInGregorianYear(m, day, y), today)
      : nextAnnual((y) => new Date(y, m - 1, day), today)
  }
  try {
    const date =
      d.calendar === 'lunar'
        ? (() => {
            const s = Lunar.fromYmd(year, m, day).getSolar()
            return new Date(s.getYear(), s.getMonth() - 1, s.getDay())
          })()
        : new Date(year, m - 1, day)
    return date.getTime() >= today.getTime() ? date : null
  } catch {
    return null // 非法农历日期,静默跳过
  }
}

/** 倒计时窗口内条目(≤30 天,升序混排;空窗 = 空数组,展示层隐藏分区)。 */
export function getCountdowns(now: Date, userDates: ImportantDate[]): CountdownItem[] {
  const today = startOfDay(now)
  const items: CountdownItem[] = []
  const push = (key: string, name: string, date: Date | null, source: 'holiday' | 'user') => {
    if (!date) return
    const days = Math.round((date.getTime() - today.getTime()) / 86_400_000)
    if (days >= 0 && days <= COUNTDOWN_WINDOW_DAYS) items.push({ key, name, days, date, source })
  }
  for (const h of HOLIDAYS) push(h.key, h.name, nextAnnual(h.dateInYear, today), 'holiday')
  for (const u of userDates) push(u.id, u.name, nextUserDate(u, today), 'user')
  return items.sort((a, b) => a.days - b.days)
}
