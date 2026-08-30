import { useMemo, useState } from 'react'
import type { ImportantDate } from 'chrome-tab-shared'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { useUpdateLayoutSettings } from '../api/config'
import { describeDays, getAllCountdowns } from '../lib/countdown'
import useNow from '../hooks/useNow'
import type { TabItem } from '../lib/detailModalState'
import type { Icon } from '../lib/types'
import ConfirmButton from './ConfirmButton'
import DetailModal from './DetailModal'

/**
 * 倒计时详情 Modal(CONTEXT.md「倒计时」,双 tab):点块打开(detailEntry:'block')。
 * 「重要日子」tab(默认)可编辑——「重要日子」编辑的**全局唯一入口**(自时钟 hover
 * 弹层迁入),列表 CRUD 每动作即时整份 PUT(useUpdateLayoutSettings,与布局草稿同一
 * 持久化通道),不设草稿暂存——列表 ≤100 条,PUT 轻量,即时反馈免掉「保存/放弃」
 * 两层状态;「节假日」tab 只读——内置清单从今天起按剩余天数升序,行附当年公历
 * 日期(查「春节是哪天」的主诉求),恰逢当天的条目 accent 高亮。
 * 数据寄放布局设置(ADR-0026),无独立查询,不用骨架查询状态机。
 */

type CountdownTab = 'important' | 'holiday'
const TABS: readonly TabItem<CountdownTab>[] = [
  { key: 'important', label: '重要日子' },
  { key: 'holiday', label: '节假日' },
]

/** 表单草稿:日期拆年/月/日输入(annual 年份无意义,shared 契约语义)。 */
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

function toDraft(d: ImportantDate): Draft {
  const [year, month, day] = d.date.split('-')
  return { id: d.id, name: d.name, calendar: d.calendar, repeat: d.repeat, year, month, day }
}

/** 列表行副信息:annual 忽略年份(每年循环);once 带完整日期。 */
function describe(d: ImportantDate): string {
  const [, m, day] = d.date.split('-')
  if (d.repeat === 'once') return d.calendar === 'lunar' ? `${d.date}(农历)` : d.date
  return d.calendar === 'lunar' ? `每年农历 ${m}-${day}` : `每年公历 ${m}-${day}`
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
  const [tab, setTab] = useState<CountdownTab>('important')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // 节假日只读分区:从今天起升序(全量口径过滤内置源;年度滚年在全量侧已处理)。
  // 分钟级心跳 + 按天重算(跨零点翻新,dep 是日期键——同块内/弹层惯用法)
  const now = useNow(60_000)
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const holidays = useMemo(
    () => getAllCountdowns(now, []).filter((i) => i.source === 'holiday'),
    [dayKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Esc 关闭走 ModalShell 栈;表单态同样关——未保存即弃,无半提交状态

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
    <DetailModal
      onClose={onClose}
      ariaLabel="倒计时"
      width="sm"
      scroll
      className="p-5 text-sm text-white/90"
      title="倒计时"
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      {tab === 'important' ? (
        draft === null ? (
          <>
            <div className="space-y-1">
              {layout.importantDates.length === 0 && (
                <p className="text-xs text-white/50 py-2">暂无重要日子,点下方「添加」新建。</p>
              )}
              {layout.importantDates.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{d.name}</div>
                    <div className="text-xs text-white/50">{describe(d)}</div>
                  </div>
                  <button
                    type="button"
                    aria-label="编辑"
                    title="编辑"
                    onClick={() => { setDraft(toDraft(d)); setErr(null) }}
                    className="shrink-0 w-8 h-8 -mr-1.5 rounded-full text-white/50 hover:bg-white/20 hover:text-white/80 flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    ✎
                  </button>
                  <ConfirmButton
                    label={`删除 ${d.name}`}
                    title="删除"
                    disabled={save.isPending}
                    onConfirm={() => commit(layout.importantDates.filter((x) => x.id !== d.id))}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setDraft(emptyDraft); setErr(null) }}
              className="mt-3 min-h-8 px-3 py-1.5 rounded-full bg-white/20 text-xs text-white/85 hover:bg-white/30 transition focus-visible:outline-2 focus-visible:outline-white/60"
            >
              + 添加
            </button>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold mb-3">{draft.id ? '编辑重要日子' : '添加重要日子'}</div>
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
            <div className="mt-4 flex gap-2">
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
            </div>
          </>
        )
      ) : (
        /* ── 节假日(内置,只读:从今天起升序,行附当年公历日期;当天 accent)── */
        <div className="space-y-1">
          {holidays.map((h) => (
            <div
              key={h.key}
              className={`flex justify-between gap-x-8 text-xs rounded-lg px-3 py-2 ${
                h.days === 0 ? 'bg-accent/15' : ''
              }`}
            >
              <span className="text-white/70">
                {h.name}
                <span className={`ml-2 tabular-nums ${h.days === 0 ? 'text-accent' : 'text-white/40'}`}>
                  {h.date.getMonth() + 1}月{h.date.getDate()}日
                </span>
              </span>
              <span className={`tabular-nums ${h.days === 0 ? 'text-accent' : 'text-white/90'}`}>
                {describeDays(h.days)}
              </span>
            </div>
          ))}
        </div>
      )}
    </DetailModal>
  )
}
