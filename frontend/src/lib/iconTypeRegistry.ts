import { DEFAULT_CHANGELOG_SOURCE, ICON_TYPE_META } from 'chrome-tab-shared'
import type { IconSpan, IconTypeId } from './types'

/**
 * 图标类型元数据表(见 CONTEXT.md「图标类型」/ ADR-0001)。
 *
 * 本模块只存前端专属 DOM-free 静态元数据(label/kind/editor)与纯查询函数,
 * 可 Vitest 纯函数测试;span/singleton 单源自 shared ICON_TYPE_META 展开至此
 * (ADR-0057,条目 `...ICON_TYPE_META.<id>` spread,双份手写漂移源已消灭);
 * 图标块/详情 renderer 与详情入口策略由静态全覆盖 UI adapter
 * (components/iconTypeUi.tsx)持有,两模块分工见 ADR-0001 注记。表为
 * `Record<IconTypeId, …>` 静态全覆盖——新增类型漏登记时类型检查即失败(同 adapter)。
 * 图标默认占 1 格;类型可声明 span 跨格(ADR-0021,渲染层 CSS grid span,位置仍是纯顺序流)。
 */
export type IconTypeKind = 'base' | 'extension' | 'group'

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

export interface IconTypeDefinition {
  id: IconTypeId
  label: string
  kind: IconTypeKind
  singleton: boolean
  editor: EditorField[]
  /** 画格跨度(ADR-0021):缺省(不声明)= 1×1。跨格类型的位置仍是顺序流,CSS span 排布。 */
  span?: IconSpan
}

// ── 类型表(键序 = 新增抽屉分区渲染顺序:基础先于扩展,内置 nav/stock/changelog 稳定)──

/** 条目工厂:id 与 shared 元数据参数化绑定(spread 源错位不再可能,review 2026-09-04),
 *  顺带消掉逐条手写的 id 字段。 */
const def = (
  id: IconTypeId,
  d: Omit<IconTypeDefinition, 'id' | 'singleton' | 'span'>,
): IconTypeDefinition => ({ id, ...ICON_TYPE_META[id], ...d })

const REGISTRY: Record<IconTypeId, IconTypeDefinition> = {
  /** 网站链接:基础类型,data={name,url,icon?}。点击直接在新标签打开,无详情容器,无实时摘要。
   *  editor 网址先行——它是「站点信息」自动加载(名称/图标候选)的触发器;icon 为可选覆盖,
   *  空 = 派生 favicon(渲染优先级见 lib/iconData.ts navIconSrc)。 */
  nav: def('nav', {
    label: '网站链接',
    kind: 'base',
    editor: [
      { name: 'url', label: '网址', placeholder: 'https://…' },
      { name: 'name', label: '名称', placeholder: '名称' },
      { name: 'icon', label: '图标', placeholder: '图片地址(可选)' },
    ],
  }),

  /** 自选股:扩展类型,data={symbol,name}。网格只显示名称+当前价,详情=Modal(ADR-0016)。 */
  stock: def('stock', {
    label: '自选股',
    kind: 'extension',
    editor: [
      { name: 'symbol', label: '符号', placeholder: '搜索或输代码,如 茅台 / usAAPL' },
      { name: 'name', label: '名称', placeholder: '名称' },
    ],
  }),

  /** 更新日志:扩展类型,非单例(ADR-0020),data={source}(存量 null 兜底归默认源)。
   *  网格渲染 3×2 大 tile(ADR-0022:跨格第二消费者)——标头(源名 + 榜首鲜度 + 「更多」
   *  按钮)+ 版本滚动榜单(一行一版本,详见 ChangelogIcon);详情=Modal(ChangelogModal)。 */
  changelog: def('changelog', {
    label: '更新日志',
    kind: 'extension',
    editor: [
      {
        name: 'source',
        label: '外源',
        placeholder: '选择外源',
        default: DEFAULT_CHANGELOG_SOURCE,
      },
    ],
  }),

  /** 天气:扩展类型,非单例,data={location:{name,adm1,adm2,lat,lon}}。取数走后端代理(ADR-0009),详情=Modal(点块打开)。
   *  1×1 普通占格(曾 3×1 跨格,2026-09-01 收回单格):块内实况摘要(状况图标 +
   *  温度),存在灾害预警时右上角等级色警示点(见 WeatherIconBody);无滚动主体,
   *  不入 BigTile「更多」标头范式。多实例 → 取数在 IconDataContext 集中批量。 */
  weather: def('weather', {
    label: '天气',
    kind: 'extension',
    editor: [{ name: 'location', label: '城市', placeholder: '搜索城市' }],
  }),

  /** AI 热点:扩展类型,目前唯一单例(见 CONTEXT.md「AI 热点」——榜单全局唯一、无可绑实例参数),
   *  data={name?}(块内标头名,空回落「AI 热点」)。网格渲染 3×2 大 tile(ADR-0021:块内
   *  双列滚动榜单,标头+序号+单行截断,点条目外跳事件页),详情=Modal(完整榜单)。 */
  aihot: def('aihot', {
    label: 'AI 热点',
    kind: 'extension',
    editor: [{ name: 'name', label: '名称', placeholder: '名称(默认 AI 热点)' }],
  }),

  /** 待办:扩展类型,单例(见 CONTEXT.md「待办」——三视图是账号级视图,无可绑实例参数)。
   *  data 无字段(单例无参数);网格渲染 3×2 大 tile(主体=收集箱滚动列表,ADR-0021),
   *  详情=Modal(TodoModal 三 tab:当天/7 天/收集箱 + 点掉完成 + 速记入收集箱)——
   *  首个可写图标类型。 */
  todo: def('todo', {
    label: '待办',
    kind: 'extension',
    editor: [],
  }),

  /** 视频更新:扩展类型,单例(博主注册表是账号级后端数据、无可绑实例参数,见 CONTEXT.md「视频更新」)。
   *  data 无字段;3×2 大 tile(块内全分类混合视频流,一行一条:24h 红点 + 博主名·相对时间 +
   *  标题截断 + 平台标记,点行外跳原平台),详情 Modal(全部/未分类/各分类/管理 tab,ADR-0022
   *  「更多」标头唯一入口)。数据 = 后端持久化 + 1h 轮询预取(ADR-0023)、取数路线 ADR-0024;
   *  前端只读、hook 自持轮询(同 aihot/todo 先例,不入集中层)。 */
  video: def('video', {
    label: '视频更新',
    kind: 'extension',
    editor: [],
  }),

  /** 模型追踪:扩展类型,单例(见 CONTEXT.md「模型追踪」——档案全局共享,实例无可绑参数)。
   *  data 无字段;3×2 大 tile(块内滚动展示跟踪模型:名称 + 厂家 + 种类·阶段·开放方式 +
   *  最近动态时间,24h 新动态红点),详情 Modal(「全部」+ 各厂家 tab,模型行就地展开
   *  基本资料/动态时间线/原始信源,不套第二层 Modal),「更多」标头唯一入口(ADR-0022)。
   *  数据 = 后端全局持久档案 + 6h 轮询(ADR-0025),前端只读、hook 自持(同 aihot/todo/video)。 */
  model: def('model', {
    label: '模型追踪',
    kind: 'extension',
    editor: [],
  }),

  /** 新闻:扩展类型,单例(「新闻源」勾选是账号级后端数据,见 CONTEXT.md「新闻/新闻源」)。
   *  data 无字段;3×2 大 tile(块内全源混合单列滚动流:24h 红点仅限有时间条目 + 源名·
   *  相对时间 + 标题截断,点行外跳原文;热榜类源无逐条时间,行内时间自然省缺),详情
   *  Modal(全部/各源/管理 tab,「管理」= 16 源平铺复选勾选),「更多」标头唯一入口
   *  (ADR-0022)。数据 = 后端 30min 轮询预取落库(ADR-0027)、源定义移植自 newsnow
   *  (MIT),前端只读、hook 自持(同 aihot/todo/video/model 先例)。 */
  news: def('news', {
    label: '新闻',
    kind: 'extension',
    editor: [],
  }),

  /** GitHub 趋势:扩展类型,单例(见 CONTEXT.md「GitHub 趋势」——默认视图全局一份,实例无可绑参数)。
   *  data 无字段;3×2 大 tile(块内 Today 趋势单列滚动榜:语言色点 + repo 名 + 周期内
   *  star 增量,点行外跳仓库页),详情 Modal(口语/编程语言/周期三行胶囊正交筛选,组合
   *  切换即按需现拉),「更多」标头唯一入口(ADR-0022)。数据 = 后端 HTML 解析抓取
   *  (无官方 API)、默认组合 cron 1h 保热、其余组合现抓 + 内存缓存(ADR-0028),
   *  前端只读、hook 自持(同 aihot/todo/video/model/news 先例)。 */
  trending: def('trending', {
    label: 'GitHub 趋势',
    kind: 'extension',
    editor: [],
  }),

  /** 服务器状态:扩展类型,单例(机器清单是 env 级全局配置,实例无可绑参数,见 CONTEXT.md「服务器状态」)。
   *  data 无字段;3×2 大 tile(块内每台机器一行:状态点 + 机器名 + CPU/内存百分比,
   *  简单信息;离线红点 + 陈旧提示),详情 Modal(tab 按机器分页:概览数字块 + CPU/
   *  内存 24h sparkline + 服务/容器状态清单),「更多」标头唯一入口(ADR-0022)。
   *  数据 = 两台机器上的 servermon exporter(thinkpad-ubuntu 仓库)→ 后端快照
   *  60s TTL + 10min 采样落库,前端只读、hook 自持(同 aihot/todo/video/model/news/trending 先例)。 */
  servers: def('servers', {
    label: '服务器',
    kind: 'extension',
    editor: [],
  }),

  /** 倒计时:扩展类型,单例(「重要日子」是账号级配置、「节假日」内置枚举,实例无可绑
   *  参数,见 CONTEXT.md「倒计时」)。data 无字段;1×1 普通占格——块内 = 下一条临近
   *  条目(主行剩余天数 + 次行名称,不限 30 天窗),点块打开详情 Modal(「重要日子」
   *  编辑的全局唯一入口 +「节假日」只读分区);时钟 hover 弹层另保留只读 30 天窗分区。
   *  纯前端本地推算(lib/countdown),无后端取数、零迁移(ADR-0026 寄放不动)。 */
  countdown: def('countdown', {
    label: '倒计时',
    kind: 'extension',
    editor: [],
  }),

  /** 分组(ADR-0011):iOS 文件夹式收纳容器(块内成员 favicon 3×2 迷你预览,ADR-0015)。
   *  kind='group' 不属于 base/extension 任一分区,
   *  新增抽屉按分区渲染时自然不列出——组只能经编辑模式合并手势诞生(POST /icons/merge),
   *  后端拒绝直接 POST type=group(空组不存活)。固定占 1 格、无 editor(改名走
   *  08 票分组弹层点名称)、无实时摘要。弹层打开/翻页/组内拖出在 08 票接入。 */
  group: def('group', {
    label: '分组',
    kind: 'group',
    editor: [],
  }),
}

// ── 查询函数(纯函数,直接 Vitest 断言)──────────────────────────────────────

/** 按 id 取定义;运行期未知 id 返回 undefined(类型层面 Record 已全覆盖)。 */
export function get(typeId: IconTypeId): IconTypeDefinition | undefined {
  return REGISTRY[typeId]
}

/**
 * 图标占用的画格数(ADR-0021):声明 span 的类型 = w×h,其余 1(undefined = 最小调用
 * 形态无 type,按 1 格)。容量计算(iconCapacity.cellsUsed / 后端 requireCapacity)
 * 与拖拽预校验共用本口径。纯函数 —— 直接 Vitest 断言。
 */
export function iconCells(typeId: IconTypeId | undefined): number {
  const s = typeId === undefined ? undefined : REGISTRY[typeId]?.span
  return s ? s.w * s.h : 1
}

/**
 * 是否允许新增该类型的实例。单例类型在已存在实例时拒绝(见 CONTEXT.md「单例类型」)。
 * 非单例类型恒允许。纯函数 —— 直接 Vitest 断言。
 */
export function canAdd(typeId: IconTypeId, existingTypeIds: IconTypeId[]): boolean {
  const def = REGISTRY[typeId]
  if (!def) return false
  if (!def.singleton) return true
  return !existingTypeIds.includes(typeId)
}

/**
 * 全部类型定义,按表中键序(基础类型先于扩展类型,内置 nav/stock/changelog 顺序稳定)。
 * issue 09 新增抽屉按基础/扩展分区渲染卡片时遍历用。
 */
export function listTypes(): IconTypeDefinition[] {
  return Object.values(REGISTRY)
}
