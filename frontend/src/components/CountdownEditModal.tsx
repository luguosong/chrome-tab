import { useEffect, useState } from 'react'
import type { ImportantDate } from 'chrome-tab-shared'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { useUpdateLayoutSettings } from '../api/config'
import ConfirmButton from './ConfirmButton'

/**
 * 「重要日子」编辑 Modal(CONTEXT.md;倒计时的用户配置数据源,寄放布局设置 ADR-0026)。
 * 列表 CRUD 每动作即时整份 PUT(useUpdateLayoutSettings,与布局草稿同一持久化通道),
 * 不设草稿暂存——列表 ≤100 条,PUT 轻量,即时反馈免掉「保存/放弃」两层状态。
 * 入口在时钟 hover 弹层倒计时分区尾部(数据所在处,发现性优先)。
 */

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

export default function CountdownEditModal({ onClose }: { onClose: () => void }) {
  const layout = useLayoutSettings()
  const save = useUpdateLayoutSettings()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Esc 关闭(姊妹 Modal 共有基线;表单态同样关——未保存即弃,无半提交状态)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="重要日子">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <div className="glass-panel glass-panel-readable relative w-full max-w-sm rounded-3xl p-5 max-h-[80vh] overflow-y-auto modal-scroll animate-pop-in text-sm text-white/90">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-white/60"
        >
          ✕
        </button>

        {draft === null ? (
          <>
            <h2 className="text-lg font-semibold mb-3">重要日子</h2>
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
            <h2 className="text-lg font-semibold mb-3">{draft.id ? '编辑重要日子' : '添加重要日子'}</h2>
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
        )}
      </div>
    </div>
  )
}
