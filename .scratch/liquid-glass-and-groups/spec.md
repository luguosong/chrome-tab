Status: ready-for-agent

# Liquid Glass 全 UI 重塑 + 导航分组

## Problem Statement

chrome-tab 新标签页的功能骨架(8×8 图标网格、多页面走马灯、类型注册表、双端镜像同步)已就绪,但两块能力缺位:

其一,**视觉是一个过渡态**。全部样式挤在 `globals.css` 的两个工具类(`.page-panel` / `.glass-panel`)里,参数未定标、各浮层观感不一;外围 chrome(搜索框、页签条、抽屉、Modal)是朴素面板,时钟已被移出页面(`Clock.tsx` 现为未挂载的遗留组件);stock / weather 虽有按尺寸分档的专属布局,但整体仍是信息面板式排版,changelog 沿用通用密度——都没有「小组件」式的信息语言。用户要的是一个风格统一、有质感的整体界面,而非逐个组件的拼贴。

其二,**页面内没有收纳能力**。图标只能平铺在网格里,nav 图标一多就难找,没有类似 iOS 文件夹的分组:不能把同类网站收进一格、不能整组浏览、不能整理进出。

## Solution

两件事一体落地:

1. **整个新标签页 UI 按 iOS 26 Liquid Glass(液态玻璃)重塑**:三档材质体系(L0 页板雾化 / L1 regular 玻璃 / L2 clear 折射)覆盖图标层与全部外围 chrome(搜索框、页签条、时钟、抽屉、Modal),widget 内容按 iOS 小组件式重排——不止换容器,内容布局一并重做(ADR-0012)。
2. **nav 图标分组**:分组本身是一种图标(`type='group'`),编辑模式拖拽合并建组、暗化弹层浏览、拖出移出、× 解散;组固定占 1 格、子图标不计「页面容量」,复用既有注册表 / CRUD / @dnd-kit / 镜像同步全部基建,不新增同步机制(ADR-0011)。

## User Stories

### 分组

1. 作为用户,我想在编辑模式把一个「网站链接」图标拖到另一个上悬停、看到放大反馈后松手合成一个「分组」,使我能把同类网站收进一格。
2. 作为用户,我想点击分组图标打开暗化背景、居中的玻璃弹层浏览组内图标,使收纳的内容像 iOS 文件夹一样可翻看。
3. 作为用户,我想在弹层里点击子图标直接打开对应网站(弹层随之关闭),使组内图标开箱即用。
4. 作为用户,我想在弹层里点分组名直接改名、不限编辑模式,清空则回落默认名「新建分组」,使命名随手可改。
5. 作为用户,我想在编辑模式把图标拖到分组上悬停(与建组同一手势、同一放大反馈)加入分组,使分组可持续扩充。
6. 作为用户,我想在编辑模式的弹层里拖动子图标排序、或把它拖出到页面网格移出分组(按我原先设置的尺寸落回),使组内秩序可维护。
7. 作为用户,我想在编辑模式点分组上的 × 解散分组、子图标按保留尺寸洒回本页,使收纳完全可逆。
8. 作为用户,当组内最后一个图标被移出时分组自动消失,使我无需手动清理空分组。
9. 作为用户,当组内图标超过 9 个时弹层自动分页、滚轮翻页、有页点指示,分组图标预览显示前 9 个,使长列表也顺畅可用。
10. 作为用户,分组固定占 1 格、组内子图标不占页面容量,使收纳不挤占页面空间。

### Liquid Glass 外观

11. 作为用户,整个新标签页——图标层与搜索框、页签条、时钟、抽屉、Modal 等外围 chrome——呈现统一的 iOS 26 液态玻璃质感,使界面精致一致。
12. 作为用户,搜索框、页签条、右上胶囊、翻页箭头呈折射玻璃,背景在元素边缘产生真实折射与色散,使 chrome 有标志性观感。
13. 作为用户,抽屉与弹层呈 regular 玻璃(模糊背景、边缘高光),内容可读不受壁纸干扰。
14. 作为用户,股票 / 天气 / 更新日志图标按小组件排版(大价格 + sparkline / 城市 + 大温度 + 状况 / 版本列表),使信息一眼可读。
15. 作为用户,时钟回归页面顶部、iOS 锁屏式大字裸排,页签当前项实心白凸起,使层级与时间一目了然。

### 兼容

16. 作为现有用户,升级后现有图标、页面、布局原样保留、无需任何操作;旧版(schemaVersion=1)备份文件仍可导入,其中图标按无分组(parentId=null)处理。

## Implementation Decisions

### 领域模型(见 `CONTEXT.md`、ADR-0011)

- **分组 = 一种「图标」**:`type='group'` 的图标行,固定 `small`(占 1 格,不可切「尺寸」),组名存于图标 `data`(默认「新建分组」),经类型注册表(ADR-0001)注册渲染,复用 CRUD 与 @dnd-kit 拖拽(ADR-0003)基建。
- **子图标**:普通 nav 图标行加可空 `parent_id` 指向组行。子图标**保留自身 `size`**(移出后按原尺寸落回),组内统一迷你渲染,**不计「页面容量」**。只有 nav 类型可入组(服务端校验)。
- **两条序列各自独立**:页面序列 = `parent_id IS NULL` 的行按 `sort_order`;组内序列 = 同 `parent_id` 行按 `sort_order`,每组独立 0..n,无上限。
- **无嵌套**:`parent_id` 只能指向组行,组行自身 `parent_id` 恒为 null。
- **组内分页是纯展示切片**:弹层按 9 个/页自动流式分页(第 k 页 = 序列 `[9k, 9k+9)`),**不引入「组内页」实体**——无空页、无页管理;组图标 3×3 迷你预览恒取前 9 个(第一页)。
- `GET /api/config` 返回**扁平** icons 列表(子图标行带 `parentId`),前端自行按 `parentId` 派生页面序列与组内序列。

### 持久化与迁移(见 ADR-0011)

- Flyway **`V7__icons_parent_id.sql`**:`icons` 加 `parent_id BIGINT NULL` + 自引用 FK **`ON DELETE RESTRICT`**——有意偏离项目惯用的 CASCADE:删组行前必须先解散,DB 层防「误删组连带吞子图标」。纯加列,**无数据迁移脚本**。
- `IconType` 枚举加 `GROUP`(非单例);`Icon` 实体与 `IconResponse` 增 `parentId`。
- **备份 schemaVersion 1 → 2**(`frontend/src/lib/mirror/backup.ts`):wire 图标行增 **`id`**(客户端键,照 pages 先例——**现 wire 图标行无 id**)+ `parentId|null`。导出恒为 v2,导入**同时接受 v1 与 v2**(v1 无 `parentId` 按 null),不写转换器。注意:现 `parseBackupPayload` 是严格不等即拒,bump 后必须放宽为双接受,否则 v1 旧备份会被拒——与「旧备份兼容导入」的目标冲突。`parentId` 引用 wire 内的 `id`;全删重建与「导入(合并)」两条路径都要建 iconIdMap 重映射(照 pages 的 pageIdMap 先例),否则重建后组行拿到新 DB id、父引用悬空。
- `PUT /api/config` 整体替换(`ConfigReplaceService`):现用单条 `deleteAllInBatch` 清空——加 RESTRICT 后必须改为**先删 `parent_id` 非空行、再删顶层行**的两段有序删除(RESTRICT 逐行即时检查,同批删除先父后子即触发)。重建时 `parentId` 经 iconIdMap 重映射;校验(409)——parent 必须是组行且同页、成员必须是 nav、无嵌套、组至少 1 个成员(空组不允许存在)、每页容量只计顶层行(组按 1 格)。
- **空组不存活**:任何路径(move 移出、DELETE 子图标)使组变空,都在事务内自动删组行;导入校验拒绝空组。
- 组跨页移动时,事务内同步成员行的 `page_id`(成员 `page_id` 恒等于所属组的 `page_id`)。
- 分组随既有整体-blob LWW 镜像(ADR-0006)自然同步——和解 / 脏标记机制零改动,仅 wire 格式扩展(`id` + `parentId`)。

### 后端 API 契约

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/icons/merge` | 建组。body `{pageId, memberIds[]}`,memberIds 有序:首位 = 被拖图标 A、末位 = 悬停目标 B;组行继承 B 的 `sort_order`,成员脱离页面序列后空位由后续图标流式补上。事务内建组 + 挂成员。校验(违者 409):成员 ≥2、全 NAV、全在该页顶层。 |
| POST | `/api/icons/{id}/dissolve` | 解散组 `{id}`。成员按各自保留 `size` 自组的 `sort_order` 位置起洒回本页序列;页面容量不足 → 409(前端提示先移出部分图标)。 |
| PATCH | `/api/icons/move` | `MoveRequest` 增可空 `parentId`。null = 落页面序列(移出分组时按保留 `size` 计入目标页容量;源组因此变空则事务内自动删组行);组 id = 入组 / 组内重排——入组(当前 parent ≠ 目标组)恒落组内序列末尾,组内重排(同组)按 `toIndex` 夹紧插入。校验:目标是组行且成员是 NAV。 |
| PATCH | `/api/icons/{id}` | `UpdateRequest` 不变。组改名 = PATCH `data`;GROUP 的 `size` 修改拒绝(409)。 |
| DELETE | `/api/icons/{id}` | 组行含成员时 **409「请先解散分组」**(服务层前置校验,防 FK 异常裸露为 500);删除子图标使组变空 → 事务内自动删组行。 |

容量规则(`cellsUsed`)改为**只计 `parent_id IS NULL` 的行**;组行按 `small` 1 格计。

### 前端架构 — 分组交互(见 ADR-0003;调研结论 `research/dnd-overlay-drag-out` 分支 @ `d0a6ea1`)

- **注册表**(`iconTypeRegistry.ts`)加 `GROUP_DEF`:仅 small 档、无 editor;「新增抽屉」不列出分组类型(组只由合并手势诞生),组图标无尺寸菜单、无 ✎。
- **`Icon.tsx`**(改):`type='group'` 渲染分支——玻璃容器 + 组内前 9 个子图标 3×3 迷你 favicon + 名称外置(与 nav 名称同位)。
- **合并手势**(仅编辑模式):拖 A 悬停到 B(页面顶层 nav)达阈值 → B 放大反馈 → 松手调 `merge`;悬停对象是**组** → 同一放大反馈 → 松手调 `move(parentId=组id)`(加入)。组被拖到图标/组上**不触发**合并反馈,按普通排序落下。dwell 阈值、悬停命中半径、放大倍率等手势参数留实现票。
- **`GroupOverlay`**(新):单一根 `DndContext` 的 React 子树内 portal 渲染(硬约束,否则 `useSortable` 静默失效);暗化 backdrop 常态 `pointer-events: none`、内容区单独恢复交互(否则拖出后 over 永远落不到页面网格);弹层 = 拖拽体系里「第 N+1 个容器」(`SortableContext id=组id`),跨容器搬移照官方 MultipleContainers 三段式——onDragStart 快照 → onDragOver 判容器变化乐观搬移(判空 / 同容器早退守卫)→ onDragEnd 收尾、onDragCancel 回滚,与项目跨页拖拽同机制。
- 弹层关闭判定放 onDragEnd(确认落点是页面网格才关);拖拽中途**绝不卸载**弹层或被拖项;ESC 取消回滚、弹层保持开。
- 滚轮翻组内页(不透传背景走马灯;≤9 个成员吃掉滚轮事件);页点指示器。
- 乐观更新 / 回滚沿用 `DashboardPage` 现有聚合缓存快照机制;新纯函数 `groupReducer`(merge / dissolve / move-out 状态转移、组内分页切片)。编辑模式入口保持右键为主,长按为辅入口(阈值实现票定)。

### Liquid Glass 材质体系(见 ADR-0012;调研结论 `research/liquid-glass` 分支 @ `bc2b909`)

- **三档材质**(参数为原型实机验证后的定稿候选,落 `globals.css` token):
  - **L0 页板雾化**(整视口内容画布;项目自创档,非 Apple 官方两档之一):`blur(8px) saturate(140%)`、亮 `rgba(255,255,255,0.18)` / 暗 `rgba(18,18,23,0.36)` + 顶部内高光——**现 `.page-panel` 参数已与此一致,本 spec 仅定标、不改动**。
  - **L1 regular**(弹层 / 抽屉主力档,= `.glass-panel` 升参):`blur(20px) saturate(180%)`;亮 `rgba(255,255,255,0.55)` / 暗 `rgba(24,24,27,0.50)`;border、顶部内高光、外阴影均明暗双值;文本密集面板垫可读性兜底层(亮 `white/20` / 暗 `black/20`)。
  - **L2 clear 折射**(搜索框 / 页签条 / 右上胶囊 / 翻页箭头):`backdrop-filter: url(#lens) blur(2px) saturate(160%)` + 近透明底 `rgba(255,255,255,0.06)`;SVG 滤镜链 `feImage`(元素专属 map)→ `feDisplacementMap`×3(scale -148/-150/-152,RGB 色散)→ `feGaussianBlur(0.7)`。

  明暗双值中「亮」分支在当前永久深色的产品下不生效(`CONTEXT.md`「本地镜像」:主题永久深色),token 仍按表落全——为将来主题化留量,成本为零。
- **图标层**:nav = app 图标式 squircle 玻璃底板(soft 档:`blur(6px) saturate(150%)`、`rgba(255,255,255,0.16)`、圆角 24%)+ 名称外置;**glass-on-glass(图标玻璃坐 L0 页板)经原型裁决放行**——对 Apple「禁叠放」铁律的有意让位,以 L0 轻档 + 图标 soft 档拉开层级(ADR-0012 记录)。
- **`LensBox`**(新):L2 折射容器组件。mount 后按实测盒尺寸(`getBoundingClientRect`)用 canvas 逐像素 rounded-rect SDF 生成 displacement map(128 = 不位移;≈60 行,借鉴 shuding 方案,**不引库**),`ResizeObserver` 重建;多元素同屏考虑共享 map(帧率实测后定)。`@supports (backdrop-filter: url(#f))` 不满足自动回落 L1——廉价保险,目标虽是 Chrome。
- L2 仅用于少量 chrome 元素,不大面积铺(每滤镜实例占 GPU 资源)。

### 外观重排(不止换容器)

- **widget 小组件式排版**:stock = 大价格 + sparkline(按尺寸分档密度,ADR-0007);weather = 城市 + 大温度 + 状况;changelog = 版本列表。
- **页签条**:active 页签 = 实心白凸起(非玻璃)。
- **时钟**:iOS 锁屏式大字裸排(不上玻璃)。
- 外围 chrome 全部 Liquid Glass 化:搜索框 / 页签条 / 右上胶囊 / 翻页箭头升 L2;抽屉 / Modal / 分组弹层 L1。原型参照:`prototype/liquid-glass` 分支 @ `3f10ddf`。

## Testing Decisions

**测试哲学**:沿用 icon-grid-system spec——只测外部行为,不测实现细节;纯逻辑抽纯函数(Vitest),后端契约 `@SpringBootTest` + H2,拖拽与视觉手动验证。

### 接缝 1 — 后端 REST 契约(`@SpringBootTest`)

- merge:建组成功(继承末位成员 `sort_order`、成员脱离页面序列、空位流式补上);409 分支——成员 <2 / 含非 NAV / 含组行或已入组图标 / 跨页。
- dissolve:洒回顺序与保留 `size`;容量不足 409。
- move 三态:入组恒落末尾、组内重排 `toIndex` 夹紧、移出计容量 + 空组自动删除;组跨页移动同步成员 `page_id`。
- 容量只计顶层行(组 1 格、子图标不计);PATCH 拒绝 GROUP 改 `size`。
- `PUT /api/config` 含组:关系保留;孤儿 parent / 非 NAV 成员 / 嵌套 / 容量超限 → 409。
- 形式:沿用 `IconControllerWriteApiTest`(MockMvc + jsonPath + `@Transactional` 回滚)。

### 接缝 2 — 前端纯逻辑函数(Vitest)

- `groupReducer`:merge / dissolve / move-out 状态转移 + 组内分页切片(`[9k, 9k+9)` 边界)。
- `iconCapacity` 扩展:组行 1 格、子行不计。
- `backup`:v1 / v2 双版本解析兼容。

### 不测的部分

- 拖拽手势(dwell / 悬停 / 放大反馈)、弹层视觉、`LensBox` 渲染、材质观感——纯 UI,手动验证。

## Out of Scope

- **组嵌套**:组里套组,不做。
- **非 nav 类型进组**:stock / weather / changelog 不能入组(服务端强制)。
- **组尺寸切换**:组固定 1×1,不做尺寸菜单。
- **跨组内页重排**:自动流式分页下顺序本就跨页流动,长尾需求,不做。
- **组的自动命名**:无分类数据源。
- **新建空分组入口**:「新增抽屉」不提供分组类型,组只由合并手势诞生。
- **分组专用的导入导出 / 模板化**等页面级能力(组随 v2 备份走通用导入导出,不在此列)。
- **图标编辑能力扩展**:沿用现有 ✎ 编辑。
- **Safari / Firefox 的 L2 折射**:目标即 Chrome 新标签页;`@supports` 回落 L1 已兜底。

## Further Notes

- 相关 ADR:`0011-groups-as-icon-rows-with-parent-id`、`0012-liquid-glass-three-tier-material-system`(既有:0001 / 0002 / 0003 / 0006 / 0007 / 0008)。
- 术语以 `CONTEXT.md` 为准(本 spec 新增「分组 (Group)」并修订「图标」「页面容量」「编辑模式」)。
- 建议实现顺序(已在 `issues/06–12` 拆分,每票可独立验证):① 06 数据轴(后端 + 备份 v2)→ ② 07 分组网格交互 → ③ 08 分组弹层;09 视觉基建与 06–08 **并行** → ④ 10 图标层换肤 → ⑤ 11 外围 chrome 换肤 → ⑥ 12 详情面板 + 跨票回归。
- 调研 / 原型资产(throwaway 分支,票内有指针):`research/liquid-glass` @ `bc2b909`、`research/dnd-overlay-drag-out` @ `d0a6ea1`、`prototype/liquid-glass` @ `3f10ddf`。
