import { describe, expect, it } from 'vitest'
import { parseKlines, sparklinePoints } from './kline'

// K 线(收盘价序列)取数纯函数(见 CONTEXT.md「公司概述」K 线 / spec user story 11)。
// 数据来自东财 push2his,fields2=f51,f53 → 每行 "日期,收盘价"。无 DOM。

describe('parseKlines — 东财 push2his 响应→收盘价序列', () => {
  it('正常:每行第 0 列日期、第 1 列收盘', () => {
    // 数据为实测捕获的 600519(贵州茅台)收盘价,投影到 fields2=f51,f53 的两列响应形态。
    const raw = {
      data: {
        code: '600519',
        name: '贵州茅台',
        klines: ['2026-08-10,1348.86', '2026-08-11,1346.50', '2026-08-12,1339.10'],
      },
    }
    expect(parseKlines(raw)).toEqual([
      { date: '2026-08-10', close: 1348.86 },
      { date: '2026-08-11', close: 1346.5 },
      { date: '2026-08-12', close: 1339.1 },
    ])
  })

  it('畸形行(列不足/非数收盘/空行)跳过,不中断整段', () => {
    const raw = {
      data: {
        klines: [
          '2026-08-10,1348.86',
          '2026-08-11', // 缺收盘
          '2026-08-12,abc', // 非数
          '', // 空行
          '2026-08-13,1330.00',
        ],
      },
    }
    expect(parseKlines(raw)).toEqual([
      { date: '2026-08-10', close: 1348.86 },
      { date: '2026-08-13', close: 1330 },
    ])
  })

  it('max 截断:只保留最近 max 根(klines 为旧→新)', () => {
    const raw = { data: { klines: ['d1,1', 'd2,2', 'd3,3', 'd4,4', 'd5,5'] } }
    expect(parseKlines(raw, 3).map((p) => p.date)).toEqual(['d3', 'd4', 'd5'])
  })

  it('data 缺失 / klines 空 / 非对象 → []', () => {
    expect(parseKlines({ data: { klines: [] } })).toEqual([])
    expect(parseKlines({ data: {} })).toEqual([])
    expect(parseKlines({})).toEqual([])
    expect(parseKlines(null)).toEqual([])
  })
})

// sparklinePoints — 收盘序列→SVG polyline "x,y" 串(大尺寸 stock 小组件迷你走势)。
// 归一化铺满给定盒;等价 KlineChart 的防除零(全平→垂直居中)与单点(居中)约定。

describe('sparklinePoints — 收盘序列→迷你折线坐标', () => {
  it('正常:首末点贴 x 两端,极值贴 y 两端', () => {
    // 1→最低(y=h)、3→最高(y=0);坐标固定 2 位小数
    expect(sparklinePoints([1, 2, 3], 100, 30)).toBe('0.00,30.00 50.00,15.00 100.00,0.00')
  })

  it('全平(极差 0)→ 所有点垂直居中,不产生 NaN', () => {
    expect(sparklinePoints([5, 5, 5, 5], 100, 30)).toBe(
      '0.00,15.00 33.33,15.00 66.67,15.00 100.00,15.00',
    )
  })

  it('单点 → 居中', () => {
    expect(sparklinePoints([7], 100, 30)).toBe('50.00,15.00')
  })

  it('空序列 → 空串(渲染层隐藏 svg)', () => {
    expect(sparklinePoints([], 100, 30)).toBe('')
  })
})
