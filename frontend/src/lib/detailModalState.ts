/**
 * 详情 Modal 骨架的纯决策函数(ADR-0040;CONTEXT.md「详情 Modal 骨架」):
 * tab 归一(悬空回落)与主体查询状态机的归约优先级。JSX 骨架
 * (components/DetailModal.tsx)与本文件同源——调用方与骨架共享同一组函数,
 * 高亮与内容派生不会各说各话(组件零测试设施的仓约束下,语义测试面在此)。
 */
import type { ReactNode } from 'react'

/** tab 条的一个条目;key 由域自持(新闻源 id、分类 id、机器名……),label 可带
 *  域内标记(如待办的计数徽标)——归一决策只认 key,不感知 label 内容。 */
export interface TabItem<T extends string = string> {
  readonly key: T
  readonly label: ReactNode
}

/**
 * 选中 tab 归一:所指实体被删(管理里删分类/取消勾选源)后 tab 悬空,
 * 回落首个 tab。空列防御性返回原值(调用方约定非空,不炸渲染)。
 */
export function normalizeTab<T extends string>(tabs: readonly TabItem<T>[], selected: T): T {
  return tabs.some((t) => t.key === selected) ? selected : (tabs[0]?.key ?? selected)
}

/** 数据派生 tab 域(新闻/视频更新/服务器状态)的「派生 → 归一 → 门控」一括结算结果:
 *  tabs 给骨架渲染,active 给内容过滤,isManage 给 pane 门控(管理 tab 不依赖
 *  数据查询,pane 置 null 主体自持)。 */
export interface SettledTabs<T extends string> {
  readonly tabs: readonly TabItem<T>[]
  readonly active: T
  readonly isManage: boolean
}

/** 管理tab 的 key 惯例(新闻/视频更新两域既有字面量;不进类型——无管理tab 的域
 *  (如服务器状态)的 T 不含它也照用,门控只认 isManage 返回值)。 */
const MANAGE_KEY = 'manage'

/**
 * tab 派生仪式收编(行壳票,ADR-0040 注记):base = 域从数据派生的 tab 列
 * (全部/各源/各分类/各机器……),manageLabel 传入则追加管理tab 在尾,再归一。
 * 调用方不再手抄「追加 + normalizeTab + active === "manage" 判断」三步
 * (收编前 NewsModal/VideoModal/ServersModal 三家各持一份)。
 */
export function settleTabs<T extends string>(
  base: readonly TabItem<T>[],
  tab: T,
  manageLabel?: string,
): SettledTabs<T> {
  const tabs =
    manageLabel === undefined ? [...base] : [...base, { key: MANAGE_KEY as T, label: manageLabel }]
  const active = normalizeTab(tabs, tab)
  return { tabs, active, isManage: active === (MANAGE_KEY as T) }
}

/** 主体查询状态机的四态;error/empty 文案由域声明,loading 可选域文案(默认「加载中…」;
 *  有等待语义 worth 说的域带上,如趋势榜非默认组合现拉「正在抓取该组合的趋势榜…」)。 */
export type PaneState =
  | { readonly kind: 'loading'; readonly message?: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'empty'; readonly message: string }
  | { readonly kind: 'content' }

/** paneState 入参;isPending 取 React Query 的「尚无缓存数据」(非 isFetching)。 */
export interface PaneInput {
  readonly isError: boolean
  readonly isPending: boolean
  readonly isEmpty: boolean
  readonly emptyMessage: string
  /** 失败态消息,域文案(如「新闻流刷新失败」);省缺「刷新失败」。 */
  readonly errorMessage?: string
  /** 加载态域文案(默认「加载中…」);等待语义 worth 说的域带,如趋势榜现拉。 */
  readonly loadingMessage?: string
}

/**
 * 四态归约,优先级单点:error > loading > empty > content。分叉先例:
 * NewsModal 曾以 manage 优先于 isError、VideoModal 反之(feed 失败把管理 tab
 * 一并屏蔽)——不依赖数据查询的 tab 恒可达由骨架的「pane 省缺 = 主体自持」
 * 承担,本函数只管查询主体的顺序。
 */
export function paneState(i: PaneInput): PaneState {
  if (i.isError) return { kind: 'error', message: i.errorMessage ?? '刷新失败' }
  if (i.isPending) return { kind: 'loading', message: i.loadingMessage }
  if (i.isEmpty) return { kind: 'empty', message: i.emptyMessage }
  return { kind: 'content' }
}
