import type { TrackedModel } from 'chrome-tab-shared'
import { useModelArchive } from '../hooks/useModelArchive'
import { ICON_SCALE, tileFont } from '../lib/iconLayout'
import {
  AVAILABILITY_LABELS,
  MODEL_KIND_COLOR_CLASSES,
  MODEL_KIND_LABELS,
  PROVIDER_LABELS,
  STAGE_LABELS,
  compareModelsByRelease,
  formatLatestEventBrief,
  isFreshModelEvent,
  modelEventIso,
} from '../lib/modelTracking'
import type { Icon } from '../lib/types'
import BigTile from './BigTile'
import { FreshDot, TileBody, TileRow } from './TileBody'

/**
 * 模型追踪图标的专属网格渲染(见 CONTEXT.md「模型追踪」;3×2 大 tile,ADR-0021/0022
 * 范式):外壳/标头走 BigTile(标头鲜度 = 最新模型动态的发生时刻,「动态」前缀防读作
 * 数据刷新时刻——2026-08-27 误读事故),主体 = 跟踪模型
 * 单列滚动榜(一行一模型:上行 = 名称 + 厂家,下行 = 种类 · 发布阶段 · 开放方式 +
 * 最近动态相对时间;24h 内新动态行首红点,时间驱动满窗自隐)。行不可点——基本资料与
 * 动态时间线都在「更多」Modal(行悬浮 title 透出最近动态标题)。空档案 BigTile 空态,
 * 入口在「更多」。数据自持 useModelArchive(后端 6h 轮询持久档案、前端只读库,ADR-0025)。
 */
export default function ModelIconBody({
  icon,
  overlay = false,
  onOpenDetail,
}: {
  icon: Icon
  overlay?: boolean
  /** 「更多」按钮直调(ADR-0022);undefined = 编辑模式/overlay,按钮不渲染。 */
  onOpenDetail?: () => void
}) {
  void icon // 单例无实例参数(data 无字段);保留形参对齐其它 body 的接口
  const { data } = useModelArchive()
  const fontSize = tileFont(ICON_SCALE, 'secondary')
  // 展示序 = 上线发布时间优先(退役沉底,2026-08-26 轴改):slice(30) 截断前先排,否则
  // 入库 id 序让单一厂家(智谱 44 个)占满截断窗,其余厂家在块内永不可见
  const models = [...(data?.models ?? [])].sort(compareModelsByRelease)
  const fresh = latestEventIso(models)

  return (
    <BigTile
      title="模型追踪"
      fresh={fresh}
      freshLabel="动态"
      onOpenDetail={onOpenDetail}
      moreTitle="查看全部模型与动态"
      overlay={overlay}
    >
      {models.length === 0 ? null : (
        <TileBody
          rows={models.map((m) => {
            const latest = m.events[0]
            return (
              // hover 行:tile 行不可点(hover 是行级视觉语汇,与 Modal 展开无关),
              // 语义同 Changelog 静态臂的镜像——有意保留 hover,经 interactive='hover' 声明
              <TileRow key={m.id} interactive="hover" title={latest ? `${m.name}:${latest.title}` : m.name}>
                <span className="flex items-baseline justify-between gap-2 min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FreshDot show={latest ? isFreshModelEvent(latest.occurredOn) : false} />
                    <span className="min-w-0 truncate text-white/90" style={{ fontSize }}>
                      {m.name}
                    </span>
                    {m.stage === 'retired' && (
                      <span className="shrink-0 rounded-full bg-white/15 px-1.5 text-meta leading-4 text-white/55">
                        已退役
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-white/45" style={{ fontSize }}>
                    {PROVIDER_LABELS[m.provider]}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-2 min-w-0">
                  <span className="min-w-0 truncate text-white/45" style={{ fontSize }}>
                    {/* 非文本模型种类词着色(映射语义见 modelTracking);文本类空串沿用本行灰 */}
                    <span className={MODEL_KIND_COLOR_CLASSES[m.kind] || undefined}>
                      {MODEL_KIND_LABELS[m.kind]}
                    </span>{' '}
                    · {STAGE_LABELS[m.stage]} ·{' '}
                    {m.availability.map((a) => AVAILABILITY_LABELS[a]).join('/')}
                  </span>
                  {latest && (
                    <span className="shrink-0 font-mono text-white/35" style={{ fontSize }}>
                      {formatLatestEventBrief(latest)}
                    </span>
                  )}
                </span>
              </TileRow>
            )
          })}
        />
      )}
    </BigTile>
  )
}

/** 全档案最新动态的锚点 ISO(标头鲜度);无动态 → null。 */
function latestEventIso(models: TrackedModel[]): string | null {
  let latest: string | null = null
  for (const m of models) {
    const on = m.events[0]?.occurredOn
    if (!on) continue
    if (latest === null || on > latest) latest = on
  }
  return latest === null ? null : modelEventIso(latest)
}
