# 天气图标:后端代理 + 多位置 + 经纬度统一取数

> **注记(2026-08-20)**:后端代理与经纬度统一取数不变;WeatherIcon 三档密度已被 [ADR-0016](0016-icon-single-size-minimal-density.md) 取代——网格仅剩 small(状况图标 + 温度),空气/预警归详情 Modal。

「天气」作为扩展图标类型加入注册表(ADR-0001),**非单例**:每个实例绑定一个用户选择的城市,展示该位置的实况、空气质量、灾害预警。与「自选股」同为多实例富数据类型,但取数走**后端代理**而非前端直连——和风天气 API 必须带 Key,前端直连会泄露 Key,且和风不保证 CORS;这与 ADR-0005 否决「前端直连翻译 API」是同一条理由。后端 `weather/` 包克隆 `changelog/`/`wallpaper/` 的代理范式:`@ConfigurationProperties("newtab.weather")` 绑定 `api-key`(走 `QWEATHER_API_KEY` 环境变量、不入库)+ `api-host`(个人专用主机 `xxx.qweatherapi.com`),`RestClient` 发请求,内存 TTL 缓存。

**经纬度作为统一坐标**是本 ADR 的关键取舍。城市经和风 GeoAPI(`/geo/v2/city/lookup`)搜索、按 adm1/adm2 消歧后,解析出的 **lat/lon** 存入图标 `data`(`{ name, adm1, adm2, lat, lon }`);三套数据全部用这组经纬度取数,不再保留 Location ID。原因:和风的**空气质量 v1(`/airquality/v1/current/{lat}/{lon}`)与天气预警 v1(`/weatheralert/v1/current/{lat}/{lon}`)只接受 lat/lon 路径参数**,而实况 `/v7/weather/now` 虽以 Location ID 为主、但也接受 `lon,lat`——统一到经纬度后三端点入参一致、GeoAPI 仅在选位置时调用一次。Location ID 在这种入参模型下没有额外价值(YAGNI),弃用。

**刻意的反直觉取舍与备选否决:**

- **否决「前端直连和风」**:Key 会暴露在浏览器,且和风未承诺跨域。后端代理同时解决 Key 安全与 CORS,并集中缓存压 QPM(免费层 5 万次/月、有每分钟 QPM 上限)。
- **否决「单例天气图标」**:天气在概念上是「我在哪/关心哪几个城市」,多实例(家、公司、目的地)有真实需求;单例是 YAGNI 之外的过度收敛。多实例 → 取数照「自选股」范式上提到 `IconDataContext`:收集所有天气图标的 lat/lon 一次、批量拉取后经 Context 下发(N 个图标 = 1 次批量请求,而非 N×3)。
- **否决「仅实况」**:用户明确要空气与预警;三者各自独立端点、各自缓存桶,互不耦合,后续单独增减不影响其余。
- **否决「v7 旧端点」**:`/v7/air/now` 已于 2026-06-01 停服(本 ADR 落地时已死)、`/v7/warning/now` 将于 2026-10-01 停服;新建在将死端点上无意义。改用 v1 空气/预警端点。`/v7/weather/now` 仍在服务且接受 `lon,lat`,沿用。
- **否决「逐图标各自 fetch」**:重复请求、放大 QPM;照「自选股」集中取数范式,前端 `GET /api/weather?location=lat,lon&location=lat,lon` 批量,后端按 (lat,lon,endpoint) 分桶缓存。

**端点与字段归一化**:v1 空气返回 `{ indexes[], pollutants[] }`(多套 AQI 标准、多污染物,值为数值),v1 预警返回 `{ alerts[] }`(每条含 `headline`/`severity`/`color{rgba}`/`eventType.name`/`description`,**无** v7 的 `level`/`typeName`)——后端把这些数组形态归一化成扁平 DTO 再下发前端,前端不感知和风原始的数组嵌套与多标准选择(空气取和风通用 AQI `qaqi` 为准、污染物按 code 映射)。城市搜索另走 `GET /api/weather/locations?q=<城市名>`,后端代理 GeoAPI、返回 `[{ name, adm1, adm2, lat, lon }]` 供前端「新增抽屉」的城市选择器消歧用。

**城市选择 UI**:新增抽屉的配置表单原本只有简单文本字段(`name`/`url`/`symbol`,见 `iconTypeRegistry.ts`)。天气需要「异步搜索 + 结果列表 + 选中」的交互且要消歧(「朝阳」北京有、辽宁也有),故扩展 `EditorField` 联合增加 `location` 变体,新增抽屉为该变体渲染一个搜索框 + 下拉(GeoAPI 结果),选中即把 `{ name, adm1, adm2, lat, lon }` 写入待提交 data。这是对 ADR-0001 注册表契约的既有扩展点(`editor` 字段声明)的正常使用,而非绕过架构。

**缓存与降级**:后端按 (lat,lon,endpoint) 内存 TTL 缓存——实况 `10min`、空气 `30min`、预警 `5min`(预警变化最快,短 TTL)。Key/host 未配置或上游不可达 → 抛异常经既有 `GlobalExceptionHandler` → 前端走与「自选股」一致的「刷新失败/重试」降级,不展示半截数据。重启即清缓存可接受(天气数据分钟级刷新,重拉一次无感)。
