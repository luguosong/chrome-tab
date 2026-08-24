# 大 tile 详情唯一入口「更多」按钮;changelog 3×2 跨格第二例,Drawer → Modal

背景:Claude Code / Matt Skills 两个更新日志实例(同 `changelog` 类型,ADR-0020)单格只显示最新版本号+日期,版本流的展示价值没出来,用户要求参照 AI 热点(ADR-0021)改 3×2 大 tile:标头显示版本+更新时间,点开看更新详情。交互同时收敛:AI 热点上线后「点 tile 任意处开详情」affordance 不显式(用户不知道能点、误触率高),用户决定改为标头「更多」按钮显式入口。

**决策:跨格大 tile 的详情唯一入口 = 标头「更多」按钮,整块点击无操作;changelog 复用 ADR-0021 size 原语声明 3×2;changelog 详情容器从 ChangelogDrawer 换成 ChangelogModal。**

1. **changelog 声明 `size: {w:3, h:2}`**:跨格第二消费者,验证 ADR-0021 原语零成本扩展——前端注册表 + 后端 `TYPE_SPANS` 镜像各一行,容量校验(前后端同口径 w×h)自动跟进。同类型两实例(Claude Code / Matt Skills)一起变 3×2,无逐实例配置。
2. **「更多」按钮 = 详情唯一入口(部分取代 ADR-0021 第 5 点的点击派发)**:大 tile(aihot/changelog)整块点击无操作——`Icon.tsx` 对声明 size 的类型不挂 Tag onClick;详情打开走 body 标头「更多」按钮,`openDetail` 由 Icon 直调下发 body(不经 DOM 冒泡——祖先 stopPropagation 会连按钮一起吞,显式 prop 更直白)。aihot 条目 stopPropagation 外跳照旧(看新闻的核心路径,不属于「整块点击」)。单格类型(stock/weather)保持整块点击开详情不变。编辑模式/拖拽幽灵下 `openDetail` 为 undefined,按钮不渲染(编辑态无交互元素,同 aihot 条目链接降级哲学)。

   > **注记(2026-08-24,天气 3×1)**:「对声明 size 的类型不挂 onClick」的隐式判据改为显式字段 `detailEntry`('header' = 本决策的「更多」按钮唯一入口;缺省 'block' = 整块点击)——天气成为首个跨格但无滚动主体的类型(3×1 小时序列,点块开详情),`size` 不再蕴含「更多」范式。aihot/changelog/todo 声明 'header',行为不变。
3. **ChangelogDrawer → ChangelogModal**:容器已是居中 Dialog,实质是砍检索框、对齐 aihot/weather Modal 范式并更名;`DetailContainer` 枚举随之收敛为 `'none' | 'modal'`(drawer 值无消费者,删)。**保留按需「翻译」按钮**(砍掉则未译版本永久英文——补译主要靠按需 POST,ADR-0017);砍检索框(版本列表纵向滚动即达,大 tile 榜单已把「找最新」解决)。
4. **每版本发布时间:npm `time` 全表透传,不落库**。`fetchReleasedAt` 升级 `fetchReleaseInfo`({latest, times}),`releasedAt = times[latest]`,响应加 `releaseTimes`(版本号→ISO)。快照表不加列:重启恢复(loadFromDb)时置空表,启动紧跟的 refreshQuietly 拉 npm 补齐,缺失窗口仅重启后数秒——省一列迁移与读写;npm 失败时空表降级,版本行不显示时间。npm 版本号与 CHANGELOG 标题错位(ADR-0020 已注记的已知错位)的条目同样降级不显示。

> **注记(2026-08-24)**:Matt Skills 的 npm `time` 只含 `1.3.0`,与 CHANGELOG/GitHub Releases 的 `1.2.x` 版本键不一致,故该外源的 `releaseTimes` 改取 GitHub Releases `tag_name`/`published_at`;其余外源仍取 npm。

**代价与取舍。** tile 榜单只渲染前 30 版(全量 300+ 版 DOM 无谓,看全量走 Modal);tile 上相对时间(同 aihot `timeAgo`),Modal 里绝对日期(YYYY-MM-DD)。「更多」按钮两处复用抽成 `MoreButton` 组件。检索功能整体移除——若未来版本量级到需要检索(如全局搜某功能何时引入),在 Modal 顶部再加回,不是本次范围。
