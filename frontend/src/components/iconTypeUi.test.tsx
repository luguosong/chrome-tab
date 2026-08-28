import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Icon, IconTypeId } from '../lib/types'
import AiHotIconBody from './AiHotIcon'
import AiHotModal from './AiHotModal'
import ChangelogIconBody from './ChangelogIcon'
import ChangelogModal from './ChangelogModal'
import {
  ChangelogDetail,
  GroupIconBody,
  ICON_TYPE_UI,
  NavIconBody,
} from './iconTypeUi'
import ModelIconBody from './ModelIcon'
import ModelModal from './ModelModal'
import NewsIconBody from './NewsIcon'
import NewsModal from './NewsModal'
import ServersIconBody from './ServersIcon'
import ServersModal from './ServersModal'
import StockIconBody from './StockIcon'
import StockModal from './StockModal'
import TodoIconBody from './TodoIcon'
import TodoModal from './TodoModal'
import TrendingIconBody from './TrendingIcon'
import TrendingModal from './TrendingModal'
import VideoIconBody from './VideoIcon'
import VideoModal from './VideoModal'
import WeatherIconBody from './WeatherIcon'
import WeatherModal from './WeatherModal'

describe('图标类型 UI adapter', () => {
  it.each([
    ['nav', NavIconBody, undefined, undefined],
    ['stock', StockIconBody, StockModal, 'block'],
    ['changelog', ChangelogIconBody, ChangelogDetail, 'header'],
    ['weather', WeatherIconBody, WeatherModal, 'block'],
    ['aihot', AiHotIconBody, AiHotModal, 'header'],
    ['todo', TodoIconBody, TodoModal, 'header'],
    ['video', VideoIconBody, VideoModal, 'header'],
    ['model', ModelIconBody, ModelModal, 'header'],
    ['news', NewsIconBody, NewsModal, 'header'],
    ['trending', TrendingIconBody, TrendingModal, 'header'],
    ['servers', ServersIconBody, ServersModal, 'header'],
    ['group', GroupIconBody, undefined, undefined],
  ] satisfies Array<[IconTypeId, unknown, unknown, 'block' | 'header' | undefined]>)(
    '%s 的图标块、详情与入口策略映射固定',
    (type, body, detail, detailEntry) => {
      expect(ICON_TYPE_UI[type].body).toBe(body)
      expect(ICON_TYPE_UI[type].detail).toBe(detail)
      expect(ICON_TYPE_UI[type].detailEntry).toBe(detailEntry)
    },
  )

  it('更新日志详情把图标 data 转为外源参数', () => {
    const onClose = vi.fn()
    const rendered = ICON_TYPE_UI.changelog.detail?.({
      icon: makeIcon('changelog', { source: 'matt-skills' }),
      onClose,
    }) as ReactElement<{ source: string; onClose: () => void }>

    expect(isValidElement(rendered)).toBe(true)
    expect(rendered.type).toBe(ChangelogModal)
    expect(rendered.props).toEqual({ source: 'matt-skills', onClose })
  })
})

function makeIcon(type: IconTypeId, data: Record<string, unknown> | null = null): Icon {
  return { id: 1, pageId: 1, parentId: null, type, sortOrder: 0, data }
}
