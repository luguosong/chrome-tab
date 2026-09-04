import { describe, expect, it } from 'vitest'
import { ICON_TYPE_META, fromWireType, toWireType, type IconTypeId } from 'chrome-tab-shared'

// shared 图标类型单源表(ADR-0057)的钉死清单:身份枚举/跨度/单例是双端共用的裁决
// (weather 09-01 收回 1×1 时后端容量漏跟,即此清单缺护栏的实证)。前端测试基建直测
// shared 纯数据表(editorFields.test 同先例);REGISTRY/UI adapter 各自的表另有测试。

describe('ICON_TYPE_META 单源清单', () => {
  it('13 个图标类型 id 固定(键序 = 新增抽屉分区渲染顺序)', () => {
    expect(Object.keys(ICON_TYPE_META)).toEqual([
      'nav', 'stock', 'changelog', 'weather', 'aihot', 'todo', 'video',
      'model', 'news', 'trending', 'servers', 'countdown', 'group',
    ])
  })

  it('跨格类型恰为 8 个 3×2;其余(含 weather,2026-09-01 收回 1×1)缺省 1 格', () => {
    const entries = Object.entries(ICON_TYPE_META) as Array<[IconTypeId, (typeof ICON_TYPE_META)[IconTypeId]]>
    const spanned = entries.filter(([, m]) => m.span !== undefined)
    expect(spanned.map(([id]) => id)).toEqual([
      'changelog', 'aihot', 'todo', 'video', 'model', 'news', 'trending', 'servers',
    ])
    for (const [, m] of spanned) expect(m.span).toEqual({ w: 3, h: 2 })
    // 显式反向钉(集合补集之外的独立断言):无 span 的 5 个——weather 在列即本次容量修正的核心钉
    expect(entries.filter(([, m]) => m.span === undefined).map(([id]) => id))
      .toEqual(['nav', 'stock', 'weather', 'countdown', 'group'])
  })

  it('单例类型恰为 8 个(与 CONTEXT.md「单例类型」词条一致;group 恒非单例)', () => {
    const ids = (Object.keys(ICON_TYPE_META) as IconTypeId[]).filter((id) => ICON_TYPE_META[id].singleton)
    expect(ids).toEqual(['aihot', 'todo', 'video', 'model', 'news', 'trending', 'servers', 'countdown'])
    expect(ICON_TYPE_META.group.singleton).toBe(false)
  })

  it('wire 大小写往返无损(纯小写 id ↔ 纯大写 wire)', () => {
    for (const id of Object.keys(ICON_TYPE_META) as IconTypeId[]) {
      expect(toWireType(id)).toBe(id.toUpperCase())
      expect(fromWireType(toWireType(id))).toBe(id)
    }
  })
})
