import { useEffect, useMemo, useState } from 'react'
import { getAlmanac } from '../lib/lunar'
import { useLayoutSettings } from '../context/LayoutSettingsContext'

/** 生肖轮固定序(0=鼠)与地支序一一对应;本命年 = 农历年回退到该生肖最近年份 */
const ZODIAC = '鼠牛虎兔龙蛇马羊猴鸡狗猪'.split('')
const BRANCH = '子丑寅卯辰巳午未申酉戌亥'.split('')
/** 十二时辰钟点范围(子起,传统横跨午夜的写法),title 详注用 */
const HOUR_RANGE = ['23-1', '1-3', '3-5', '5-7', '7-9', '9-11', '11-13', '13-15', '15-17', '17-19', '19-21', '21-23']
/** 黄道十二宫(黄道序,白羊起):名称与公历区间。名称须与 Solar.getXingZuo()
 *  返回的简称一致(高亮比对口径)。曾用星座符号(♈…)取同构之形,实测辨识度
 *  不足被否——信息直达优先于形式同构,改直排文字。 */
const XINGZUO = [
  { name: '白羊', range: '3.21-4.19' },
  { name: '金牛', range: '4.20-5.20' },
  { name: '双子', range: '5.21-6.21' },
  { name: '巨蟹', range: '6.22-7.22' },
  { name: '狮子', range: '7.23-8.22' },
  { name: '处女', range: '8.23-9.22' },
  { name: '天秤', range: '9.23-10.23' },
  { name: '天蝎', range: '10.24-11.22' },
  { name: '射手', range: '11.23-12.21' },
  { name: '摩羯', range: '12.22-1.19' },
  { name: '水瓶', range: '1.20-2.18' },
  { name: '双鱼', range: '2.19-3.20' },
]

/** 顶部时钟:iOS 锁屏式大字裸排(不上玻璃),双层 text-shadow 保可读 —— 暗晕压住
 *  亮壁纸 + 1px 白光提字重(原型 prototype/liquid-glass @3f10ddf 定稿)。
 *  字号(clockFont)与时制(clock24h)来自「布局设置」;字号只作用大字时间行,
 *  日期小行不随动。显隐由 DashboardPage 按 clockVisible 控制挂载。
 *  常显仅时间/日期周几/农历三行(透明度梯度 85→70),生肖轮/星座轮/宜忌/时辰吉凶
 *  收进 hover 玻璃弹层:文本密集内容裸排壁纸上可读性差,落 glass-panel-readable
 *  (picker 族同款);absolute 不占布局流,展开不推挤任何内容。
 *  触屏无 hover 由 title 兜底(完整宜忌/生肖本命年,项目既有模式)。
 *  DashboardPage 侧本组件 absolute 出流,搜索框位置与时钟高度解耦。 */
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
    <div className="group relative select-none text-white">
      {/* 常显三行:text-shadow 收在内层,不随弹层继承 */}
      <div style={{ textShadow: '0 2px 12px rgba(0,0,0,0.45), 0 0 1px rgba(255,255,255,0.25)' }}>
        <div
          className="font-light tracking-tight leading-none tabular-nums"
          style={{ fontSize: clockFont }}
        >
          {time}
        </div>
        <small className="block text-xs font-light mt-1 opacity-85">
          {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 周{w}
        </small>
        <small className="block text-xs font-light mt-0.5 opacity-70">
          {almanac.lunarText}
          {almanac.term ? `(${almanac.term})` : ''}
        </small>
      </div>

      {/* hover 展层:生肖轮 + 宜忌。opacity-0 时 pointer-events-none,不挡下方图标;
          显形后恢复,生肖 title(本命年)可触发。过渡 200ms 轻于 Modal pop-in 档。 */}
      <div className="absolute top-full left-0 z-10 mt-2 w-max max-w-[70vw] rounded-2xl glass-panel glass-panel-readable px-3 py-2 text-xs font-light text-white/90 opacity-0 translate-y-1 pointer-events-none transition duration-200 group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto">
        <div className="flex gap-x-1.5">
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
        {/* 星座轮:太阳周期,与生肖轮(农历年)构成「年的十二分」双轮组,与生肖轮间
            不加分隔(同组)。双字名直排(gap 收窄保弹层紧凑),区间走 title;
            当前星座「点朱」(同生肖轮当年语汇,皆「循环中的当下」)。 */}
        <div className="mt-1 flex gap-x-1">
          {XINGZUO.map((x) => {
            const cur = x.name === almanac.xingZuo
            return (
              <span
                key={x.name}
                title={`${x.name}座 ${x.range}`}
                className={cur ? 'font-medium text-[#FF7A5C]' : 'text-white/45'}
              >
                {x.name}
              </span>
            )
          })}
        </div>

        {/* 宜忌:对立二元并置一行,细竖线分组(同组横线、异组竖线的分区语汇)。
            语义色:宜=emerald-300、忌=red-300(与错误文案红同档)——绿/红专职
            吉凶,朱红让位给生肖/星座「当下」标记,消解三处同色异义。 */}
        <div className="mt-1.5 pt-1.5 border-t border-white/10 grid grid-cols-2 gap-x-3">
          <div
            className="text-emerald-300"
            title={`宜:${almanac.fullYi.join(' ')} / 忌:${almanac.fullJi.join(' ')}`}
          >
            <span className="font-medium">宜</span> {almanac.yi.join(' ')}
          </div>
          <div
            className="border-l border-white/10 pl-3 text-red-300"
            title={`宜:${almanac.fullYi.join(' ')} / 忌:${almanac.fullJi.join(' ')}`}
          >
            <span className="font-medium">忌</span> {almanac.ji.join(' ')}
          </div>
        </div>

        {/* 时辰轮:与生肖轮同构(同为十二字一行,年循环/日循环呼应),信息从粗到细
            排在最末(年生肖→日宜忌→日内时辰)。吉=emerald-300、凶=red-300,
            与宜忌共用一套吉凶语义色;当前时辰白胶囊底——底色标「现在」、字色标
            「吉凶」,两维正交。槽位定宽(w-5)防胶囊高亮引起同行跳位。 */}
        <div className="mt-1.5 pt-1.5 border-t border-white/10 flex gap-x-0.5">
          {almanac.hours.map((h, i) => {
            const cur = i === ((now.getHours() + 1) >> 1) % 12
            return (
              <span
                key={h.zhi}
                title={`${h.zhi}时 ${HOUR_RANGE[i]}点 · ${h.tianShen}(${h.dao}) ${h.luck}`}
                className={`w-5 text-center rounded-full ${cur ? 'bg-white/20 font-medium' : ''} ${
                  h.luck === '吉' ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {h.zhi}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
