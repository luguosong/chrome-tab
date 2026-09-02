# 股票公司概述:东方财富双端点、纯前端取数

股票图标的「公司概述」(主营业务、行业、官网、上市交易所等静态属性,以及市值/市盈率等随价派生量)全部由浏览器直接向**东方财富**的两个公开端点取数,不新增任何后端代理。静态属性走 `datacenter-web.eastmoney.com` 的 `RPT_F10_BASIC_ORGINFO`,该端点直发 `Access-Control-Allow-Origin: *`,前端用普通 `fetch()` 即可;随价派生量(市值/PE/PB/换手率)走 `push2.eastmoney.com`,无 CORS 但支持 JSONP(`cb=`),沿用现有 `useQuotes` 的 `<script>` 注入模式。

刻意的反直觉取舍:**不复制 `WallpaperController` 的后端代理范式**。壁纸走后端代理,只因 Bing 既不发 CORS 头、又不支持 JSONP,浏览器无法直连;东方财富两端点一个 CORS 开放、一个 JSONP 友好,浏览器都能直连,故与现有"行情报价"保持同一架构姿态(纯前端、react-query 缓存)。亦否决了"继续用腾讯取概述"——腾讯的 F10 JSONP 端点已失效(返回 `code:11`),腾讯仅保留承担现有报价。代价是耦合东财字段编码(`f162` 等需 ÷100 解析)与厂商分裂(腾讯报价 + 东财概述),耦合点收敛在各自的 parser。

范围边界:`公司概述` 仅适用于**公司型**标的;**指数型**标的(上证指数、纳指等)无公司概述,Modal 只复用现有点位/涨跌(`实时摘要`),渲染期区分、不拆分 `IconType.STOCK` 子类型。美/港静态 report 名未验证,拿不到时优雅降级为仅显示随价派生量;静态数据 react-query 长缓存(24h 量级),随价数据并入现有 60s 轮询,一律不入库 `icon.data`。

## 附注:K 线(收盘价折线)同源落地

本 ADR 原 spec(`spec.md` Out of Scope)将「股票详情里的真实 K 线数据源」列为范围外、先用占位。后已落地,沿用同一架构姿态:浏览器直连东财 **`push2his.eastmoney.com/api/qt/stock/kline/get`**,JSONP(`cb=`)绕 CORS,react-query 缓存(`staleTime` 60s、不轮询——Modal 短生命周期 + 120 根 payload 较大,重开超 60s 才重取)。取 `fields2=f51,f53`(日期+收盘)、`klt=101` 日线、`fqt=1` 前复权、`lmt=120`。公司与指数均适用(secid 对指数成立,如 `sh000001`→`1.000001`);美股指数 secid 未必命中,优雅降级为「暂无数据」。parser(`parseKlines`)收敛逗号串解析,与 `parseFundamentals` 同接缝、同 Vitest 覆盖。渲染为手写 SVG 收盘折线(无第三方图表库,`vector-effect` 保描边、CSS 变量取涨跌色)。

## 附注:K 线时间档位与当日分时(修订「不轮询」)

K 线区后增四档胶囊(当日|近一月|近一年|全部,默认近一年),按档各拉各存(queryKey 含档位)。**上段「不轮询」仅日线档继续成立**;当日档为 `klt=1` 1 分钟分时、随行情 60s 轮询(Modal 关闭即停)——分时的价值在实时,不轮询即死数据,与 quotes 同节奏不开新例外。当日档解析层按最新交易日过滤(`latestDayOnly`:东财按根数回溯,早盘会混入上一交易日尾段),叠昨收虚线为分时专属语义。悬浮 crosshair+tooltip(手写 SVG 内实现,无新依赖)。

2026-09-02 档位收拢:档位语义(是否分时、昨收锚、轮询节奏)单点声明于 `lib/kline.ts` 的 `KLINE_RANGES`(Record 编译穷尽,加档 = 加一个条目),图型决策(锚 / y 域 / 虚线显隐 / 悬浮涨跌基 / 横轴形态)由 `klineChartModel` 按声明分派——调用方(Modal)**无脑传昨收、不持档位判别**,「日线不消费昨收」由 module 内裁决(曾靠调用方一行三元自律,该 bug 已实锤一次:e20c581)。分时昨收**同源自东财**:取同一 kline 响应的 `data.preKPrice`(前复权口径与序列一致,除权除息日不漂移),不再取腾讯报价的原始昨收——跨厂商口径分裂曾使除权日虚线/涨跌锚/悬浮 % 错一个分红/拆股量。指数 secid 的 `preKPrice` 在场性待线上 devtools 确认一次;缺失走设计内退化(无虚线、锚退首根)。

