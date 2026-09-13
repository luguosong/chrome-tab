import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChipRow } from './TrendingModal'

/** ChipRow 的 allowAny 契约(2026-09-13「不限时→刷新失败」事故回归):周期是
 *  GitHub Trending 的必选维度(上游无「不限周期」视图,since='' 是后端白名单
 *  拒绝的非法 wire 形状)——allowAny={false} 的行不得渲染「不限」胶囊,杜绝
 *  UI 把筛选状态机带进 since=''。ChipRow 零 hooks 纯展示,renderToString 直测。 */

const noop = vi.fn()
const opts = [{ key: 'daily', label: '今日', color: '' }]

describe('ChipRow allowAny 契约', () => {
  it('allowAny={false}(必选维度)不渲染「不限」胶囊', () => {
    const html = renderToString(
      <ChipRow ariaLabel="按周期筛选" label="周期" value="daily" onChange={noop} options={opts} allowAny={false} />,
    )
    expect(html).not.toContain('不限')
    expect(html).toContain('今日')
  })

  it('缺省(可缺省维度:语言/口语)保留「不限」胶囊', () => {
    const html = renderToString(
      <ChipRow ariaLabel="按编程语言筛选" label="语言" value="" onChange={noop} options={opts} />,
    )
    expect(html).toContain('不限')
  })
})
