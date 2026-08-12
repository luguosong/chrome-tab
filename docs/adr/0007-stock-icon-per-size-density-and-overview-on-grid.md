# 股票图标:按尺寸分档的专属网格渲染 + 公司概述上 large 网格

股票图标脱离通用 `Icon` 的居中"favicon+名称+摘要"布局,改由专属组件 `StockIcon`(由 `Icon.tsx` 在 `type==='stock'` 时委托)按尺寸分三档信息密度、左对齐 ticker 卡渲染:small(1×1)=名称+当前价;medium(2×2)=名称+当前价+涨跌幅%;large(3×2)=名称+符号+当前价+涨跌(绝对+%)+总市值+PE+行业。`STOCK_DEF.sizes` 由 `['medium','large']` 扩为 `['small','medium','large']`,默认仍 medium。

这一档逆转了两条既有决定,故留痕:① 上一轮(本会话)为"让中尺寸股票显示价格"临时放宽了通用摘要的尺寸门槛——现由 `StockIcon` 的三档布局完整承担,通用 `Icon` 的摘要恢复为"仅大尺寸",避免两套机制叠加;② 修订 ADR-0004 / 设计 Q3 的"公司概述 Modal 独占"——`公司概述` 的一个**子集**(市值/PE/行业)现在出现在 large 网格上,Modal 仍保留**全量**(再加主营/官网)+ 行情。

数据接线不变初衷、收敛成本:large 的 `StockIcon` 直接复用 `useCompanyProfile`/`useFundamentals`(同 `StockModal`),非 large 不调用 → 公司概述数据**只为 large 股票图标拉取**,行情 `quotes` 仍由 `IconDataContext` 集中下发供三档共用。指数型标的(上证/纳指等)无 `公司概述`,large 只显示行情行(profile/fundamentals 为 null,对应行自动隐藏),与 Modal 的降级一致。
