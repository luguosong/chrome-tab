import { useEffect, useState, type ReactNode } from 'react'
import type { ModelEvaluationsStatus, ModelProviderId, TrackedModel } from 'chrome-tab-shared'
import { useModelArchive } from '../hooks/useModelArchive'
import { timeAgo } from '../lib/timeAgo'
import {
  AVAILABILITY_LABELS,
  EVALUATION_ATTRIBUTION,
  EVENT_KIND_LABELS,
  MODEL_KIND_COLOR_CLASSES,
  MODEL_KIND_LABELS,
  PROVIDER_LABELS,
  STAGE_LABELS,
  benchmarkLabel,
  compareModelsByRelease,
  formatReleaseBrief,
  formatModelPricing,
  formatEvaluationScore,
  isFreshModelEvent,
} from '../lib/modelTracking'

/**
 * 模型追踪详情 Modal(见 CONTEXT.md「模型追踪」,ADR-0022「更多」标头唯一入口):
 * 「全部」+ 各「跟踪厂家」tab;模型行在**当前 Modal 内就地展开**(摘要 + 限额/训练
 * 参数/价格/评测四张规格卡——值按语义着色,动态时间线与信源全宽,不套第二层 Modal),
 * 24h 新动态行首红点(时间驱动,无已读概念)。信源失败保留最后成功结果并标记陈旧
 * (CONTEXT.md「模型档案」)——头部给一行陈旧提示。容器:fixed 遮罩 + 居中玻璃面板;
 * Esc/点遮罩关闭,tab 为 TodoModal 同款下划线式。
 */
/** tab 维度 = 全部 + 各跟踪厂家(自 PROVIDER_LABELS 派生,厂家票扩 shared 时 tab 随动)。 */
type Tab = 'all' | ModelProviderId
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '全部' },
  ...(Object.keys(PROVIDER_LABELS) as ModelProviderId[]).map((p) => ({
    key: p,
    label: PROVIDER_LABELS[p],
  })),
]

export default function ModelModal({ onClose }: { onClose: () => void }) {
  const { data, isError, refetch, isFetching } = useModelArchive()
  const [tab, setTab] = useState<Tab>('all')
  /** 就地展开的模型行(同时只开一行,展开/收起即点击行头)。 */
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const staleSources = (data?.sources ?? []).filter((s) => s.stale)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="模型追踪"
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      <div className="glass-panel glass-panel-readable relative w-full max-w-lg rounded-3xl p-6 max-h-[80vh] overflow-y-auto modal-scroll animate-pop-in">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 text-white/80 hover:bg-white/40 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-white/60"
        >
          ×
        </button>

        <div className="mb-3">
          <h2 className="text-lg font-semibold text-white/90">模型追踪</h2>
          <div className="text-xs text-white/50">AI 模型档案与动态(官方一手信源)</div>
        </div>

        <div role="tablist" aria-label="模型追踪视图" className="flex gap-4 border-b border-white/10 mb-2">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              type="button"
              onClick={() => setTab(key)}
              className={
                'pb-1.5 -mb-px text-sm border-b-2 transition ' +
                (tab === key
                  ? 'text-accent border-accent'
                  : 'text-white/60 border-transparent hover:text-white/85')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {isError ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/60">档案刷新失败</span>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
            >
              刷新失败,重试
            </button>
          </div>
        ) : data === undefined ? (
          <div className="text-xs text-white/40 py-6 text-center">加载中…</div>
        ) : (
          <>
            {/* 陈旧标记(CONTEXT.md「模型档案」):单信源失败保留最后成功结果 */}
            {staleSources.length > 0 && (
              <div className="text-meta text-white/50 py-1.5">
                {staleSources
                  .map((s) => {
                    const at = s.lastSuccessAt ? `更新于 ${timeAgo(s.lastSuccessAt)}` : '尚未成功同步'
                    return `${PROVIDER_LABELS[s.provider]}源同步失败,展示最近数据(${at})`
                  })
                  .join('；')}
              </div>
            )}
            <ModelList
              // filter 返回新数组,直接原位排(不动 React Query 缓存)——上线发布时间优先
              //(2026-08-26 轴改),防「全部」被单一厂家的入库序垄断(2026-08-25 智谱 44 模型连排数屏)
              models={data.models
                .filter((m) => tab === 'all' || m.provider === tab)
                .sort(compareModelsByRelease)}
              evaluationStatus={data.evaluations}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** 模型行列表:行头(名称 + 厂家 + 种类·阶段·开放方式 + 最近动态)点击就地展开。 */
function ModelList({
  models,
  evaluationStatus,
  expandedId,
  onToggle,
}: {
  models: TrackedModel[]
  evaluationStatus: ModelEvaluationsStatus
  expandedId: number | null
  onToggle: (id: number) => void
}) {
  if (models.length === 0) {
    return <div className="text-sm text-white/50 py-6 text-center">暂无跟踪模型</div>
  }
  return (
    <ul className="space-y-1">
      {models.map((m) => {
        const open = expandedId === m.id
        const latest = m.events[0]
        /** 行尾发布简报(排序轴同源):更新动态不再抢占发布位,动态明细展开区可看。 */
        const releaseBrief = formatReleaseBrief(m)
        return (
          <li key={m.id} className="rounded-xl transition">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onToggle(m.id)}
              className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-white/10 transition"
            >
              <span className="flex items-baseline justify-between gap-3 min-w-0">
                <span className="flex min-w-0 items-center gap-1.5">
                  {latest && isFreshModelEvent(latest.occurredOn) && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden="true" />
                  )}
                  <span className="truncate text-sm text-white/90">{m.name}</span>
                  {m.stage === 'retired' && (
                    <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-meta text-white/55">
                      已退役
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-meta text-white/50">
                  {PROVIDER_LABELS[m.provider]}
                  <span className="ml-1.5" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                </span>
              </span>
              <span className="mt-0.5 flex items-baseline justify-between gap-3 min-w-0 text-meta text-white/50">
                <span className="min-w-0 truncate">
                  {/* 非文本模型种类词着色(映射语义见 modelTracking);文本类空串沿用本行灰 */}
                  <span className={MODEL_KIND_COLOR_CLASSES[m.kind] || undefined}>
                    {MODEL_KIND_LABELS[m.kind]}
                  </span>{' '}
                  · {STAGE_LABELS[m.stage]} ·{' '}
                  {m.availability.map((a) => AVAILABILITY_LABELS[a]).join('/')}
                </span>
                {releaseBrief && (
                  <span className="shrink-0 text-white/70">{releaseBrief}</span>
                )}
              </span>
            </button>
            {open && (
              <div className="px-3 pb-2.5 pt-0.5 space-y-2">
                {m.summary && (
                  <p className="text-sm text-white/65 leading-relaxed">{m.summary}</p>
                )}
                {/* 规格卡网格(issues/02):限额/参数/价格/评测各归一卡,值按语义着色
                    (钱=amber、技术边界=cyan、规模=violet、成绩=emerald;accent 蓝留给
                    交互链接,不与值色混)。未披露维度整卡占位——四卡位置恒定,便于扫读。 */}
                <div className="grid grid-cols-2 gap-1.5">
                  <SpecCard label="限额" empty={m.limits && m.limits.length > 0 ? null : '官方未披露'}>
                    {(m.limits ?? []).map((l) => (
                      <div key={`${l.label}|${l.scope}`}>
                        <span className="text-white/55">{l.label}</span>{' '}
                        <span className="font-mono text-cyan-300">{l.text}</span>
                        {l.scope && <span className="text-white/40">({l.scope})</span>}
                      </div>
                    ))}
                  </SpecCard>
                  <SpecCard label="训练参数" empty={m.trainingParams ? null : '官方未披露'}>
                    {m.trainingParams && (
                      <>
                        <div>
                          <span className="text-white/55">总参数</span>{' '}
                          <span className="font-mono text-violet-300">{m.trainingParams.total}</span>
                        </div>
                        {m.trainingParams.active && (
                          <div>
                            <span className="text-white/55">激活</span>{' '}
                            <span className="font-mono text-violet-300">
                              {m.trainingParams.active}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </SpecCard>
                  {(() => {
                    const pricing = formatModelPricing(m.pricing)
                    return (
                      <SpecCard
                        label={pricing ? `价格(${pricing.region})` : '价格'}
                        empty={pricing ? null : '官方未披露'}
                        className="col-span-2"
                      >
                        {pricing?.lines.map((line) => (
                          <div key={line} className="font-mono text-amber-300">
                            {line}
                          </div>
                        ))}
                      </SpecCard>
                    )
                  })()}
                  <EvaluationCard
                    evaluations={m.evaluations}
                    status={evaluationStatus}
                    className="col-span-2"
                  />
                </div>
                <div className="text-meta text-white/50 flex items-center gap-2 flex-wrap">
                  <span className="text-white/40">信源</span>
                  {m.sources.map((s) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-accent"
                    >
                      {s.title}
                    </a>
                  ))}
                </div>
                {m.events.length > 0 ? (
                  <ul className="space-y-1.5 border-t border-white/10 pt-2">
                    {m.events.map((e) => (
                      <li key={e.id} className="flex items-baseline gap-2 text-xs">
                        <span className="shrink-0 font-mono text-white/40">{e.occurredOn}</span>
                        <span className="shrink-0 text-white/60">{EVENT_KIND_LABELS[e.kind]}</span>
                        <a
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate text-white/80 hover:text-accent"
                          title={e.title}
                        >
                          {e.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-meta text-white/40">暂无动态</div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 规格卡(展开区卡片归类的卡壳):白系卡面 + 灰标签,值色由调用方 children 决定。
 * empty 非空时渲染占位文案(卡保留——四卡位置恒定,同类信息总在同一处)。
 */
function SpecCard({
  label,
  children,
  empty,
  className = '',
}: {
  label: string
  children?: ReactNode
  empty: string | null
  className?: string
}) {
  return (
    <div className={`rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-2 ${className}`}>
      <div className="text-meta mb-1 text-white/45">{label}</div>
      {empty !== null ? (
        <div className="text-meta text-white/35">{empty}</div>
      ) : (
        <div className="space-y-0.5 text-meta">{children}</div>
      )}
    </div>
  )
}

/**
 * 评测卡(CONTEXT.md「评测结果」,issues/08):每行 = Benchmark + 原始分数 + 快照日期,
 * 链接回评测方模型页;卡头挂 Artificial Analysis 归因(免费 API 使用条款要求)。不生成
 * 跨 Benchmark 综合分;未配置 Key / 暂无精确匹配为轻量单行(不套卡,空态不占卡片重量);
 * 评测源陈旧只提示评测自身,不牵连厂家档案。评测方口径的版本名与模型名不一致时括注
 * 展示(可回链核验)。
 */
function EvaluationCard({
  evaluations,
  status,
  className = '',
}: {
  evaluations: TrackedModel['evaluations']
  status: ModelEvaluationsStatus
  className?: string
}) {
  if (!status.configured) {
    return (
      <div className={`${className} text-meta text-white/50`}>
        评测:未配置({EVALUATION_ATTRIBUTION.label} Key)
      </div>
    )
  }
  if (evaluations.length === 0) {
    return (
      <div className={`${className} text-meta text-white/50`}>评测:暂无精确匹配</div>
    )
  }
  const versions = [...new Set(evaluations.map((e) => e.version))]
  return (
    <div
      className={`rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-2 ${className}`}
    >
      <div className="text-meta mb-1 flex items-baseline gap-2 flex-wrap text-white/45">
        <span>评测</span>
        {versions.length === 1 && versions[0] !== '' && <span>({versions[0]})</span>}
        <a
          href={EVALUATION_ATTRIBUTION.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-accent"
        >
          {EVALUATION_ATTRIBUTION.label}
        </a>
        {status.stale && <span className="text-white/40">(同步失败,展示最近快照)</span>}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-meta">
        {evaluations.map((e) => (
          <li key={e.benchmark} className="min-w-0 flex items-baseline gap-1.5">
            <a
              href={e.url}
              target="_blank"
              rel="noreferrer"
              title={`${e.evaluator} · ${e.version} · ${e.date}`}
              className="min-w-0 truncate hover:text-accent"
            >
              <span className="text-white/60">{benchmarkLabel(e.benchmark)}</span>{' '}
              <span className="font-mono text-emerald-300">
                {formatEvaluationScore(e.benchmark, e.score)}
              </span>
            </a>
            <span className="shrink-0 text-white/30">{e.date.slice(5)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
