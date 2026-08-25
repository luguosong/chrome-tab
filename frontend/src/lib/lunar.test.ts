import { describe, expect, it } from 'vitest'
import { getAlmanac } from './lunar'

// 对拍基准:2026-08-24 = 农历丙午年七月十二(庚午日)已经便民查询网/老黄历双源核对;
// 宜忌为《协纪辨方书》表序(lunar-typescript 内置)。断言变动 = 库数据变更,须人工复核。
describe('getAlmanac', () => {
  it('2026-08-24:农历、无节气、白名单优选前 3(古语词沉底)', () => {
    const a = getAlmanac(new Date(2026, 7, 24))
    expect(a.lunarText).toBe('丙午年七月十二')
    expect(a.term).toBeUndefined()
    // 原序:嫁娶 纳采 订盟 开光 祭祀 …——纳采/订盟未命中白名单,开光/祭祀提上来
    expect(a.yi).toEqual(['嫁娶', '开光', '祭祀'])
    // 原序:入宅 上梁 入殓 盖屋 探病 …——入殓/盖屋沉底
    expect(a.ji).toEqual(['入宅', '上梁', '探病'])
    expect(a.fullYi.length).toBeGreaterThan(a.yi.length)
    expect(a.fullJi.length).toBeGreaterThan(a.ji.length)
  })

  it('节气日:2026-08-23 = 七月十一,逢处暑附注', () => {
    const a = getAlmanac(new Date(2026, 7, 23))
    expect(a.lunarText).toBe('丙午年七月十一')
    expect(a.term).toBe('处暑')
  })

  it('时辰吉凶:十二时辰子起亥终,吉凶二值且天神黄黑道匹配', () => {
    const a = getAlmanac(new Date(2026, 7, 24))
    expect(a.hours.map((h) => h.zhi).join('')).toBe('子丑寅卯辰巳午未申酉戌亥')
    for (const h of a.hours) {
      expect(['吉', '凶']).toContain(h.luck)
      expect(h.dao).toBe(h.luck === '吉' ? '黄道' : '黑道')
    }
    // 对拍基准:2026-08-24(庚午日)子时金匮(黄道吉)、寅时白虎(黑道凶),
    // 已与全民万年历当日时辰表核对(子金匮/丑天德一致)
    expect(a.hours[0]).toMatchObject({ zhi: '子', luck: '吉', tianShen: '金匮' })
    expect(a.hours[2]).toMatchObject({ zhi: '寅', luck: '凶', tianShen: '白虎' })
  })

  it('星座:公历边界日正确(狮子/处女分界、摩羯跨年)', () => {
    // 边界对拍已与 Solar.getXingZuo 实测核对
    expect(getAlmanac(new Date(2026, 7, 22)).xingZuo).toBe('狮子')
    expect(getAlmanac(new Date(2026, 7, 23)).xingZuo).toBe('处女')
    expect(getAlmanac(new Date(2026, 11, 22)).xingZuo).toBe('摩羯')
    expect(getAlmanac(new Date(2027, 0, 20)).xingZuo).toBe('水瓶')
  })
})
