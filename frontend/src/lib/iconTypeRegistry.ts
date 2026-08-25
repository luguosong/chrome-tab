import type { ChangelogVersion } from './changelogParser'
import type { Quote } from './quoteParser'
import type { IconTypeId } from './types'
import { locationKey, readWeatherLocation, type WeatherBundle } from './weather'
import { DEFAULT_CHANGELOG_SOURCE } from 'chrome-tab-shared'

/**
 * 图标类型注册表(见 CONTEXT.md「图标类型」/ ADR-0001)。
 *
 * 注册表存纯数据 + 纯函数(无 JSX):元数据(kind/singleton/refresh/detail/
 * editor/size) + 纯 summarize。实际渲染由组件层按 type/detail 分发,使本模块 DOM-free、
 * 可 Vitest 纯函数测试(spec §接缝2)。图标默认占 1 格;类型可声明 size 跨格
 * (ADR-0021,渲染层 CSS grid span,位置仍是纯顺序流)。
 */
export type IconTypeKind = 'base' | 'extension' | 'group'

/** 详情容器形态(stock/weather/changelog/aihot=Modal / nav=无;ADR-0022 起无 drawer)。 */
export type DetailContainer = 'none' | 'modal'

/** 画格跨度(ADR-0021):w 列 × h 行,缺省 1×1。渲染层据此 span,容量按 w×h 计。 */
export type IconSpan = { w: number; h: number }

/** 配置表单字段声明(新增抽屉用,09 ticket 实现表单本身)。 */
export type EditorField =
  | { name: 'name'; label: string; placeholder: string }
  | { name: 'url'; label: string; placeholder: string }
  | { name: 'symbol'; label: string; placeholder: string }
  | { name: 'location'; label: string; placeholder: string }
  /** nav 专属:图标覆盖选择器(站点信息候选 + 自定义地址,值存 data.icon,空 = 派生)。 */
  | { name: 'icon'; label: string; placeholder: string }
  /** changelog 专属:外源下拉(ADR-0020),选项来自 shared CHANGELOG_SOURCES。 */
  | { name: 'source'; label: string; placeholder: string; default: string }

/** 刷新配置(spec §刷新策略):hook key + 间隔(ms)。0 = 不刷新。 */
export type RefreshConfig = {
  /** 'quotes' = useQuotes 轮询(60s); 'changelog' = useChangelog staleTime(1h); 'weather' = useWeather(后端缓存 10/30/5min); 'aihot' = useAiHot 自持(后端缓存 300s,单例不入集中层); 'todo' = useTodo 自持(后端缓存 60s,单例不入集中层); 'video' = useVideoFeed 自持(后端 1h 轮询预取,前端 staleTime 5min,单例不入集中层); 'model' = useModelArchive 自持(后端 6h 轮询持久档案,前端 staleTime 5min,单例不入集中层); 'none' = 不刷新。 */
  kind: 'quotes' | 'changelog' | 'weather' | 'aihot' | 'todo' | 'video' | 'model' | 'none'
}

/** 实时摘要数据(见 summarize 注释:ADR-0001 契约字段,当前无网格消费方)。 */
export type SummaryInput = {
  quotes?: Record<string, Quote | null>
  /** 更新日志的最新版本(changelog 图标只看最新一条;多源后此字段暂无网格消费方,见 ADR-0020)。 */
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
  refresh: RefreshConfig
  detail: DetailContainer
  editor: EditorField[]
  /** 画格跨度(ADR-0021):缺省(不声明)= 1×1。跨格类型的位置仍是顺序流,CSS span 排布。 */
  size?: IconSpan
  /**
   * 详情入口(ADR-0022 范式显式化):'block' = 整块点击打开(缺省,单格类型与跨格
   * 但无滚动主体的类型——如天气 3×1 小时序列);'header' = 块内标头「更多」按钮是
   * 唯一入口、整块点击无操作(跨格滚动大 tile,滚动主体与整块点击冲突)。
   */
  detailEntry?: 'block' | 'header'
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
 * 图标占用的画格数(ADR-0021):声明 size 的类型 = w×h,其余 1(undefined = 最小调用
 * 形态无 type,按 1 格)。容量计算(iconCapacity.cellsUsed / 后端 requireCapacity)
 * 与拖拽预校验共用本口径。纯函数 —— 直接 Vitest 断言。
 */
export function iconCells(typeId: IconTypeId | undefined): number {
  const s = typeId === undefined ? undefined : registry.get(typeId)?.size
  return s ? s.w * s.h : 1
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

/**
 * 全部已登记类型定义,按登记顺序(基础类型先于扩展类型,内置 nav/stock/changelog 顺序稳定)。
 * issue 09 新增抽屉按基础/扩展分区渲染卡片时遍历用。
 */
export function listTypes(): IconTypeDefinition[] {
  return [...registry.values()]
}

// ── 三个内置类型定义 ──────────────────────────────────────────────────────
/** 网站链接:基础类型,data={name,url,icon?}。点击直接在新标签打开,无详情容器,无实时摘要。
 *  editor 网址先行——它是「站点信息」自动加载(名称/图标候选)的触发器;icon 为可选覆盖,
 *  空 = 派生 favicon(渲染优先级见 lib/iconData.ts navIconSrc)。 */
export const NAV_DEF: IconTypeDefinition = {
  id: 'nav',
  label: '网站链接',
  kind: 'base',
  singleton: false,
  refresh: { kind: 'none' },
  detail: 'none',
  editor: [
    { name: 'url', label: '网址', placeholder: 'https://…' },
    { name: 'name', label: '名称', placeholder: '名称' },
    { name: 'icon', label: '图标', placeholder: '图片地址(可选)' },
  ],
  summarize: () => null, // nav 无实时摘要
}

/** 自选股:扩展类型,data={symbol,name}。网格只显示名称+当前价,详情=Modal(ADR-0016)。 */
export const STOCK_DEF: IconTypeDefinition = {
  id: 'stock',
  label: '自选股',
  kind: 'extension',
  singleton: false,
  refresh: { kind: 'quotes' },
  detail: 'modal',
  editor: [
    { name: 'symbol', label: '符号', placeholder: '搜索或输代码,如 茅台 / usAAPL' },
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

/** 更新日志:扩展类型,非单例(ADR-0020),data={source}(存量 null 兜底归默认源)。
 *  网格渲染 3×2 大 tile(ADR-0022:跨格第二消费者)——标头(源名 + 榜首鲜度 + 「更多」
 *  按钮)+ 版本滚动榜单(一行一版本,详见 ChangelogIcon);详情=Modal(ChangelogModal)。 */
export const CHANGELOG_DEF: IconTypeDefinition = {
  id: 'changelog',
  label: '更新日志',
  kind: 'extension',
  singleton: false,
  refresh: { kind: 'changelog' },
  detail: 'modal',
  size: { w: 3, h: 2 },
  detailEntry: 'header',
  editor: [
    {
      name: 'source',
      label: '外源',
      placeholder: '选择外源',
      default: DEFAULT_CHANGELOG_SOURCE,
    },
  ],
  summarize: (_data, live) => {
    const v = live.changelog
    if (!v) return null
    const firstItem =
      v.top[0] ?? v.sections.flatMap((s) => s.items)[0] ?? ''
    return { title: v.title, text: firstItem, tone: 'neutral' }
  },
}

/** 天气:扩展类型,非单例,data={location:{name,adm1,adm2,lat,lon}}。取数走后端代理(ADR-0009),详情=Modal(点块打开)。
 *  网格 3×1 跨格(首个非 3×2 跨格尺寸):块内小时序列(当前小时居首高亮 + 3 个未来
 *  小时,见 WeatherIconBody);无滚动主体,不入 BigTile「更多」标头范式。多实例 →
 *  取数在 IconDataContext 集中批量。 */
export const WEATHER_DEF: IconTypeDefinition = {
  id: 'weather',
  label: '天气',
  kind: 'extension',
  singleton: false,
  refresh: { kind: 'weather' },
  detail: 'modal',
  size: { w: 3, h: 1 },
  editor: [{ name: 'location', label: '城市', placeholder: '搜索城市' }],
  summarize: (data, live) => {
    const loc = readWeatherLocation(data)
    if (!loc) return null
    const now = live.weather?.[locationKey(loc)]?.now
    if (!now) return null
    return { title: loc.name, text: `${now.temp}° ${now.text}`, tone: 'neutral' }
  },
}

/** AI 热点:扩展类型,目前唯一单例(见 CONTEXT.md「AI 热点」——榜单全局唯一、无可绑实例参数),
 *  data={name?}(块内标头名,空回落「AI 热点」)。网格渲染 3×2 大 tile(ADR-0021:块内
 *  双列滚动榜单,标头+序号+单行截断,点条目外跳事件页),详情=Modal(完整榜单)。 */
export const AIHOT_DEF: IconTypeDefinition = {
  id: 'aihot',
  label: 'AI 热点',
  kind: 'extension',
  singleton: true,
  refresh: { kind: 'aihot' },
  detail: 'modal',
  size: { w: 3, h: 2 },
  detailEntry: 'header',
  editor: [{ name: 'name', label: '名称', placeholder: '名称(默认 AI 热点)' }],
  summarize: () => null, // 网格渲染走专属 AiHotIconBody,契约字段无消费方(同 nav)
}

/** 待办:扩展类型,单例(见 CONTEXT.md「待办」——三视图是账号级视图,无可绑实例参数)。
 *  data 无字段(单例无参数);网格渲染 3×2 大 tile(主体=收集箱滚动列表,ADR-0021),
 *  详情=Modal(TodoModal 三 tab:当天/7 天/收集箱 + 点掉完成 + 速记入收集箱)——
 *  首个可写图标类型。 */
export const TODO_DEF: IconTypeDefinition = {
  id: 'todo',
  label: '待办',
  kind: 'extension',
  singleton: true,
  refresh: { kind: 'todo' },
  detail: 'modal',
  size: { w: 3, h: 2 },
  detailEntry: 'header',
  editor: [],
  summarize: () => null, // 网格渲染走专属 TodoIconBody,契约字段无消费方(同 nav/aihot)
}

/** 视频更新:扩展类型,单例(博主注册表是账号级后端数据、无可绑实例参数,见 CONTEXT.md「视频更新」)。
 *  data 无字段;3×2 大 tile(块内全分类混合视频流,一行一条:24h 红点 + 博主名·相对时间 +
 *  标题截断 + 平台标记,点行外跳原平台),详情 Modal(全部/未分类/各分类/管理 tab,ADR-0022
 *  「更多」标头唯一入口)。数据 = 后端持久化 + 1h 轮询预取(ADR-0023)、取数路线 ADR-0024;
 *  前端只读、hook 自持轮询(同 aihot/todo 先例,不入集中层)。 */
export const VIDEO_DEF: IconTypeDefinition = {
  id: 'video',
  label: '视频更新',
  kind: 'extension',
  singleton: true,
  refresh: { kind: 'video' },
  detail: 'modal',
  size: { w: 3, h: 2 },
  detailEntry: 'header',
  editor: [],
  summarize: () => null, // 网格渲染走专属 VideoIconBody,契约字段无消费方(同 nav/aihot/todo)
}

/** 模型追踪:扩展类型,单例(见 CONTEXT.md「模型追踪」——档案全局共享,实例无可绑参数)。
 *  data 无字段;3×2 大 tile(块内滚动展示跟踪模型:名称 + 厂家 + 种类·阶段·开放方式 +
 *  最近动态时间,24h 新动态红点),详情 Modal(「全部」+ 各厂家 tab,模型行就地展开
 *  基本资料/动态时间线/原始信源,不套第二层 Modal),「更多」标头唯一入口(ADR-0022)。
 *  数据 = 后端全局持久档案 + 6h 轮询(ADR-0025),前端只读、hook 自持(同 aihot/todo/video)。 */
export const MODEL_DEF: IconTypeDefinition = {
  id: 'model',
  label: '模型追踪',
  kind: 'extension',
  singleton: true,
  refresh: { kind: 'model' },
  detail: 'modal',
  size: { w: 3, h: 2 },
  detailEntry: 'header',
  editor: [],
  summarize: () => null, // 网格渲染走专属 ModelIconBody,契约字段无消费方(同 nav/aihot/todo/video)
}

/**
 * 分组(ADR-0011):iOS 文件夹式收纳容器(块内成员 favicon 3×2 迷你预览,ADR-0015)。
 * kind='group' 不属于 base/extension 任一分区,
 * 新增抽屉按分区渲染时自然不列出——组只能经编辑模式合并手势诞生(POST /icons/merge),
 * 后端拒绝直接 POST type=group(空组不存活)。固定占 1 格、无 editor(改名走
 * 08 票分组弹层点名称)、无实时摘要。弹层打开/翻页/组内拖出在 08 票接入。
 */
export const GROUP_DEF: IconTypeDefinition = {
  id: 'group',
  label: '分组',
  kind: 'group',
  singleton: false,
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
register('aihot', AIHOT_DEF)
register('todo', TODO_DEF)
register('video', VIDEO_DEF)
register('model', MODEL_DEF)
register('group', GROUP_DEF)
