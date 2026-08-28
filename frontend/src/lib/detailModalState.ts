/**
 * 详情 Modal 骨架的纯决策函数(ADR-0040;CONTEXT.md「详情 Modal 骨架」):
 * tab 归一(悬空回落)与主体查询状态机的归约优先级。JSX 骨架
 * (components/DetailModal.tsx)与本文件同源——调用方与骨架共享同一组函数,
 * 高亮与内容派生不会各说各话(组件零测试设施的仓约束下,语义测试面在此)。
 */

/** tab 条的一个条目;key 由域自持(新闻源 id、分类 id、机器名……)。 */
export interface TabItem<T extends string = string> {
  readonly key: T
  readonly label: string
}

/**
 * 选中 tab 归一:所指实体被删(管理里删分类/取消勾选源)后 tab 悬空,
 * 回落首个 tab。空列防御性返回原值(调用方约定非空,不炸渲染)。
 */
export function normalizeTab<T extends string>(tabs: readonly TabItem<T>[], selected: T): T {
  return tabs.some((t) => t.key === selected) ? selected : (tabs[0]?.key ?? selected)
}

/** 主体查询状态机的四态;error/empty 的文案由域声明。 */
export type PaneState =
  | { readonly kind: 'loading' }
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
}

/**
 * 四态归约,优先级单点:error > loading > empty > content。分叉先例:
 * NewsModal 曾以 manage 优先于 isError、VideoModal 反之(feed 失败把管理 tab
 * 一并屏蔽)——不依赖数据查询的 tab 恒可达由骨架的「pane 省缺 = 主体自持」
 * 承担,本函数只管查询主体的顺序。
 */
export function paneState(i: PaneInput): PaneState {
  if (i.isError) return { kind: 'error', message: i.errorMessage ?? '刷新失败' }
  if (i.isPending) return { kind: 'loading' }
  if (i.isEmpty) return { kind: 'empty', message: i.emptyMessage }
  return { kind: 'content' }
}
