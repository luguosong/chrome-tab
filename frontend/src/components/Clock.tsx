import { useEffect, useMemo, useState } from 'react'
import { getAlmanac } from '../lib/lunar'
import { useLayoutSettings } from '../context/LayoutSettingsContext'

/** 生肖轮固定序(0=鼠)与地支序一一对应;本命年 = 农历年回退到该生肖最近年份 */
const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪'.split('')
const BRANCH = '子丑寅卯辰巳午未申酉戌亥'.split('')

/** 顶部时钟:iOS 锁屏式大字裸排(不上玻璃),双层 text-shadow 保可读 —— 暗晕压住
 *  亮壁纸 + 1px 白光提字重(原型 prototype/liquid-glass @3f10ddf 定稿)。
 *  字号(clockFont)与时制(clock24h)来自「布局设置」;字号只作用大字时间行,
 *  日期小行不随动。显隐由 DashboardPage 按 clockVisible 控制挂载。
 *  日期行附农历(逢节气括号附注),第三行宜忌各 3 条、title 承载完整列表(lib/lunar)。
 *  每信息独立一行:时间/日期周几/农历/宜/忌五行,层级靠透明度梯度 85→70→60。
 *  农历后附十二生肖轮:年循环罗盘,非当年白 45 沉底、当年「点朱」(朱红+中黑体)
 *  跳出;地支对应与本命年(title)hover 可得。 */
export default function Clock() {
  const { clockFont, clock24h } = useLayoutSettings()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000) // 10s：分钟级精度足够
    return () => clearInterval(t)
  }, [])
  const time = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !clock24h,
  })
  const w = '日一二三四五六'[now.getDay()]
  // 农历/宜忌按天重算:dep 是日期键而非 now,10s 心跳不触发
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const almanac = useMemo(() => getAlmanac(now), [dayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      className="text-white select-none"
      style={{ textShadow: '0 2px 12px rgba(0,0,0,0.45), 0 0 1px rgba(255,255,255,0.25)' }}
    >
      <div
        className="font-light tracking-tight leading-none tabular-nums"
        style={{ fontSize: clockFont }}
      >
        {time}
      </div>
      {/* 每信息独立一行;层级靠透明度梯度:日期(主)→ 农历(语境)→ 宜忌(趣味)渐虚 */}
      <small className="block text-xs font-light mt-1 opacity-85">
        {now.getMonth() + 1}月{now.getDate()}日 周{w}
      </small>
      <small className="block text-xs font-light mt-0.5 opacity-70">
        {almanac.lunarText}
        {almanac.term ? `(${almanac.term})` : ''}
      </small>
      <div className="mt-0.5 flex gap-x-2 text-xs font-light">
        {ZODIAC.map((z, i) => {
          const cur = z === almanac.yearShengXiao
          // 该生肖最近的过去本命年(农历年口径,正月初一前不跳年)
          const benMing = almanac.lunarYear - ((almanac.lunarYear - 4 - i) % 12)
          return (
            <span
              key={z}
              title={`${BRANCH[i]}${z} · ${benMing} 本命年`}
              className={cur ? 'font-medium text-[#FF7A5C]' : 'text-white/45'}
            >
              {z}
            </span>
          )
        })}
      </div>
      <small
        className="block text-xs font-light mt-0.5 opacity-60"
        title={`宜:${almanac.fullYi.join(' ')} / 忌:${almanac.fullJi.join(' ')}`}
      >
        宜 {almanac.yi.join(' ')}
      </small>
      <small
        className="block text-xs font-light mt-0.5 opacity-60"
        title={`宜:${almanac.fullYi.join(' ')} / 忌:${almanac.fullJi.join(' ')}`}
      >
        忌 {almanac.ji.join(' ')}
      </small>
    </div>
  )
}
