import { describe, expect, it } from 'vitest'
import {
  KLINE_RANGES,
  klineChartModel,
  latestDayOnly,
  nearestIndex,
  parseKlines,
  parsePreClose,
  type KlinePoint,
} from './kline'

// K 线区纯函数接缝:时间档位声明(KLINE_RANGES)、响应解析(parseKlines)、
// 图型决策(klineChartModel)。数据来自东财 push2his,fields2=f51,f53 → 每行 "日期,收盘价"。无 DOM。

describe('KLINE_RANGES — 时间档位声明表', () => {
  it('四档,短→长(胶囊顺序即声明序)', () => {
    expect(Object.keys(KLINE_RANGES)).toEqual(['day', '1m', '1y', 'all'])
  })

  it('仅当日档是分时;轮询仅当日档——档位谓词的唯一真源', () => {
    expect(KLINE_RANGES.day.intraday).toBe(true)
    expect(KLINE_RANGES['1m'].intraday).toBe(false)
    expect(KLINE_RANGES['1y'].intraday).toBe(false)
    expect(KLINE_RANGES.all.intraday).toBe(false)
    expect(KLINE_RANGES.day.refetchInterval).toBe(60_000)
    expect(KLINE_RANGES['1m'].refetchInterval).toBeUndefined()
    expect(KLINE_RANGES['1y'].refetchInterval).toBeUndefined()
    expect(KLINE_RANGES.all.refetchInterval).toBeUndefined()
  })

  it('日线三档共用 klt=101,day 走 1 分钟线', () => {
    expect(KLINE_RANGES.day.klt).toBe(1)
    expect(KLINE_RANGES['1m'].klt).toBe(101)
    expect(KLINE_RANGES['1y'].klt).toBe(101)
    expect(KLINE_RANGES.all.klt).toBe(101)
  })
})

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

  it('data 缺失 / klines 空 / 非对象 → []', () => {
    expect(parseKlines({ data: { klines: [] } })).toEqual([])
    expect(parseKlines({ data: {} })).toEqual([])
    expect(parseKlines({})).toEqual([])
    expect(parseKlines(null)).toEqual([])
  })
})

// parsePreClose — 分时档昨收(响应级 data.preKPrice,与序列同一前复权口径)。

describe('parsePreClose — 响应级昨收', () => {
  it('正常:数值与字符串数形态都取到', () => {
    expect(parsePreClose({ data: { preKPrice: 1299.56 } })).toBe(1299.56)
    expect(parsePreClose({ data: { preKPrice: '1299.56' } })).toBe(1299.56)
  })

  it('缺失 / 非数 / 0 / 畸形响应 → null(消费端按昨收未到退化)', () => {
    expect(parsePreClose({ data: {} })).toBeNull()
    expect(parsePreClose({ data: { preKPrice: 'abc' } })).toBeNull()
    expect(parsePreClose({ data: { preKPrice: Infinity } })).toBeNull()
    expect(parsePreClose({ data: { preKPrice: 0 } })).toBeNull()
    expect(parsePreClose({})).toBeNull()
    expect(parsePreClose(null)).toBeNull()
  })
})

// klineChartModel — 图型决策按档位分派。调用方无脑传 prevClose,消费与否由声明裁决:
// 「日线不叠昨收(并入会改写 y 域与涨跌语义,e20c581 实锤)」在此钉死为回归锚。

describe('klineChartModel — 分时档(当日)', () => {
  const pts: KlinePoint[] = [
    { date: '2026-09-02 09:31', close: 10 },
    { date: '2026-09-02 09:32', close: 10.5 },
    { date: '2026-09-02 09:33', close: 9.8 },
  ]

  it('昨收到位:锚=昨收,y 域并入锚(基准虚线防裁),悬浮基恒昨收', () => {
    const m = klineChartModel(pts, 'day', 10.2)
    expect(m.anchor).toBe(10.2)
    expect(m.domainMin).toBe(9.8)
    expect(m.domainMax).toBe(10.5) // 昨收 10.2 在序列范围内,域不变
    expect(m.baseline).toBe(10.2)
    expect(m.hoverBase(0)).toBe(10.2)
    expect(m.hoverBase(2)).toBe(10.2)
    expect(m.time('2026-09-02 09:31')).toBe('09:31')
  })

  it('昨收超出序列范围:并入 y 域防虚线被裁', () => {
    const m = klineChartModel(pts, 'day', 12)
    expect(m.domainMax).toBe(12)
  })

  it('昨收未到(quotes 未返回,null):锚退化首根,虚线与悬浮 % 静默省缺', () => {
    const m = klineChartModel(pts, 'day', null)
    expect(m.anchor).toBe(10)
    expect(m.baseline).toBeNull()
    expect(m.hoverBase(1)).toBeNull()
  })

  it('空序列:域回 0 不出 Infinity/NaN(导出接缝对下一调用方的防护,同 nearestIndex 口径)', () => {
    const m = klineChartModel([], '1y', null)
    expect(m.domainMin).toBe(0)
    expect(m.domainMax).toBe(0)
    expect(m.anchor).toBe(0)
    expect(m.hoverBase(0)).toBeNull()
  })

  it('涨跌基为 0(上游畸形)作缺失:不出 Infinity%', () => {
    const zeros: KlinePoint[] = [
      { date: '2026-08-10', close: 0 },
      { date: '2026-08-11', close: 5 },
    ]
    expect(klineChartModel(zeros, '1y', null).hoverBase(1)).toBeNull()
    expect(klineChartModel(pts, 'day', 0).hoverBase(1)).toBeNull()
    // baseline 是机械透传,不在此拒 0——preKPrice=0 已被 parsePreClose 拒,到不了 model
  })
})

describe('klineChartModel — 日线档(近一月/近一年/全部)', () => {
  const pts: KlinePoint[] = [
    { date: '2026-08-10', close: 10 },
    { date: '2026-08-11', close: 10.5 },
    { date: '2026-08-12', close: 9.8 },
  ]

  it('e20c581 回归锚:调用方无脑传昨收也不被消费——锚恒首根,y 域不含昨收', () => {
    const m = klineChartModel(pts, '1y', 12) // 12 超出序列范围:若被并入即 bug
    expect(m.anchor).toBe(10)
    expect(m.domainMax).toBe(10.5)
    expect(m.domainMin).toBe(9.8)
    expect(m.baseline).toBeNull()
    expect(m.time('2026-08-10')).toBe('2026-08-10')
  })

  it('悬浮涨跌基对前一根,首根无基(无 %)', () => {
    const m = klineChartModel(pts, '1y', null)
    expect(m.hoverBase(0)).toBeNull()
    expect(m.hoverBase(1)).toBe(10)
    expect(m.hoverBase(2)).toBe(10.5)
  })

  it('全平序列:域两端相等(组件防除零的输入)', () => {
    const flat: KlinePoint[] = [
      { date: '2026-08-10', close: 5 },
      { date: '2026-08-11', close: 5 },
    ]
    const m = klineChartModel(flat, '1m', null)
    expect(m.domainMin).toBe(5)
    expect(m.domainMax).toBe(5)
  })
})

// latestDayOnly — 当日(1 分钟)档:只留最新一个交易日的根。东财按根数回溯,
// 周一早盘请求会混入上一交易日尾段,解析层单点截掉(component 不做防御)。

describe('latestDayOnly — 只留最新交易日的根', () => {
  it('混入上一交易日尾段:按末根日期截当日', () => {
    const pts = [
      { date: '2026-09-01 14:59', close: 10 },
      { date: '2026-09-01 15:00', close: 10.1 },
      { date: '2026-09-02 09:30', close: 10.2 },
      { date: '2026-09-02 09:31', close: 10.3 },
    ]
    expect(latestDayOnly(pts)).toEqual([
      { date: '2026-09-02 09:30', close: 10.2 },
      { date: '2026-09-02 09:31', close: 10.3 },
    ])
  })

  it('全部同一天(盘后完整分时)→ 原样返回', () => {
    const pts = [
      { date: '2026-09-02 09:30', close: 10 },
      { date: '2026-09-02 11:30', close: 10.5 },
      { date: '2026-09-02 15:00', close: 11 },
    ]
    expect(latestDayOnly(pts)).toEqual(pts)
  })

  it('空数组 → []', () => {
    expect(latestDayOnly([])).toEqual([])
  })
})

// nearestIndex — 悬浮定位:指针横轴像素 → 最近一根的下标(x 均分铺满容器宽)。

describe('nearestIndex — 指针像素→最近根下标', () => {
  it('正中落在中点下标', () => {
    expect(nearestIndex(150, 300, 5)).toBe(2)
  })

  it('就近取整:偏左归左根、过半归右根', () => {
    expect(nearestIndex(100, 300, 5)).toBe(1) // 1.33 → 1
    expect(nearestIndex(140, 300, 5)).toBe(2) // 1.87 → 2
  })

  it('两端钳制:0 与超界都落在首末根', () => {
    expect(nearestIndex(0, 300, 5)).toBe(0)
    expect(nearestIndex(-20, 300, 5)).toBe(0)
    expect(nearestIndex(320, 300, 5)).toBe(4)
  })

  it('n≤1 → 恒 0(单点/空序列不出 NaN)', () => {
    expect(nearestIndex(123, 300, 1)).toBe(0)
    expect(nearestIndex(123, 300, 0)).toBe(0)
  })
})
