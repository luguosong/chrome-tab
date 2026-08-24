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
})
