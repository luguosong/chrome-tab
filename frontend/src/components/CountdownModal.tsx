import { useMemo, useState } from 'react'
import type { ImportantDate } from 'chrome-tab-shared'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { useUpdateLayoutSettings } from '../api/config'
import { useHolidays } from '../api/holidays'
import {
  buildCellMarks,
  buildMonthGrid,
  cellModel,
  draftToImportantDate,
  isoWeekNumber,
  toIsoDate,
  type CellMark,
  type ImportantDateDraft,
} from '../lib/countdown'
import useNow from '../hooks/useNow'
import type { Icon } from '../lib/types'
import ConfirmButton from './ConfirmButton'
import ModalShell from './ModalShell'

/**
 * 倒计时详情 Modal(CONTEXT.md「倒计时」,ADR-0054 日历化):点块打开
 * (detailEntry:'block'),打开即当月月历(原双 tab 撤),可切年视图(4×3 月份壁,
 * 点卡钻取进月)。格内三轴标记——休/班角标(法定安排,GET /api/holidays ics 上游;
 * 降级无标不报错)、节日名小字(内置清单,含不放假的文化节日)、重要日子琥珀底
 * (用户条目,编辑的**全局唯一入口**迁至格子点击;点空格不新建)。配色语义轴:
 * 休=深绿、班=红、周末=淡绿(2026-09-03 用户定案;补班多落周末,红须盖过绿)。
 * 编辑表单沿用既有草稿态:每动作即时整份 PUT(useUpdateLayoutSettings,ADR-0026
 * 布局设置通道),无草稿暂存;编辑态附删除(日历无行级 ✎,CRUD 完整性由此兜)。
 * 月视图数据是「当月内实例化」口径(含已过),与块内/弹层的「下一次出现」语义
 * (getAllCountdowns)分立。
 */

/** 表单草稿类型随格语义同居 lib/countdown.ts(ADR-0056),import 别名保持本文件
 *  既有 Draft 引用零改动。 */
type Draft = ImportantDateDraft

const emptyDraft: Draft = { id: null, name: '', calendar: 'solar', repeat: 'annual', year: '', month: '', day: '' }

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const
const CN_MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'] as const
/** 年视图铺开范围(buildCellMarks months 参数)。 */
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i)

function toDraft(d: ImportantDate): Draft {
  const [year, month, day] = d.date.split('-')
  return { id: d.id, name: d.name, calendar: d.calendar, repeat: d.repeat, year, month, day }
}

/** 二选一胶囊组(触达 ≥32px,Liquid Glass 触达规范)。 */
function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (id: T) => void
  options: Array<{ id: T; label: string }>
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={
            'min-h-8 px-3 py-1.5 rounded-full text-xs transition-colors focus-visible:outline-2 focus-visible:outline-white/60 ' +
            (value === o.id
              ? 'bg-white/30 font-medium text-white'
              : 'bg-white/20 text-white/70 hover:bg-white/30 active:bg-white/40')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 年壁月卡:整卡可点钻取进月;迷你点阵复用 cellModel 色语(仅取 bg),仅当月内着色。 */
function YearMonthCard({
  year,
  month,
  marks,
  todayIso,
  isCurrentMonth,
  onPick,
}: {
  year: number
  month: number
  marks: Map<string, CellMark>
  todayIso: string
  isCurrentMonth: boolean
  onPick: () => void
}) {
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`${month + 1}月`}
      className="rounded-xl p-2 text-left bg-white/[0.03] hover:bg-white/[0.07] active:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
    >
      <div className={`text-xs mb-1.5 ${isCurrentMonth ? 'text-accent font-semibold' : 'text-white/70'}`}>
        {CN_MONTHS[month]}月
      </div>
      <div className="grid grid-cols-7 gap-[2px]">
        {grid.map((cell) => {
          const m = marks.get(cell.iso)
          return (
            <span
              key={cell.iso}
              className={`aspect-square rounded-[3px] text-[9px] leading-[1.4] flex items-center justify-center text-white/50 ${
                cell.inMonth ? cellModel(cell, m).bg : 'opacity-0'
              } ${cell.iso === todayIso ? 'ring-1 ring-accent font-semibold' : ''}`}
            >
              {cell.day}
            </span>
          )
        })}
      </div>
    </button>
  )
}

export default function CountdownModal({ onClose }: { icon: Icon; onClose: () => void }) {
  const layout = useLayoutSettings()
  const save = useUpdateLayoutSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // 分钟级心跳:todayIso(今天格 ring)跨零点翻新;视图月默认打开当月,导航不回跳
  const now = useNow(60_000)
  const todayIso = toIsoDate(now)
  const [mode, setMode] = useState<'month' | 'year'>('month')
  const [view, setView] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }))
  // 翻页方向:只由 ‹ ›(step)设向;切视图/钻取/归位/编辑进出均无空间语义,
  // 一律清零落回 pane-in(残留方向会在无关重挂载时朝错误方向误播)
  const [dir, setDir] = useState<-1 | 0 | 1>(0)
  const dirAnim = dir === 1 ? 'animate-page-next' : dir === -1 ? 'animate-page-prev' : 'animate-pane-in'
  const holidaysQuery = useHolidays()

  const grid = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month])

  // 年刻度(顶部进度行):全年真实毫秒口径(闰年自动);round 后字/条同源一致
  const yearPct = Math.round(
    ((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) /
      (new Date(now.getFullYear() + 1, 0, 1).getTime() - new Date(now.getFullYear(), 0, 1).getTime())) * 100,
  )

  // 格标记合成单点于 lib/buildCellMarks(ADR-0056):同日撞期三源共存,谁赢由
  // cellModel 优先级定;年视图铺开全年 12 月,ics 全量平铺直接入 map(~500 条)。
  const marks = useMemo(
    () =>
      buildCellMarks(
        holidaysQuery.data?.days ?? [],
        view.year,
        mode === 'year' ? ALL_MONTHS : [view.month],
        layout.importantDates,
      ),
    [mode, view.year, view.month, holidaysQuery.data, layout.importantDates],
  )

  const step = (delta: -1 | 1) => {
    setDir(delta)
    setView((v) => {
      if (mode === 'year') return { year: v.year + delta, month: v.month }
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  const pickMonth = (mo: number) => {
    setDir(0)
    setView((v) => ({ ...v, month: mo }))
    setMode('month')
  }

  /** 归位当月并切月视图(年视图下点「今天」= 直接跳月视图;已在当月则幂等)。 */
  const goToday = () => {
    setDir(0)
    setView({ year: now.getFullYear(), month: now.getMonth() })
    setMode('month')
  }

  async function commit(next: ImportantDate[]) {
    setErr(null)
    try {
      await save.mutateAsync({ ...layout, importantDates: next })
      setDir(0)
      setDraft(null)
    } catch {
      setErr('保存失败,请重试')
    }
  }

  function submitDraft() {
    if (!draft) return
    const r = draftToImportantDate(draft)
    if (!r.ok) return setErr(r.error)
    commit([...layout.importantDates.filter((x) => x.id !== r.item.id), r.item])
  }

  return (
    <ModalShell onClose={onClose} ariaLabel="倒计时" width="3xl" scroll className="p-5 text-sm text-white/90">
      {draft === null ? (
        <>
          <div className="flex items-center justify-between gap-2 mb-4 pr-10">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label={mode === 'year' ? '上一年' : '上一月'}
                onClick={() => step(-1)}
                className="w-8 h-8 rounded-full text-white/60 hover:bg-white/20 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
              >
                ‹
              </button>
              <div className="text-lg font-semibold tabular-nums min-w-28 text-center">
                {view.year}年{mode === 'month' && `${view.month + 1}月`}
              </div>
              <button
                type="button"
                aria-label={mode === 'year' ? '下一年' : '下一月'}
                onClick={() => step(1)}
                className="w-8 h-8 rounded-full text-white/60 hover:bg-white/20 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
              >
                ›
              </button>
              <button
                type="button"
                onClick={goToday}
                className="ml-1 min-h-8 px-3 py-1.5 rounded-full bg-white/20 text-xs text-white/85 hover:bg-white/30 active:bg-white/40 transition focus-visible:outline-2 focus-visible:outline-white/60"
              >
                今天
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Seg
                value={mode}
                onChange={(m) => { setDir(0); setMode(m) }}
                options={[
                  { id: 'month', label: '月' },
                  { id: 'year', label: '年' },
                ]}
              />
              <button
                type="button"
                onClick={() => { setDraft(emptyDraft); setErr(null) }}
                className="min-h-8 px-3 py-1.5 rounded-full bg-white/20 text-xs text-white/85 hover:bg-white/30 active:bg-white/40 transition focus-visible:outline-2 focus-visible:outline-white/60"
              >
                + 添加
              </button>
            </div>
          </div>
          {/* 年刻度行(年层标尺,不随 ‹ › 翻页滑):ISO 周数 + 年进度;中性白透明阶,
              不借休/班绿红与琥珀(色语义专职);分钟心跳已驱动,跨周/跨年自翻 */}
          <div className="flex items-center gap-3 mb-2 text-[11px] text-white/45">
            <span className="shrink-0 tabular-nums">第 {isoWeekNumber(now)} 周</span>
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-white/25" style={{ width: `${yearPct}%` }} />
            </div>
            <span className="shrink-0 tabular-nums">已过 {yearPct}%</span>
          </div>
          {/* ‹ › 翻页按 dir 方向滑动,切视图/钻取/归位落 pane-in(key 变重挂载
              重播;旧态瞬消新态淡入,连点不叠双曝) */}
          {mode === 'month' ? (
            <div key={`m${view.year}-${view.month}`} className={dirAnim}>
              <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[11px] text-white/40">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1">{w}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {grid.map((cell) => {
                  const m = marks.get(cell.iso)
                  const v = cellModel(cell, m)
                  const importantId = m?.importantId
                  // subline 是惰性 getter,局部化一次读取(渲染两用会各触发一次农历推算)
                  const sub = v.subline
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      disabled={!v.clickable}
                      title={v.clickable ? '编辑' : undefined}
                      onClick={() => {
                        const d = layout.importantDates.find((x) => x.id === importantId)
                        if (d) { setDraft(toDraft(d)); setErr(null) }
                      }}
                      className={`relative h-12 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-white/60 ${
                        cell.inMonth ? '' : 'opacity-30'
                      } ${v.clickable ? `${v.bg} hover:bg-amber-300/30 active:bg-amber-300/40 cursor-pointer` : v.bg} ${
                        cell.iso === todayIso ? 'ring-1 ring-accent font-semibold' : ''
                      }`}
                    >
                      {cell.day}
                      {sub && (
                        <span className="block text-[10px] leading-tight truncate px-0.5 text-white/60">
                          {sub}
                        </span>
                      )}
                      {v.corner && (
                        <span
                          className={`absolute top-0.5 right-0.5 px-1 rounded text-[8px] leading-[1.5] text-white ${
                            v.corner === 'rest' ? 'bg-emerald-500' : 'bg-red-400'
                          }`}
                        >
                          {v.corner === 'rest' ? '休' : '班'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div key={`y${view.year}`} className={`${dirAnim} grid grid-cols-4 gap-2`}>
              {Array.from({ length: 12 }, (_, mo) => (
                <YearMonthCard
                  key={mo}
                  year={view.year}
                  month={mo}
                  marks={marks}
                  todayIso={todayIso}
                  isCurrentMonth={view.year === now.getFullYear() && mo === now.getMonth()}
                  onPick={() => pickMonth(mo)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="animate-pane-in max-w-sm mx-auto">
          <div className="text-sm font-semibold mb-3 pr-10">{draft.id ? '编辑重要日子' : '添加重要日子'}</div>
          <div className="space-y-3">
            <input
              autoFocus
              type="text"
              value={draft.name}
              maxLength={32}
              placeholder="名称(如:生日、纪念日)"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/50 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-white/50">历法</span>
              <Seg
                value={draft.calendar}
                onChange={(calendar) => setDraft({ ...draft, calendar })}
                options={[
                  { id: 'solar', label: '公历' },
                  { id: 'lunar', label: '农历' },
                ]}
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-white/50">重复</span>
              <Seg
                value={draft.repeat}
                onChange={(repeat) => setDraft({ ...draft, repeat })}
                options={[
                  { id: 'annual', label: '每年' },
                  { id: 'once', label: '仅一次' },
                ]}
              />
            </div>
            {draft.calendar === 'solar' ? (
              <label className="block">
                <span className="text-xs text-white/50">
                  日期{draft.repeat === 'annual' && '(年份仅参考,每年按月日循环)'}
                </span>
                <input
                  type="date"
                  value={draft.year && draft.month && draft.day ? `${draft.year}-${draft.month}-${draft.day}` : ''}
                  onChange={(e) => {
                    const [y = '', m = '', d = ''] = e.target.value.split('-')
                    setDraft({ ...draft, year: y, month: m, day: d })
                  }}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-white/20 text-white text-sm outline-none focus:ring-2 focus:ring-accent [color-scheme:dark]"
                />
              </label>
            ) : (
              <div>
                <span className="text-xs text-white/50">
                  农历日期{draft.repeat === 'annual' && '(每年按农历月日换算公历)'}
                </span>
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    placeholder={draft.repeat === 'annual' ? '每年' : '年'}
                    value={draft.year}
                    disabled={draft.repeat === 'annual'}
                    onChange={(e) => setDraft({ ...draft, year: e.target.value })}
                    className="w-24 px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/50 text-sm outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 [color-scheme:dark]"
                  />
                  <input
                    type="number"
                    placeholder="月(1-12)"
                    value={draft.month}
                    onChange={(e) => setDraft({ ...draft, month: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/50 text-sm outline-none focus:ring-2 focus:ring-accent [color-scheme:dark]"
                  />
                  <input
                    type="number"
                    placeholder="日(1-30)"
                    value={draft.day}
                    onChange={(e) => setDraft({ ...draft, day: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg bg-white/20 text-white placeholder-white/50 text-sm outline-none focus:ring-2 focus:ring-accent [color-scheme:dark]"
                  />
                </div>
              </div>
            )}
          </div>
          {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={save.isPending}
              onClick={submitDraft}
              className="min-h-8 px-4 py-1.5 rounded-full bg-accent/80 text-white text-xs hover:bg-accent transition disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white/60"
            >
              {save.isPending ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={() => { setDir(0); setDraft(null); setErr(null) }}
              className="min-h-8 px-4 py-1.5 rounded-full bg-white/20 text-white/85 hover:bg-white/30 active:bg-white/40 transition focus-visible:outline-2 focus-visible:outline-white/60"
            >
              取消
            </button>
            {draft.id && (
              <ConfirmButton
                label={`删除 ${draft.name}`}
                title="删除"
                disabled={save.isPending}
                onConfirm={() => commit(layout.importantDates.filter((x) => x.id !== draft.id))}
              />
            )}
          </div>
        </div>
      )}
    </ModalShell>
  )
}
