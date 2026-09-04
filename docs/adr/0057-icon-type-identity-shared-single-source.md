# 图标类型身份单源 shared:五份手写收敛为派生

背景:「一个图标类型是什么」的身份枚举在仓内五处手写——前端 `lib/types.ts` 小写 union、`lib/iconTypeRegistry.ts` REGISTRY、`components/iconTypeUi.tsx` ICON_TYPE_UI、backend `src/icons.ts` 三张表(大写数组 / 格数表 / 单例数组)、`iconTypeUi.test.tsx` 手抄镜像;跨度两形态(前端 `{w:3,h:2}` vs 后端 `AIHOT: 6`)、singleton 两遍(前端 boolean ×8 vs 后端数组 ×8)、大小写两形态(小写 id vs 大写 wire)。同步唯一机制是 backend icons.ts 的注释——且已实证失效:weather 前端 2026-09-01 收回 1×1(registry 注释为证),后端 `TYPE_SPANS` 仍按 `WEATHER: 3` 收容量,分组解散 / move / config 全量替换的容量口径全偏 2 格。tsc 的 `Record` 静态全覆盖只挡「漏登记」,挡不住「值不一致」。

**决策:`shared/src/iconTypes.ts` 持唯一事实源——`ICON_TYPE_META: Record<IconTypeId, { span?; singleton }>` 一张表 + `IconTypeId` / `IconWireType`(`Uppercase<IconTypeId>`)+ `toWireType` / `fromWireType` 映射;backend 三张表(ICON_TYPES / TYPE_SPANS / SINGLETON_TYPES)与前端 REGISTRY 的 span / singleton 全部改为自它派生 / 展开,值不再第二处手写。**(ADR-0018 通道的入驻,同 `CHANGELOG_SOURCES` / `NEWS_SOURCES` 先例。)

1. **容量口径只看格数**:backend `TYPE_SPANS` 的数字形态从 shared 的 `{w,h}` 派生为 `w*h`,有意丢弃方向(1×6 与 6×1 同占 6 格)——窄形态由「派生」而非「注释对齐」保证,weather 类失步从此是编译期不可能,不是 code review 肉眼。
2. **shared 持小写 id**:前端两张 `Record` 表键可读、消费方多;wire / DB 大写经 `Uppercase<IconTypeId>` 类型派生,id 全为纯小写单词、大小写往返无损,`toWireType` / `fromWireType` 即裸 `toUpperCase` / `toLowerCase` 的类型收紧单点(前端 config.ts 归一化与 backup.ts 写路径四处裸转换收敛至此)。DB 存量不动(原生大写)。
3. **字段定名 `span`,退役 REGISTRY 的 `size`**:ADR-0016 已退役「图标尺寸」概念,该字段语义一直是「画格跨度」(backend `TYPE_SPANS` / ADR-0021 词条同源);单源建立是新契约定名的唯一廉价窗口,消费方三处源码 + 七处测试断言由 tsc 兜底跟改。
4. **weather 容量修正(3 → 1)**:随派生自然生效,与前端 09-01 收回 1×1 的裁决对齐。这是行为变更:容量校验 / 分组解散 / blob 全量替换对 weather 收窄 2 格——修正而非特性,后端按 3 格误收是漏跟。
5. **测试面**:shared 表钉清单测试落 frontend(frontend/src/lib/iconTypes.test.ts,editorFields.test 同「前端基建直测 shared」先例):13 id、span 集、singleton 集、wire 往返——这是双端裁决的回归护栏;`iconTypeUi.test.tsx` 的 UI 映射镜像保留(body / detail / detailEntry 是纯前端单源,快照断言职责仍在);backend `modelTracking.test` 既有的 SINGLETON / TYPE_SPANS 断言照常通过(值不变,来源变)。

**备选方案(已否决)**

- **双端契约测试对照**(后端表与前端表互 assert):跨包测试难维持,且测试只能事后报警;派生让漂移在编译期不可能,测试只兜「裁决本身被误改」。
- **shared 持大写 id(照 DB)**:前端两张 `Record` 键全改 `'AIHOT'` 形态,改动面反增;wire 大写已在类型层经 `Uppercase<>` 派生,无需值层再持一份。
- **维持现状(五份手写 + 注释)**:失步已实证,非假设风险。

**代价与取舍。** 换来:跨度 / 单例 / 身份的漏改从「注释提醒」变「编译器捕获」;新增图标类型的接入面从五文件缩到两(registry 条目 + UI adapter 行,span / singleton 在 shared 表一处);weather 类容量口径分叉根治。付出:REGISTRY 条目的 span / singleton 值经 spread 展开、定义处不再字面可见(读 REGISTRY 需跳 `ICON_TYPE_META`,换来双端唯一事实);shared 在「wire 契约类型」之外新承一类「身份元数据常量」(仍是零构建纯 TS,ADR-0018 契约不变);backup.ts 导入路径的防御性 `toUpperCase` 透传保留原样(导入值未经白名单校验,不是「小写 id → 大写」转换,窄签名的 `toWireType` 不适用)。
