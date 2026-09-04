import type { ModelEvaluationsStatus, TrackedModel } from 'chrome-tab-shared'
import { faviconUrl } from '../lib/iconData'
import {
  CODING_INDEX_BENCHMARK,
  EVALUATION_ATTRIBUTION,
  PROVIDER_ACCENT_COLORS,
  PROVIDER_LOGO_DOMAINS,
  PROVIDER_LABELS,
  benchmarkLabel,
  codingLeaderboard,
  formatEvaluationScore,
  leaderboardDetailLine,
} from '../lib/modelTracking'

/**
 * 跑分榜(ADR-0035,CONTEXT.md「评测结果」边界):档案内带 AA 编程指数的模型按该
 * 原生指数降序——评测方自己的聚合,我方只做已存分数的原样排序视图,非自制综合分;
 * 全量列出不截 top-N(截断线会随 AA 覆盖漂移)。行内跟编程类明细 benchmark(拼装与
 * 全缺显隐见 leaderboardDetailLine,固定顺序,不参与排序);归因链接卡头挂一次(AA
 * 免费 API 使用条款);只读——不展开模型行、无种类过滤,数据与厂家 tab 同源(同一份
 * archive 快照)。2026-09-04 评审候选 4:自 ModelModal 拆独立文件——「模型追踪」域内
 * 的 tab 级子视图(非顶级 Modal),排序与拼装经 lib/modelTracking 同文件可读。
 */
export default function LeaderboardPanel({
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
          /** 明细行拼装与「全缺不显」显隐决策住 lib(leaderboardDetailLine),此处纯渲染。 */
          const detailLine = leaderboardDetailLine(model)
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
              {detailLine && (
                <div className="pl-8 mt-0.5 text-meta text-white/45 truncate">{detailLine}</div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
