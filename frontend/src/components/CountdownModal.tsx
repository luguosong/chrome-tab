import { useMemo, useState } from 'react'
import type { ImportantDate } from 'chrome-tab-shared'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { useUpdateLayoutSettings } from '../api/config'
import { useHolidays } from '../api/holidays'
import { buildMonthGrid, holidaysInMonth, importantDatesInMonth, toIsoDate } from '../lib/countdown'
import useNow from '../hooks/useNow'
import type { Icon } from '../lib/types'
import ConfirmButton from './ConfirmButton'
import ModalShell from './ModalShell'

/**
 * 倒计时详情 Modal(CONTEXT.md「倒计时」,ADR-0054 日历化):点块打开
 * (detailEntry:'block'),打开即当月月历(原双 tab 撤)。格内三轴标记——休/班
 * 角标(法定安排,GET /api/holidays ics 上游;降级无标不报错)、节日名小字
 * (内置清单,含不放假的文化节日)、重要日子琥珀底(用户条目,编辑的**全局唯一
 * 入口**迁至格子点击;点空格不新建)。编辑表单沿用既有草稿态:每动作即时整份
 * PUT(useUpdateLayoutSettings,ADR-0026 布局设置通道),无草稿暂存;编辑态附
 * 删除(日历无行级 ✎,CRUD 完整性由此兜)。月视图数据是「当月内实例化」口径
 * (含已过),与块内/弹层的「下一次出现」语义(getAllCountdowns)分立。
 */

type Draft = {
  id: string | null // null = 新增
  name: string
  calendar: 'solar' | 'lunar'
  repeat: 'annual' | 'once'
  year: string
  month: string
  day: string
}

const emptyDraft: Draft = { id: null, name: '', calendar: 'solar', repeat: 'annual', year: '', month: '', day: '' }

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

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
              : 'bg-white/20 text-white/70 hover:bg-white/30')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function CountdownModal({ onClose }: { icon: Icon; onClose: () => void }) {
  const layout = useLayoutSettings()
  const save = useUpdateLayoutSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // 分钟级心跳 + 按天重算(今天格跨零点翻新;视图月默认打开当月,导航不回跳)
  const now = useNow(60_000)
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const todayIso = toIsoDate(now)
  const [view, setView] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }))
  const holidaysQuery = useHolidays()

  const grid = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month])

  // 格标记合成(同 iso 三源合并):休/班(ics)打底、节日名(内置)覆盖副行、
  // 重要日子置琥珀底(同日撞期个人优先;rest 转副行「休」提示不丢)。
  const marks = useMemo(() => {
    const map = new Map<string, { rest?: boolean; work?: boolean; holiday?: string; importantId?: string }>()
    for (const d of holidaysQuery.data?.days ?? []) {
      const m = map.get(d.date) ?? {}
      if (d.kind === 'rest') m.rest = true
      else m.work = true
      map.set(d.date, m)
    }
    for (const h of holidaysInMonth(view.year, view.month)) {
      const iso = toIsoDate(h.date)
      map.set(iso, { ...map.get(iso), holiday: h.name })
    }
    for (const i of importantDatesInMonth(layout.importantDates, view.year, view.month)) {
      const iso = toIsoDate(i.date)
      map.set(iso, { ...map.get(iso), importantId: i.id })
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.year, view.month, dayKey, holidaysQuery.data, layout.importantDates])

  const stepMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })

  async function commit(next: ImportantDate[]) {
    setErr(null)
    try {
      await save.mutateAsync({ ...layout, importantDates: next })
      setDraft(null)
    } catch {
      setErr('保存失败,请重试')
    }
  }

  function submitDraft() {
    if (!draft) return
    const name = draft.name.trim()
    const m = Number(draft.month)
    const day = Number(draft.day)
    if (!name) return setErr('名称不能为空')
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(day) || day < 1 || day > 31)
      return setErr('日期不完整')
    if (draft.repeat === 'once' && !/^\d{4}$/.test(draft.year)) return setErr('仅一次的日期需要年份')
    // annual 年份占位 2000(解析忽略);农历月日不查历表——非法组合在倒计时侧静默跳过
    const date = `${draft.year || '2000'}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const item: ImportantDate = {
      id: draft.id ?? crypto.randomUUID(),
      name,
      date,
      calendar: draft.calendar,
      repeat: draft.repeat,
    }
    commit([...layout.importantDates.filter((x) => x.id !== item.id), item])
  }

  return (
    <ModalShell onClose={onClose} ariaLabel="倒计时" width="sm" scroll className="p-5 text-sm text-white/90">
      {draft === null ? (
        <>
          <div className="flex items-center justify-between gap-2 mb-3 pr-10">
            <div className="text-sm font-semibold shrink-0">倒计时</div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="上一月"
                onClick={() => stepMonth(-1)}
                className="w-7 h-7 rounded-full text-white/60 hover:bg-white/20 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
              >
                ‹
              </button>
              <span className="tabular-nums text-xs text-white/70 min-w-16 text-center">
                {view.year}年{view.month + 1}月
              </span>
              <button
                type="button"
                aria-label="下一月"
                onClick={() => stepMonth(1)}
                className="w-7 h-7 rounded-full text-white/60 hover:bg-white/20 hover:text-white flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
              >
                ›
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setDraft(emptyDraft); setErr(null) }}
              className="min-h-8 px-3 py-1.5 rounded-full bg-white/20 text-xs text-white/85 hover:bg-white/30 transition focus-visible:outline-2 focus-visible:outline-white/60"
            >
              + 添加
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1 text-center text-[10px] text-white/40">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-0.5">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell) => {
              const m = marks.get(cell.iso)
              const importantId = m?.importantId
              const sub = m?.holiday ?? (m?.rest ? '休' : m?.work ? '班' : '')
              return (
                <button
                  key={cell.iso}
                  type="button"
                  disabled={!importantId}
                  title={importantId ? '编辑' : undefined}
                  onClick={() => {
                    const d = layout.importantDates.find((x) => x.id === importantId)
                    if (d) { setDraft(toDraft(d)); setErr(null) }
                  }}
                  className={`h-9 rounded-lg text-xs transition-colors focus-visible:outline-2 focus-visible:outline-white/60 ${
                    cell.inMonth ? '' : 'opacity-30'
                  } ${
                    importantId
                      ? 'bg-amber-300/15 hover:bg-amber-300/30 cursor-pointer'
                      : m?.rest
                        ? 'bg-accent/15'
                        : 'bg-white/[0.04]'
                  } ${cell.iso === todayIso ? 'ring-1 ring-accent font-semibold' : ''}`}
                >
                  {cell.day}
                  {sub && (
                    <span
                      className={`block text-[9px] leading-none truncate px-0.5 ${
                        m?.holiday ? 'text-white/55' : m?.rest ? 'text-accent' : 'text-white/50'
                      }`}
                    >
                      {sub}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <>
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
              onClick={() => { setDraft(null); setErr(null) }}
              className="min-h-8 px-4 py-1.5 rounded-full bg-white/20 text-white/85 hover:bg-white/30 transition focus-visible:outline-2 focus-visible:outline-white/60"
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
        </>
      )}
    </ModalShell>
  )
}
