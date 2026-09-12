import { describe, expect, it } from 'vitest'
import type { IconTypeId } from '../lib/types'
import AiHotIconBody from './AiHotIcon'
import AiHotModal from './AiHotModal'
import ChangelogIconBody from './ChangelogIcon'
import ChangelogModal from './ChangelogModal'
import CountdownIconBody from './CountdownIcon'
import CountdownModal from './CountdownModal'
import { GroupIconBody, ICON_TYPE_UI, NavIconBody } from './iconTypeUi'
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
    ['changelog', ChangelogIconBody, ChangelogModal, 'header'],
    ['weather', WeatherIconBody, WeatherModal, 'block'],
    ['aihot', AiHotIconBody, AiHotModal, 'header'],
    ['todo', TodoIconBody, TodoModal, 'header'],
    ['video', VideoIconBody, VideoModal, 'header'],
    ['model', ModelIconBody, ModelModal, 'header'],
    ['news', NewsIconBody, NewsModal, 'header'],
    ['trending', TrendingIconBody, TrendingModal, 'header'],
    ['servers', ServersIconBody, ServersModal, 'header'],
    ['countdown', CountdownIconBody, CountdownModal, 'block'],
    ['group', GroupIconBody, undefined, undefined],
  ] satisfies Array<[IconTypeId, unknown, unknown, 'block' | 'header' | undefined]>)(
    '%s 的图标块、详情与入口策略映射固定',
    (type, body, detail, detailEntry) => {
      expect(ICON_TYPE_UI[type].body).toBe(body)
      expect(ICON_TYPE_UI[type].detail).toBe(detail)
      expect(ICON_TYPE_UI[type].detailEntry).toBe(detailEntry)
    },
  )

  // 更新日志详情自 ChangelogModal 直接挂行(自解析 icon,ADR-0059):原「wrapper 把
  // data 转外源参数」转译测试随 ChangelogDetail 退役——兜底语义的用例在
  // iconTypeRegistry.test.ts(resolveIcon)。
})
