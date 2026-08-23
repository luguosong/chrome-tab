import { useChangelog } from '../hooks/useChangelog'
import { useLayoutSettings } from '../context/LayoutSettingsContext'
import { faviconPx } from '../lib/iconLayout'
import type { Icon } from '../lib/types'
import { IconLabel, TileFrame } from './Icon'

/**
 * 更新日志图标的专属网格渲染(单例;ADR-0016 单档;注记 2026-08-23b 统一「上块下字」
 * 结构,c 反转块内取舍):块内直接呈现「最后更新版本 + 发布日期」两行(用户要求,
 * 替换 23b 的循环箭头装饰)——版本号 mono accent 为视觉主体,日期小一号次级行;
 * 下方名称行「Claude Code」与其他类型的名称行语义一致(块内 = 现在的状态,
 * 下方 = 这是什么)。完整版本列表与译文走底部 Drawer(ChangelogDrawer)。
 * 数据直接订阅 useChangelog(与 IconDataContext 同 queryKey,命中缓存零额外请求,
 * 同 GroupBody 用 useConfig 的先例);releasedAt = 后端 npm registry 代理的最新版
 * 发布时间(ADR-0016,标准 ISO,取月-日——年内更新频繁,年份归 Drawer),失败/无数据
 * 降级 —。版本行字号受块宽钳制(min(px, 20cqw)),块是 inline-size 容器。
 */
export default function ChangelogIconBody({ icon: _icon, overlay = false }: { icon: Icon; overlay?: boolean }) {
  const { iconScale } = useLayoutSettings()
  const { data } = useChangelog()
  const px = (n: number) => n * iconScale
  const latest = data?.versions[0]?.title ?? null
  const released = data?.releasedAt ?? null

  return (
    <>
      <TileFrame
        favPx={faviconPx(iconScale)}
        overlay={overlay}
        className="flex-col gap-[4%] [container-type:inline-size]"
      >
        <span
          className="font-mono text-accent leading-none max-w-full truncate"
          style={{ fontSize: `min(${px(13)}px, 24cqw)` }}
        >
          {latest ?? '—'}
        </span>
        {released && (
          <span
            className="text-white/70 leading-none"
            style={{ fontSize: `min(${px(9)}px, 15cqw)` }}
          >
            {released.slice(5, 10)}
          </span>
        )}
      </TileFrame>
      <IconLabel>Claude Code</IconLabel>
    </>
  )
}
