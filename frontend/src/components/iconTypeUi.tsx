import { useMemo, type ReactNode } from 'react'
import { changelogSourceOf } from 'chrome-tab-shared'
import { useConfig } from '../api/config'
import { groupMembers } from '../lib/groupReducer'
import { extractString, navIconSrc } from '../lib/iconData'
import { GROUP_PAD_PX } from '../lib/iconLayout'
import type { Icon, IconTypeId } from '../lib/types'
import AiHotIconBody from './AiHotIcon'
import AiHotModal from './AiHotModal'
import ChangelogIconBody from './ChangelogIcon'
import ChangelogModal from './ChangelogModal'
import ModelIconBody from './ModelIcon'
import ModelModal from './ModelModal'
import NewsIconBody from './NewsIcon'
import NewsModal from './NewsModal'
import ServersIconBody from './ServersIcon'
import ServersModal from './ServersModal'
import StockIconBody from './StockIcon'
import StockModal from './StockModal'
import Tile from './Tile'
import TodoIconBody from './TodoIcon'
import TodoModal from './TodoModal'
import TrendingIconBody from './TrendingIcon'
import TrendingModal from './TrendingModal'
import VideoIconBody from './VideoIcon'
import VideoModal from './VideoModal'
import WeatherIconBody from './WeatherIcon'
import WeatherModal from './WeatherModal'

type IconBodyProps = {
  icon: Icon
  overlay?: boolean
  onOpenDetail?: () => void
}

type IconDetailProps = {
  icon: Icon
  onClose: () => void
}

/**
 * 图标块与详情的静态全覆盖 UI seam。可选 detail 是有无详情的唯一运行时来源;
 * nav 链接、group 弹层、拖拽和编辑仍由 Icon 共享外壳处理。
 */
type IconTypeUiAdapter =
  | {
      body: (props: IconBodyProps) => ReactNode
      detail?: undefined
      detailEntry?: undefined
    }
  | {
      body: (props: IconBodyProps) => ReactNode
      detail: (props: IconDetailProps) => ReactNode
      detailEntry: 'block' | 'header'
    }

export const ICON_TYPE_UI: Record<IconTypeId, IconTypeUiAdapter> = {
  nav: { body: NavIconBody },
  stock: { body: StockIconBody, detail: StockModal, detailEntry: 'block' },
  changelog: {
    body: ChangelogIconBody,
    detail: ChangelogDetail,
    detailEntry: 'header',
  },
  weather: { body: WeatherIconBody, detail: WeatherModal, detailEntry: 'block' },
  aihot: { body: AiHotIconBody, detail: AiHotModal, detailEntry: 'header' },
  todo: { body: TodoIconBody, detail: TodoModal, detailEntry: 'header' },
  video: { body: VideoIconBody, detail: VideoModal, detailEntry: 'header' },
  model: { body: ModelIconBody, detail: ModelModal, detailEntry: 'header' },
  news: { body: NewsIconBody, detail: NewsModal, detailEntry: 'header' },
  trending: { body: TrendingIconBody, detail: TrendingModal, detailEntry: 'header' },
  servers: { body: ServersIconBody, detail: ServersModal, detailEntry: 'header' },
  group: { body: GroupIconBody },
}

export function ChangelogDetail({ icon, onClose }: IconDetailProps) {
  return <ChangelogModal source={changelogSourceOf(icon.data)} onClose={onClose} />
}

export function NavIconBody({ icon, overlay = false }: IconBodyProps) {
  const favicon = navIconSrc(icon.data)
  return (
    <Tile label={extractString(icon.data, 'name')} overlay={overlay} bare>
      {favicon && (
        <img
          src={favicon}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-full rounded-[22%] object-contain"
        />
      )}
    </Tile>
  )
}

export function GroupIconBody({ icon, overlay = false }: IconBodyProps) {
  const { data } = useConfig()
  const members = useMemo(
    () => groupMembers(data?.icons ?? [], icon.id).slice(0, 6),
    [data?.icons, icon.id],
  )
  return (
    <Tile
      label={extractString(icon.data, 'name')}
      padPx={GROUP_PAD_PX}
      overlay={overlay}
    >
      <div className="grid w-full h-full grid-cols-3 grid-rows-2 place-items-center gap-[6%]">
        {members.map((member) => {
          const src = member.type === 'nav' ? navIconSrc(member.data) : ''
          return src ? (
            <img
              key={member.id}
              src={src}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full rounded-[2px] object-contain"
            />
          ) : (
            <span
              key={member.id}
              className="w-full h-full rounded-[2px] bg-white/20"
            />
          )
        })}
      </div>
    </Tile>
  )
}
