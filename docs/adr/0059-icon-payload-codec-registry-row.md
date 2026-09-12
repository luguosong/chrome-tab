# 图标载荷 codec 单源注册行:类型身份单源的延伸

背景:「一个图标类型的 data 长什么样」(载荷形状)在 ADR-0057 之后仍是注释知识——REGISTRY 行内注释记形状,九个消费文件各自 re-parse(`extractString` ×9 文件、`readWeatherLocation`、`changelogSourceOf`),编辑表单臂再 parse 一遍预填。类型**身份**已单源(五份手写 → shared 派生,compile 全守);类型**载荷**是手同步的平行结构——每个新类型、每次改字段都在 ≥4 处 fan-out(注册行注释、块渲染、详情 Modal、编辑表单)。架构评审候选 2(2026-09-12),grill 两轮裁决。

**决策:载荷形状收进类型注册行——`IconTypeDefinition<P>` 泛型化,codec(decode/encode)声明在类型行上,REGISTRY 经 mapped type `{[K in IconTypeId]: IconTypeDefinition<PayloadMap[K]>}` 静态全覆盖;消费方经 `decodeIcon(type, data)` 拿 typed payload。**

1. **decode 统一 strict(→ `P | null`)**:可选字段缺失是合法载荷(字段值 `undefined`);结构键违规 → null(weather 的 lat/lon 非数、changelog 的 source 非法 id);描述性字符串字段宽松投影('' 回落,`readWeatherLocation` 先例)。`data === null` 一律 → null(单例外)。
2. **域兜底单点,不散给消费点**:行声明 `fallback?: P`(仅 changelog:`{source: 默认源}`,ADR-0020 读侧兜底语义原样),模块出宽松读入口 `resolveIcon = decodeIcon(...) ?? fallback`;shared 的 `changelogSourceOf` 前端 import 随迁移消失、shared 导出不动。
3. **encode 窄边界**:只承诺 payload ↔ data 形状(字段名/嵌套/可空省略),服务编程写路径(分组改名)与往返测试;表单序列化 `serializeFields` 留在表单层(trim、`normalizeUrl` 等值规整是表单域知识),`editorFields.test.ts` 逐类型往返断言(serializeFields 产出 → decodeIcon 读回)守两层 coherence。
4. **空载荷单例**(todo/video/model/news/trending/servers/countdown 七家)PayloadMap 条目为 `null`——decode 恒 null、encode(null) → null;表仍静态全覆盖,条目显式而非缺席。
5. **消费最小面**:不改 ICON_TYPE_UI 的 body/detail props(渲染件自查一行 decode);`displayName?(payload)` 行上可选,服务 Icon.tsx 删除确认的通用取名(nav/stock/aihot/group 声明 `p?.name ?? ''`,其余缺省 ''——与旧 `extractString(data,'name')` 逐点等价)。
6. **ChangelogDetail wrapper 退役**:ChangelogModal 改收 icon 自解析(与 StockModal 同形)。

**代价与取舍。** 换来:「改一个类型的字段」从 4 处变 1 处(注册行);坏形状语义单点收敛;`extractString` 九文件散抄退役(表单臂三处无形状知识的机械读内联为 editorFields 私有助手,`iconData.ts` 公共面只剩 `faviconUrl` + 载荷化的 `navIconSrc`)。付出:REGISTRY 类型复杂度上升(`def()` 工厂泛型化 + PayloadMap 映射);渲染件每处一行 decode 调用仍在(调用点不消,形状知识单源)。行为保形:迁移逐点等价;唯一显式化点 = changelog 兜底从 `changelogSourceOf` 烘焙改为行声明 fallback(同值同效)。

**备选方案(已否决)**

- **兄弟表 `lib/iconCodec.ts`**(iconTypeUi adapter 先例):REGISTRY 不动,但「类型行 = 该类型全部前端知识单点」不成立,editor 字段与载荷分居两处,与「改字段摸 1 处」目标相悖。
- **adapter props 注入 payload**(dispatch 解一次、组件不见 raw data):24 个组件签名 churn,null 载荷渲染语义仍逐组件交代,收益薄——留档为后续可加档位。
- **codec 吞表单序列化**(prefill/serialize 进 codec):表单值规整是表单域知识,塞进 codec 反向依赖表单概念(浅化);往返测试守 coherence 已足。
- **Icon.tsx 壳 `==='nav'`/`==='group'` 行为字面量同批上行**(isLink/opensOverlay):另一个 deepening 面,另票。
