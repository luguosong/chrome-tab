import type { ChangelogVersion } from './changelogParser'
import type { Quote } from './quoteParser'
import type { IconSize, IconTypeId } from './types'
import { locationKey, readWeatherLocation, type WeatherBundle } from './weather'

/**
 * 图标类型注册表(见 CONTEXT.md「图标类型」/ ADR-0001)。
 *
 * 注册表存纯数据 + 纯函数(无 JSX):元数据(kind/singleton/sizes/defaultSize/refresh/detail/
 * editor) + 纯 summarize。实际渲染由组件层按 type/detail 分发,使本模块 DOM-free、
 * 可 Vitest 纯函数测试(spec §接缝2)。
 */
export type IconTypeKind = 'base' | 'extension' | 'group'

/** 详情容器形态(stock=Modal / changelog=底部 Drawer / nav=无)。10 ticket 实现渲染。 */
export type DetailContainer = 'none' | 'modal' | 'drawer'

/** 配置表单字段声明(新增抽屉用,09 ticket 实现表单本身)。 */
export type EditorField =
  | { name: 'name'; label: string; placeholder: string }
  | { name: 'url'; label: string; placeholder: string }
  | { name: 'symbol'; label: string; placeholder: string }
  | { name: 'location'; label: string; placeholder: string }

/** 刷新配置(spec §刷新策略):hook key + 间隔(ms)。0 = 不刷新。 */
export type RefreshConfig = {
  /** 'quotes' = useQuotes 轮询(60s); 'changelog' = useChangelog staleTime(1h); 'weather' = useWeather(后端缓存 10/30/5min); 'none' = 不刷新。 */
  kind: 'quotes' | 'changelog' | 'weather' | 'none'
}

/** 实时摘要数据(见 summarize 注释:ADR-0001 契约字段,当前无网格消费方)。 */
export type SummaryInput = {
  quotes?: Record<string, Quote | null>
  /** 更新日志的最新版本(changelog 单例只看最新一条)。 */
  changelog?: ChangelogVersion | null
  /** 各天气图标的 bundle,键为 locationKey(lat,lon)。 */
  weather?: Record<string, WeatherBundle | null>
}

/** summarize 返回:摘要标题+正文+涨跌色。null = 无摘要/降级。 */
export type Summary = { title?: string; text: string; tone?: 'up' | 'down' | 'neutral' }

export interface IconTypeDefinition {
  id: IconTypeId
  label: string
  kind: IconTypeKind
  singleton: boolean
  sizes: IconSize[]
  defaultSize: IconSize
  refresh: RefreshConfig
  detail: DetailContainer
  editor: EditorField[]
  /**
   * 从图标 data + 实时数据取摘要。纯函数,无 DOM。返回 null 表示无摘要或刷新失败。
   * 注:ADR-0001 契约字段。票 10 换肤后四个内置类型的网格渲染全部走专属 body
   * (StockIcon/WeatherIcon/ChangelogIcon/Icon nav 分支),网格层暂无 summarize
   * 消费方;保留契约与测试,供未来新类型复用通用摘要路径。
   */
  summarize: (data: Record<string, unknown> | null, live: SummaryInput) => Summary | null
}

// ── registry ──────────────────────────────────────────────────────────────
const registry = new Map<IconTypeId, IconTypeDefinition>()

/** 登记一个图标类型(spec 契约:register(typeId, definition))。同 id 重复登记覆盖。 */
export function register(typeId: IconTypeId, def: IconTypeDefinition): IconTypeDefinition {
  registry.set(typeId, def)
  return def
}

/** 按 id 取定义;未登记返回 undefined。 */
export function get(typeId: IconTypeId): IconTypeDefinition | undefined {
  return registry.get(typeId)
}

/**
 * 是否允许新增该类型的实例。单例类型在已存在实例时拒绝(见 CONTEXT.md「单例类型」)。
 * 非单例类型恒允许。纯函数 —— 直接 Vitest 断言。
 */
export function canAdd(typeId: IconTypeId, existingTypeIds: IconTypeId[]): boolean {
  const def = registry.get(typeId)
  if (!def) return false
  if (!def.singleton) return true
  return !existingTypeIds.includes(typeId)
}

/** 该类型支持的尺寸档。未登记返回空数组。 */
export function sizesFor(typeId: IconTypeId): IconSize[] {
  return registry.get(typeId)?.sizes ?? []
}

/**
 * 全部已登记类型定义,按登记顺序(基础类型先于扩展类型,内置 nav/stock/changelog 顺序稳定)。
 * issue 09 新增抽屉按基础/扩展分区渲染卡片时遍历用。
 */
export function listTypes(): IconTypeDefinition[] {
  return [...registry.values()]
}

// ── 三个内置类型定义 ──────────────────────────────────────────────────────
/** 网站链接:基础类型,data={name,url}。点击直接在新标签打开,无详情容器,无实时摘要。 */
export const NAV_DEF: IconTypeDefinition = {
  id: 'nav',
  label: '网站链接',
  kind: 'base',
  singleton: false,
  sizes: ['small', 'medium', 'large'],
  defaultSize: 'small',
  refresh: { kind: 'none' },
  detail: 'none',
  editor: [
    { name: 'name', label: '名称', placeholder: '名称' },
    { name: 'url', label: '网址', placeholder: 'https://…' },
  ],
  summarize: () => null, // nav 无实时摘要
}

/** 自选股:扩展类型,data={symbol,name}。三档各有专属信息密度(见 ADR-0007 / StockIcon)。详情=Modal。 */
export const STOCK_DEF: IconTypeDefinition = {
  id: 'stock',
  label: '自选股',
  kind: 'extension',
  singleton: false,
  sizes: ['small', 'medium', 'large'],
  defaultSize: 'medium',
  refresh: { kind: 'quotes' },
  detail: 'modal',
  editor: [
    { name: 'symbol', label: '符号', placeholder: '符号 如 usAAPL' },
    { name: 'name', label: '名称', placeholder: '名称' },
  ],
  summarize: (data, live) => {
    const symbol = typeof data?.symbol === 'string' ? data.symbol : ''
    const q = symbol ? live.quotes?.[symbol] : null
    if (!q) return null // 刷新失败/未到数据 → 组件降级灰色 "--"
    const up = q.change >= 0
    return {
      text: `${q.price.toFixed(2)} ${up ? '▲' : '▼'} ${Math.abs(q.pct).toFixed(2)}%`,
      tone: up ? 'up' : 'down',
    }
  },
}

/** 更新日志:扩展类型,单例,data=null。详情=底部 Drawer(版本列表,10 ticket)。 */
export const CHANGELOG_DEF: IconTypeDefinition = {
  id: 'changelog',
  label: '更新日志',
  kind: 'extension',
  singleton: true,
  sizes: ['large'],
  defaultSize: 'large',
  refresh: { kind: 'changelog' },
  detail: 'drawer',
  editor: [],
  summarize: (_data, live) => {
    const v = live.changelog
    if (!v) return null
    const firstItem =
      v.top[0] ?? v.sections.flatMap((s) => s.items)[0] ?? ''
    return { title: v.title, text: firstItem, tone: 'neutral' }
  },
}

/** 天气:扩展类型,非单例,data={location:{name,adm1,adm2,lat,lon}}。取数走后端代理(ADR-0009),详情=Modal。
 *  多实例 → 取数在 IconDataContext 集中批量;网格渲染走专属 WeatherIconBody(三档密度,见 ADR-0009)。 */
export const WEATHER_DEF: IconTypeDefinition = {
  id: 'weather',
  label: '天气',
  kind: 'extension',
  singleton: false,
  sizes: ['small', 'medium', 'large'],
  defaultSize: 'medium',
  refresh: { kind: 'weather' },
  detail: 'modal',
  editor: [{ name: 'location', label: '城市', placeholder: '搜索城市' }],
  summarize: (data, live) => {
    const loc = readWeatherLocation(data)
    if (!loc) return null
    const now = live.weather?.[locationKey(loc)]?.now
    if (!now) return null
    return { title: loc.name, text: `${now.temp}° ${now.text}`, tone: 'neutral' }
  },
}

/**
 * 分组(ADR-0011):iOS 文件夹式收纳容器。kind='group' 不属于 base/extension 任一分区,
 * 新增抽屉按分区渲染时自然不列出——组只能经编辑模式合并手势诞生(POST /icons/merge),
 * 后端拒绝直接 POST type=group(空组不存活)。固定 small(1 格)、无 editor(改名走
 * 08 票分组弹层点名称)、无实时摘要。弹层打开/翻页/组内拖出在 08 票接入。
 */
export const GROUP_DEF: IconTypeDefinition = {
  id: 'group',
  label: '分组',
  kind: 'group',
  singleton: false,
  sizes: ['small'],
  defaultSize: 'small',
  refresh: { kind: 'none' },
  detail: 'none',
  editor: [],
  summarize: () => null,
}

// 模块加载时登记内置类型。
register('nav', NAV_DEF)
register('stock', STOCK_DEF)
register('changelog', CHANGELOG_DEF)
register('weather', WEATHER_DEF)
register('group', GROUP_DEF)
