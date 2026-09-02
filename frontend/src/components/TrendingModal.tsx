import { useState } from 'react'
import {
  TRENDING_LANGUAGES,
  TRENDING_SINCE_LABELS,
  TRENDING_SPOKEN,
  type TrendingSince,
} from 'chrome-tab-shared'
import { timeAgo } from '../lib/timeAgo'
import {
  retryTrendingTranslation,
  useKnownSet,
  useSetKnownMark,
  useTrending,
  TRENDING_TRANSLATE_FRESH_MS,
} from '../hooks/useTrending'
import { paneState } from '../lib/detailModalState'
import DetailModal, { QueryPane, retryButtonClass } from './DetailModal'
import { KnownCheck } from './TileBody'

/**
 * GitHub 趋势详情 Modal(见 CONTEXT.md「GitHub 趋势」;ADR-0022「更多」标头唯一入口):
 * 口语语言 / 编程语言 / 周期**三行胶囊**正交筛选(单选互斥,role=group + aria-pressed,
 * 与 ModelModal 种类胶囊同语汇——胶囊 = 叠加筛条件,区别于 tab 的切视图)。筛选即
 * queryKey:切组合自动按需现拉(后端内存缓存 1h,非默认组合首拉 ~2.4s)。
 * 行 = repo 名 + 总 star / 描述(完整换行永不省略,非中文后台译中、悬停原文)/ 语言色点·语言名 + 周期内增量,点行新开 tab;行尾常驻勾钮标记「已了解」(标记手势唯一入口,CONTEXT.md「已了解」)。
 * 译制状态分两段呈现:补译新鲜窗内 = 行内「译文生成中」徽章(在途);超窗仍有缺口 =
 * 「暂未译出」聚合提示条 + 重试翻译钮(诚实失败态,POST 触发后端补一轮,轮询收果)。
 * 不持久化筛选状态:每次打开回到默认 Today 视图(trending 语义即「此刻什么热」)。
 * 容器:ModalShell 统一壳(ADR-0031)。
 */

export default function TrendingModal({ onClose }: { onClose: () => void }) {
  const [since, setSince] = useState<TrendingSince>('daily')
  /** 空串 = 不限(与 GitHub 原生参数缺省一致)。 */
  const [language, setLanguage] = useState('')
  const [spoken, setSpoken] = useState('')
  /** 最近一次「重试翻译」点击时刻:把补译新鲜窗从 fetchedAt 拉回当下(轮询随它复活)。 */
  const [retryAt, setRetryAt] = useState(0)
  const [retryState, setRetryState] = useState<'idle' | 'sending' | 'error'>('idle')
  const { data, isError, refetch, isFetching } = useTrending({ since, language, spoken }, { retryAt })
  const knownSet = useKnownSet()
  const setKnownMark = useSetKnownMark()
  const repos = data?.repos ?? []
  // 有原文无译文的条数(wire 上 null 不分原因,以新鲜窗折算成 在途/暂未译出 两态)
  const untranslated = repos.filter((r) => r.description != null && r.descriptionZh == null).length
  const translateFresh =
    data != null && Date.now() - Math.max(Date.parse(data.fetchedAt), retryAt) < TRENDING_TRANSLATE_FRESH_MS

  const onRetryTranslation = async () => {
    setRetryState('sending')
    try {
      await retryTrendingTranslation({ since, language, spoken })
      setRetryAt(Date.now())
      setRetryState('idle')
    } catch {
      setRetryState('error')
    }
  }

  return (
    <DetailModal
      onClose={onClose}
      ariaLabel="GitHub 趋势"
      className="p-6"
      title="GitHub 趋势"
      subtitle={
        <>
          趋势仓库(口语 × 语言 × 周期筛选)
          {data && ` · 抓取于 ${timeAgo(data.fetchedAt)}`}
        </>
      }
    >
      {/* 三行筛选胶囊:每行前置维度小标签,值 = 不限/精选子集;单选互斥。
          语言胶囊带 linguist 色点,与条目行内色点同色互证(颜色即导航)。
          胶囊在状态机之外恒显示——失败/空态下切组合即换 queryKey 重拉,
          是天然的恢复出口(故状态机走域内 QueryPane 而非骨架 pane)。 */}
      <ChipRow ariaLabel="按口语语言筛选" label="口语" value={spoken} onChange={setSpoken}
        options={TRENDING_SPOKEN.map((l) => ({ key: l.slug, label: l.label }))} />
      <ChipRow ariaLabel="按编程语言筛选" label="语言" value={language} onChange={setLanguage}
        options={TRENDING_LANGUAGES.map((l) => ({ key: l.slug, label: l.label, color: l.color }))} />
      <ChipRow ariaLabel="按周期筛选" label="周期" value={since} onChange={(v) => setSince(v as TrendingSince)}
        options={Object.entries(TRENDING_SINCE_LABELS).map(([key, label]) => ({ key, label, color: '' }))} />

      <QueryPane
        state={paneState({
          isError,
          // 组合现拉中(非默认组合后端无缓存 ~2.4s;有旧数据时不整块闪白)——
          // 等待语义直说,「切胶囊更快」的出口用户自己能看见
          isPending: repos.length === 0 && isFetching,
          isEmpty: repos.length === 0,
          emptyMessage: '该组合下暂无趋势仓库',
          errorMessage: '趋势榜刷新失败',
          loadingMessage: '正在抓取该组合的趋势榜…',
        })}
        onRetry={() => void refetch()}
        retryBusy={isFetching}
      >
            {/* 暂未译出(新鲜窗外仍有缺口):聚合提示条 + 重试入口。不逐行标红——
                行动出口只有一个(重试本组),逐行重复按钮是噪音;中性 white-alpha
                保持深色面唯一交互色纪律,按钮语汇与上方「刷新失败,重试」同款。 */}
            {!translateFresh && untranslated > 0 && (
              <div className="mt-2 mb-1 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <span className="text-xs text-white/50">
                  {untranslated} 条描述暂未译出
                  {retryState === 'error' && ' · 重试发送失败,检查网络后可再试'}
                </span>
                <button
                  type="button"
                  onClick={() => void onRetryTranslation()}
                  disabled={retryState === 'sending'}
                  className={'shrink-0 ' + retryButtonClass}
                >
                  {retryState === 'sending' ? '正在发起…' : '重试翻译'}
                </button>
              </div>
            )}
            <ol className="mt-2 flex flex-col gap-0.5">
            {repos.map((r) => {
              const known = knownSet.has(r.repo)
              return (
              /* 行 = 锚(flex-1,外跳语义不变)+ 行尾常驻勾钮(toggle;标记手势唯一入口,
                 CONTEXT.md「已了解」)。已了解 = 整行淡绿底,勾常驻点亮;未了解勾弱透明
                 常驻,承担「可标记」的可发现性。 */
              <li
                key={r.repo}
                className={
                  'flex min-w-0 items-center gap-1 rounded-lg pr-1 transition-colors ' +
                  (known ? 'bg-emerald-400/15' : '')
                }
              >
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 rounded-lg px-2 py-1.5 hover:bg-white/10 transition-colors"
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
                      译文(ADR-0030)优先展示,悬停 title 放英文原文供核对(同新闻范式);
                      有原文无译文 = 补译暂态,随文徽章声明「非终态」+ useTrending 轮询接力。 */}
                  {r.description && (
                    <p
                      className="text-xs leading-snug text-white/60"
                      title={r.descriptionZh ? (r.description ?? undefined) : undefined}
                    >
                      {r.descriptionZh ?? r.description}
                      {!r.descriptionZh && translateFresh && <TranslatingBadge />}
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
                <button
                  type="button"
                  aria-pressed={known}
                  aria-label={(known ? '取消已了解:' : '标记为已了解:') + r.repo}
                  title={known ? '取消已了解' : '标记为已了解'}
                  onClick={() => setKnownMark.mutate({ repo: r.repo, known: !known })}
                  className={
                    'shrink-0 rounded-md p-1 transition-colors hover:bg-white/10 ' +
                    (known ? 'text-emerald-300' : 'text-white/25 hover:text-white/60')
                  }
                >
                  <KnownCheck className="h-4 w-4" />
                </button>
              </li>
              )
            })}
            </ol>
      </QueryPane>
    </DetailModal>
  )
}

/** 「译文生成中」徽章(ADR-0030 补译暂态的行内标记):随文小标声明当前原文不是
 *  终态,译文由 useTrending 到达轮询送来后消失。呼吸点是唯一动律,motion-reduce 静态;
 *  文字直出(非纯图标),读屏与色觉两类场景都不依赖颜色。 */
function TranslatingBadge() {
  return (
    <span className="ml-1.5 inline-flex translate-y-px items-center gap-1 rounded-full border border-white/15 px-1.5 text-meta leading-none text-white/40">
      <span
        className="h-1 w-1 animate-pulse rounded-full bg-accent motion-reduce:animate-none"
        aria-hidden="true"
      />
      译文生成中
    </span>
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
          : 'border-white/15 text-white/60 hover:border-white/30 hover:text-white/85 active:border-white/40')
      }
    >
      {color && (
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      )}
      {label}
    </button>
  )
}
