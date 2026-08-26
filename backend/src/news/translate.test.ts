import { describe, expect, it } from 'vitest'
import { buildNumberedList, parseNumberedTranslations } from './translate'

/** 纯函数接缝测试(ADR-0029):编号配对、漏行/畸行 null、围栏与空行宽容。HTTP 候选链
 * 不单测——同 changelog translateSegment 先例,靠 NewsService 假 deps 集成覆盖。 */
describe('parseNumberedTranslations', () => {
  it('正常逐条配对', () => {
    expect(parseNumberedTranslations('1. 甲\n2. 乙\n3. 丙', 3)).toEqual(['甲', '乙', '丙'])
  })

  it('漏行该条 null(下轮重试)', () => {
    expect(parseNumberedTranslations('1. 甲\n3. 丙', 3)).toEqual(['甲', null, '丙'])
  })

  it('乱序行按序号归位', () => {
    expect(parseNumberedTranslations('2. 乙\n1. 甲', 2)).toEqual(['甲', '乙'])
  })

  it('剥代码围栏与空行', () => {
    const out = parseNumberedTranslations('```\n\n1. 甲\n\n2. 乙\n```', 2)
    expect(out).toEqual(['甲', '乙'])
  })

  it('带语言标注的围栏行也剥', () => {
    expect(parseNumberedTranslations('```text\n1. 甲\n```', 1)).toEqual(['甲'])
  })

  it('超范围序号忽略;全畸零配对', () => {
    expect(parseNumberedTranslations('0. 零\n1. 甲\n9. 九', 2)).toEqual(['甲', null])
    expect(parseNumberedTranslations('抱歉我无法翻译', 2)).toEqual([null, null])
  })

  it('中文序号分隔符与全角冒号宽容', () => {
    expect(parseNumberedTranslations('1、甲\n2:乙\n3:丙', 3)).toEqual(['甲', '乙', '丙'])
  })

  it('count 为 0 恒空数组', () => {
    expect(parseNumberedTranslations('1. 甲', 0)).toEqual([])
  })

  it('构造↔解析对偶:忠实回显序号的批全额配对(回归:全局连续编号第二批恒空)', () => {
    // 任意一批(含 >20 条切批后的第二批形态):模型按输入序号回显译文
    const batches = [
      Array.from({ length: 20 }, (_, i) => `title-${i}`), // 第一批满批
      Array.from({ length: 7 }, (_, i) => `title-${20 + i}`), // 第二批残余
    ]
    for (const batch of batches) {
      const echoed = buildNumberedList(batch.map((t) => `译(${t})`))
      expect(parseNumberedTranslations(echoed, batch.length).every((t) => t != null)).toBe(true)
    }
  })
})
