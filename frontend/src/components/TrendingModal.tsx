import { useState } from 'react'
import {
  TRENDING_LANGUAGES,
  TRENDING_SINCE_LABELS,
  TRENDING_SPOKEN,
  type TrendingSince,
} from 'chrome-tab-shared'
import { timeAgo } from '../lib/timeAgo'
import { useTrending } from '../hooks/useTrending'
import ModalShell from './ModalShell'

/**
 * GitHub 趋势详情 Modal(见 CONTEXT.md「GitHub 趋势」;ADR-0022「更多」标头唯一入口):
 * 口语语言 / 编程语言 / 周期**三行胶囊**正交筛选(单选互斥,role=group + aria-pressed,
 * 与 ModelModal 种类胶囊同语汇——胶囊 = 叠加筛条件,区别于 tab 的切视图)。筛选即
 * queryKey:切组合自动按需现拉(后端内存缓存 1h,非默认组合首拉 ~2.4s)。
 * 行 = repo 名 + 总 star / 描述(完整换行永不省略,非中文后台译中、悬停原文)/ 语言色点·语言名 + 周期内增量,点行新开 tab。
 * 不持久化筛选状态:每次打开回到默认 Today 视图(trending 语义即「此刻什么热」)。
 * 容器:ModalShell 统一壳(ADR-0031)。
 */

export default function TrendingModal({ onClose }: { onClose: () => void }) {
  const [since, setSince] = useState<TrendingSince>('daily')
  /** 空串 = 不限(与 GitHub 原生参数缺省一致)。 */
  const [language, setLanguage] = useState('')
  const [spoken, setSpoken] = useState('')
  const { data, isError, refetch, isFetching } = useTrending({ since, language, spoken })
  const repos = data?.repos ?? []

  return (
    <ModalShell onClose={onClose} ariaLabel="GitHub 趋势" className="p-6">

      <div className="mb-3">
          <h2 className="text-lg font-semibold text-white/90">GitHub 趋势</h2>
          <div className="text-xs text-white/50">
            趋势仓库(口语 × 语言 × 周期筛选)
            {data && ` · 抓取于 ${timeAgo(data.fetchedAt)}`}
          </div>
        </div>

        {/* 三行筛选胶囊:每行前置维度小标签,值 = 不限/精选子集;单选互斥。
            语言胶囊带 linguist 色点,与条目行内色点同色互证(颜色即导航)。 */}
        <ChipRow ariaLabel="按口语语言筛选" label="口语" value={spoken} onChange={setSpoken}
          options={TRENDING_SPOKEN.map((l) => ({ key: l.slug, label: l.label }))} />
        <ChipRow ariaLabel="按编程语言筛选" label="语言" value={language} onChange={setLanguage}
          options={TRENDING_LANGUAGES.map((l) => ({ key: l.slug, label: l.label, color: l.color }))} />
        <ChipRow ariaLabel="按周期筛选" label="周期" value={since} onChange={(v) => setSince(v as TrendingSince)}
          options={Object.entries(TRENDING_SINCE_LABELS).map(([key, label]) => ({ key, label, color: '' }))} />

        {isError ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/60">趋势榜刷新失败</span>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="border border-white/30 text-white/80 rounded-md px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
            >
              刷新失败,重试
            </button>
          </div>
        ) : isFetching && repos.length === 0 ? (
          // 组合现拉中(非默认组合后端无缓存,~2.4s;有旧数据时不整块闪白)
          <div className="py-8 text-center text-sm text-white/50">正在抓取该组合的趋势榜…</div>
        ) : repos.length === 0 ? (
          <div className="py-8 text-center text-sm text-white/50">该组合下暂无趋势仓库</div>
        ) : (
          <ol className="mt-2 flex flex-col gap-0.5">
            {repos.map((r) => (
              <li key={r.repo} className="min-w-0">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg px-2 py-1.5 hover:bg-white/10 transition-colors"
                >
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-white/90">
                      {r.repo}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-white/45">
                      ★ {r.stars.toLocaleString('en-US')}
                    </span>
                  </span>
                  {/* 描述独立成行、完整换行:它是了解项目的第一途径,永不省略。
                      层级仿 GitHub Trending:名字 → 描述 → 语言/增量元数据行。
                      译文(ADR-0030)优先展示,悬停 title 放英文原文供核对(同新闻范式)。 */}
                  {(r.descriptionZh ?? r.description) && (
                    <p
                      className="text-xs leading-snug text-white/60"
                      title={r.descriptionZh ? (r.description ?? undefined) : undefined}
                    >
                      {r.descriptionZh ?? r.description}
                    </p>
                  )}
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-baseline gap-1.5 text-xs text-white/50">
                      {r.languageColor && (
                        <span
                          className="h-2 w-2 shrink-0 self-center rounded-full"
                          style={{ backgroundColor: r.languageColor }}
                          aria-hidden="true"
                        />
                      )}
                      {r.language && <span className="shrink-0">{r.language}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-accent">
                      +{r.periodStars.toLocaleString('en-US')} {TRENDING_SINCE_LABELS[since]}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
    </ModalShell>
  )
}

/** 一行筛选胶囊(维度标签 + 「不限」+ 精选值;语言行带色点)。ModelModal 种类胶囊同款形态。 */
function ChipRow({
  ariaLabel,
  label,
  value,
  onChange,
  options,
}: {
  ariaLabel: string
  label: string
  value: string
  onChange: (v: string) => void
  options: { key: string; label: string; color?: string }[]
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center gap-1.5 overflow-x-auto modal-scroll -mt-1 mb-2 pb-1">
      <span className="shrink-0 text-meta text-white/35">{label}</span>
      <Chip active={value === ''} label="不限" onClick={() => onChange('')} />
      {options.map((o) => (
        <Chip
          key={o.key}
          active={value === o.key}
          label={o.label}
          color={o.color}
          onClick={() => onChange(o.key)}
        />
      ))}
    </div>
  )
}

function Chip({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean
  label: string
  color?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'shrink-0 rounded-full border px-2.5 py-0.5 text-meta transition inline-flex items-center gap-1 ' +
        (active
          ? 'border-white/25 bg-white/15 text-white/90'
          : 'border-white/15 text-white/60 hover:border-white/30 hover:text-white/85')
      }
    >
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      )}
      {label}
    </button>
  )
}
