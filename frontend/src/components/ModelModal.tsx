import { useState, type ReactNode } from 'react'
import type {
  ModelEvaluationsStatus,
  ModelKind,
  ModelProviderId,
  TrackedModel,
} from 'chrome-tab-shared'
import { useModelArchive } from '../hooks/useModelArchive'
import { paneState } from '../lib/detailModalState'
import { timeAgo } from '../lib/timeAgo'
import DetailModal, { QueryPane } from './DetailModal'
import {
  AVAILABILITY_LABELS,
  CODING_INDEX_BENCHMARK,
  EVALUATION_ATTRIBUTION,
  EVENT_KIND_LABELS,
  LEADERBOARD_DETAIL_BENCHMARKS,
  MODEL_KIND_COLOR_CLASSES,
  MODEL_KIND_LABELS,
  PROVIDER_LABELS,
  STAGE_LABELS,
  benchmarkLabel,
  codingLeaderboard,
  compareModelsByRelease,
  formatReleaseBrief,
  formatModelPricing,
  formatEvaluationScore,
  isFreshModelEvent,
  PROVIDER_ACCENT_COLORS,
  PROVIDER_LOGO_DOMAINS,
} from '../lib/modelTracking'
import { faviconUrl } from '../lib/iconData'

/**
 * 模型追踪详情 Modal(见 CONTEXT.md「模型追踪」,ADR-0022「更多」标头唯一入口):
 * 「全部」+ 各「跟踪厂家」tab,末位固定「跑分榜」tab(ADR-0035);厂家 tab 下挂
 * 一行「模型种类」过滤胶囊(与厂家 tab 正交 AND 组合,单选互斥;种类词着色与行内
 * 种类词同纲——颜色即导航)。模型行在**当前
 * Modal 内就地展开**(摘要 + 限额/训练参数/价格/评测四张规格卡——值按语义着色,
 * 动态时间线与信源全宽,不套第二层 Modal),24h 新动态行首红点(时间驱动,无已读
 * 概念)。信源失败保留最后成功结果并标记陈旧(CONTEXT.md「模型档案」)——头部给
 * 一行陈旧提示。容器:详情 Modal 骨架(ADR-0040;tab 静态派生自 PROVIDER_LABELS,
 * 过滤行用胶囊形态以区分「切视图/筛条件」两个维度)。
 */
/** tab 维度 = 全部 + 各跟踪厂家(自 PROVIDER_LABELS 派生,厂家票扩 shared 时 tab 随动)+ 固定「跑分榜」(ADR-0035,末位不打乱派生序)。 */
type Tab = 'all' | ModelProviderId | 'leaderboard'
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: '全部' },
  ...(Object.keys(PROVIDER_LABELS) as ModelProviderId[]).map((p) => ({
    key: p,
    label: PROVIDER_LABELS[p],
  })),
  { key: 'leaderboard', label: '跑分榜' },
]

/** 种类过滤维度 = 全部种类 + 八类(自 MODEL_KIND_LABELS 派生,种类票扩时随动)。 */
type KindFilter = 'all' | ModelKind
const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: '全部种类' },
  ...(Object.keys(MODEL_KIND_LABELS) as ModelKind[]).map((k) => ({
    key: k,
    label: MODEL_KIND_LABELS[k],
  })),
]

export default function ModelModal({ onClose }: { onClose: () => void }) {
  const { data, isError, refetch, isFetching } = useModelArchive()
  const [tab, setTab] = useState<Tab>('all')
  /** 种类过滤(正交维度):切厂家 tab 时保留——用户在组合浏览,不代为重置。 */
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  /** 就地展开的模型行(同时只开一行,展开/收起即点击行头)。 */
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const staleSources = (data?.sources ?? []).filter((s) => s.stale)

  return (
    <DetailModal
      onClose={onClose}
      ariaLabel="模型追踪"
      className="p-6"
      title="模型追踪"
      subtitle="AI 模型档案与动态(官方一手信源)"
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      {/* 种类过滤胶囊:单选互斥,与厂家 tab AND 组合。不是 tab(不切换视图,
          只叠加过滤条件)——role=group + aria-pressed。种类词着色与行内种类词
          同纲(MODEL_KIND_COLOR_CLASSES):chip 与行内同色互证,颜色即导航。
          跑分榜不消费该过滤轴(CONTEXT.md:跑分榜无种类过滤),整行隐藏。
          在状态机之外恒显示(同趋势榜胶囊)——失败态下换组合过滤仍是有效探索。 */}
      {tab !== 'leaderboard' && (
        <div
          role="group"
          aria-label="按模型种类过滤"
          className="flex gap-1.5 overflow-x-auto modal-scroll -mt-1 mb-2 pb-1"
        >
          {KIND_FILTERS.map(({ key, label }) => {
            const active = kindFilter === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setKindFilter(key)}
                className={
                  'shrink-0 rounded-full border px-2.5 py-0.5 text-meta transition ' +
                  (active
                    ? 'border-white/25 bg-white/15 text-white/90'
                    : 'border-white/15 text-white/60 hover:border-white/30 hover:text-white/85 active:border-white/40')
                }
              >
                <span
                  className={key === 'all' ? undefined : MODEL_KIND_COLOR_CLASSES[key] || undefined}
                >
                  {label}
                </span>
              </button>
            )
          })}
        </div>
        )}

      <QueryPane
        state={paneState({
          isError,
          isPending: data === undefined,
          isEmpty: false,
          emptyMessage: '',
          errorMessage: '档案刷新失败',
        })}
        onRetry={() => void refetch()}
        retryBusy={isFetching}
      >
      {/* 编译器的类型收窄守卫(陈旧/线索/列表的派生都在 data 上);QueryPane
          content 态 = data 已就位 */}
      {data && (
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
            {/* 待核验线索(ADR-0025「跳过待核验」的可见形态):发布源出现基线不认识的
                新条目——非故障,提示人工核验纳入;核验后下轮自愈消失。 */}
            {data.pendingClues.length > 0 && (
              <details className="py-1.5 text-meta text-white/50">
                <summary className="cursor-pointer select-none hover:text-white/70">
                  待核验线索 {data.pendingClues.length} 条(发布源新条目不在跟踪名单,核验后消失)
                </summary>
                <ul className="mt-1 space-y-0.5 pl-1">
                  {data.pendingClues.map((c) => (
                    <li key={`${c.provider}|${c.date}|${c.url}`} className="truncate">
                      <span className="text-white/40">{PROVIDER_LABELS[c.provider]}</span>{' '}
                      <span className="text-white/30">{c.date.slice(5)}</span>{' '}
                      <a href={c.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-accent">
                        {c.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {tab === 'leaderboard' ? (
              <LeaderboardPanel models={data.models} status={data.evaluations} />
            ) : (
              <ModelList
                // filter 返回新数组,直接原位排(不动 React Query 缓存)——上线发布时间优先
                //(2026-08-26 轴改),防「全部」被单一厂家的入库序垄断(2026-08-25 智谱 44 模型连排数屏)
                models={data.models
                  .filter(
                    (m) =>
                      (tab === 'all' || m.provider === tab) &&
                      (kindFilter === 'all' || m.kind === kindFilter),
                  )
                  .sort(compareModelsByRelease)}
                // 组合过滤可命中空集(如 智谱×视频生成),与档案真空区分文案
                emptyText={
                  tab !== 'all' || kindFilter !== 'all' ? '当前筛选下暂无模型' : undefined
                }
                evaluationStatus={data.evaluations}
                expandedId={expandedId}
                onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              />
            )}
      </>
      )}
      </QueryPane>
    </DetailModal>
  )
}

/** 模型行列表:行头(名称 + 厂家 + 种类·阶段·开放方式 + 最近动态)点击就地展开。 */
function ModelList({
  models,
  evaluationStatus,
  expandedId,
  onToggle,
  emptyText,
}: {
  models: TrackedModel[]
  evaluationStatus: ModelEvaluationsStatus
  expandedId: number | null
  onToggle: (id: number) => void
  /** 空态文案:过滤空集与档案真空由调用方区分,默认为档案真空。 */
  emptyText?: string
}) {
  if (models.length === 0) {
    return <div className="text-sm text-white/50 py-6 text-center">{emptyText ?? '暂无跟踪模型'}</div>
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
              className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-white/10 active:bg-white/20 transition"
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

/**
 * 跑分榜(ADR-0035,CONTEXT.md「评测结果」边界):档案内带 AA 编程指数的模型按该
 * 原生指数降序——评测方自己的聚合,我方只做已存分数的原样排序视图,非自制综合分;
 * 全量列出不截 top-N(截断线会随 AA 覆盖漂移)。行内跟编程类明细 benchmark(固定
 * 顺序,缺评测显「-」,不参与排序);归因链接卡头挂一次(AA 免费 API 使用条款);
 * 只读——不展开模型行、无种类过滤,数据与厂家 tab 同源(同一份 archive 快照)。
 */
function LeaderboardPanel({
  models,
  status,
}: {
  models: TrackedModel[]
  status: ModelEvaluationsStatus
}) {
  if (!status.configured) {
    return (
      <div className="text-meta text-white/50 py-6 text-center">
        评测:未配置({EVALUATION_ATTRIBUTION.label} Key)
      </div>
    )
  }
  const rows = codingLeaderboard(models)
  if (rows.length === 0) {
    return <div className="text-meta text-white/50 py-6 text-center">暂无跑分数据</div>
  }
  const presentProviders = [...new Set(models.map((m) => m.provider))]
  return (
    <div>
      {/* 厂家识别图例:logo + 着色厂名建立「颜色↔厂商」字典(色即分组轴,数值列一律中性白)。 */}
      <div className="text-meta flex items-center gap-x-3 gap-y-1 flex-wrap pb-1.5">
        {presentProviders.map((p) => (
          <span key={p} className="flex items-center gap-1.5">
            <img
              src={faviconUrl(`https://${PROVIDER_LOGO_DOMAINS[p]}`)}
              alt=""
              loading="lazy"
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
              className="w-3.5 h-3.5 shrink-0 rounded-[4px] ring-1 ring-white/15"
            />
            <span style={{ color: PROVIDER_ACCENT_COLORS[p] }}>{PROVIDER_LABELS[p]}</span>
          </span>
        ))}
      </div>
      <div className="text-meta text-white/45 flex items-baseline gap-2 flex-wrap pb-1.5">
        <span>{rows.length} 个模型</span>
        <span>· 按{benchmarkLabel(CODING_INDEX_BENCHMARK)}降序</span>
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
      <ol className="space-y-1">
        {rows.map(({ model, rank, codingIndex }) => {
          const details = LEADERBOARD_DETAIL_BENCHMARKS.map((b) => ({
            benchmark: b,
            hit: model.evaluations.find((e) => e.benchmark === b),
          }))
          return (
            <li key={model.id} className="rounded-xl px-3 py-2.5 hover:bg-white/10 active:bg-white/20 transition">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="w-6 shrink-0 text-right font-mono text-accent text-sm">{rank}</span>
                <span
                  className="min-w-0 flex-1 flex items-center gap-1.5 text-sm"
                  style={{ color: PROVIDER_ACCENT_COLORS[model.provider] }}
                >
                  <img
                    src={faviconUrl(`https://${PROVIDER_LOGO_DOMAINS[model.provider]}`)}
                    alt=""
                    loading="lazy"
                    onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                    className="w-4 h-4 shrink-0 rounded-[4px] ring-1 ring-white/15"
                  />
                  <span className="truncate">{model.name}</span>
                </span>
                <span
                  className="shrink-0 text-meta"
                  style={{ color: `${PROVIDER_ACCENT_COLORS[model.provider]}88` }}
                >
                  {PROVIDER_LABELS[model.provider]}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-white/95">
                  {formatEvaluationScore(CODING_INDEX_BENCHMARK, codingIndex)}
                </span>
              </div>
              {details.some((d) => d.hit !== undefined) && (
                <div className="pl-8 mt-0.5 text-meta text-white/45 truncate">
                  {details
                    .map(
                      (d) =>
                        `${benchmarkLabel(d.benchmark)} ${d.hit ? formatEvaluationScore(d.benchmark, d.hit.score) : '-'}`,
                    )
                    .join(' · ')}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
