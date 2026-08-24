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
  return {
    lunarText: `${lunar.getYearInGanZhi()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    term: term || undefined,
    yi: pick(fullYi),
    ji: pick(fullJi),
    fullYi,
    fullJi,
  }
}
