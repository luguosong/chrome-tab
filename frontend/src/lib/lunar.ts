import { Solar } from 'lunar-typescript'

/** 宜忌展示的优先词表:命中的当代常用词保持典籍原序置前,未命中的古语词(纳采/订盟/开渠…)沉底。
 *  词形须与《协纪辨方书》表序词汇一致(「移徙」非「搬家」);沉底词不丢弃,由 title 完整列表承载。 */
const COMMON = new Set([
  '嫁娶', '祭祀', '祈福', '求嗣', '出行', '理发', '移徙', '入宅', '安床', '安葬',
  '破土', '上梁', '动土', '开业', '开市', '交易', '立券', '栽种', '纳畜', '开光',
  '探病', '求医', '治病', '沐浴', '会亲友', '拆卸',
])

export interface DayAlmanac {
  /** 农历全称,如「丙午年七月十二」;闰月带「闰」前缀 */
  lunarText: string
  /** 农历年数字(如 2026),生肖轮 title 算本命年用 */
  lunarYear: number
  /** 当年生肖单字(如「马」),与 lunarText 干支同口径(正月初一界) */
  yearShengXiao: string
  /** 当天节气名(如「处暑」),非节气日为 undefined */
  term?: string
  /** 宜,白名单优选后取前 3 */
  yi: string[]
  /** 忌,同上 */
  ji: string[]
  /** 完整宜列表(title 用) */
  fullYi: string[]
  /** 完整忌列表(title 用) */
  fullJi: string[]
  /** 十二时辰吉凶(子起亥终);天神名与吉凶由日干支推定 */
  hours: HourLuck[]
  /** 今日太阳星座简称(如「处女」),Solar.getXingZuo 按公历日推定 */
  xingZuo: string
}

/** 单个时辰的吉凶:天神十二神,黄道六神(青龙/明堂/金匮/天德/玉堂/司命)为吉,
 *  黑道六神(天刑/朱雀/白虎/天牢/玄武/勾陈)为凶;title 详注天神与黄黑道。 */
export interface HourLuck {
  /** 时辰地支单字(子/丑/寅/…) */
  zhi: string
  /** 吉凶二值 */
  luck: '吉' | '凶'
  /** 天神名,如「青龙」「白虎」 */
  tianShen: string
  /** 黄道/黑道 */
  dao: '黄道' | '黑道'
}

/** 一天的农历+宜忌,时钟数据源(纯函数,按 date 直测)。
 *  宜忌数据为 lunar-typescript 内置的《钦定协纪辨方书》整理表,与时钟同为本地推算、不经后端。 */
export function getAlmanac(date: Date): DayAlmanac {
  const lunar = Solar.fromDate(date).getLunar()
  const fullYi = lunar.getDayYi()
  const fullJi = lunar.getDayJi()
  const pick = (list: string[]) => [
    ...list.filter((x) => COMMON.has(x)),
    ...list.filter((x) => !COMMON.has(x)),
  ].slice(0, 3)
  const term = lunar.getJieQi()
  // getTimes() 返回 13 项(子时两现:早子时 0-1 点用当日干支,末尾晚子时 23-24 点
  // 干支已进位)——取前 12 项,与本组件农历/宜忌/生肖的「今日干支」口径一致,
  // 23 点与 0 点的用户看到同一张表。
  const hours = lunar.getTimes().slice(0, 12).map((t) => ({
    zhi: t.getZhi(),
    luck: t.getTianShenLuck() as '吉' | '凶',
    tianShen: t.getTianShen(),
    dao: t.getTianShenType() === '黑道' ? ('黑道' as const) : ('黄道' as const),
  }))
  const xingZuo = Solar.fromDate(date).getXingZuo()
  return {
    lunarText: `${lunar.getYearInGanZhi()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    lunarYear: lunar.getYear(),
    yearShengXiao: lunar.getYearShengXiao(),
    term: term || undefined,
    yi: pick(fullYi),
    ji: pick(fullJi),
    fullYi,
    fullJi,
    hours,
    xingZuo,
  }
}
