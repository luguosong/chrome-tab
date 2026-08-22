# API 契约底稿(2026-08-21 双侧提取)

来源:后端 `backend/src/main/java/com/personal/newtab/` 全部 Controller 及其 Service/record;前端 `frontend/src/api/`(`auth.ts`/`client.ts`/`config.ts`/`wallpaper.ts`)与散落在 `hooks/`、`context/` 的直接 `apiFetch` 调用点。只陈述代码事实,不做设计判断。

## 0. 横切约定(全部端点共用)

**鉴权**(`config/SecurityConfig.java`):`/api/login`、`/api/ping` 放行;其余 `/api/**` 需登录;非 `/api`(静态资源)放行。未认证 → **401 空体**(`HttpStatusEntryPoint`,非默认 403)。同源部署:CORS/CSRF 关(SameSite=Strict cookie 已防 CSRF)。

**会话**:Spring Security + Tomcat 内存 session。cookie `JSESSIONID`,httpOnly、SameSite=Strict、max-age 30d(prod profile 加 secure,`application.yml`)。后端重启 session 全灭(见 issues/04 考古结论)。

**错误体**(`common/ErrorResponse.java` + `GlobalExceptionHandler.java`),所有错误统一 `{"status": int, "message": string}`:

| 场景 | 状态码 | message |
|---|---|---|
| jakarta `@Valid` 校验失败 | 400 | `"字段: 消息; …"` 拼接 |
| 凭据错误(`BadCredentialsException`) | 401 | `用户名或密码错误` |
| 其他 `AuthenticationException` | 401 | `未认证` |
| 业务冲突(`OperationConflictException`,自带 status) | 404/409 | 各 Service 拼的中文消息 |
| 未映射路径(含已删除的 `/api/nav-links`、`/api/stock-watches`) | 404 | `资源不存在` |
| 唯一约束等 DB 冲突 | 409 | `数据冲突，可能已存在` |
| 兜底 | 500 | `服务器错误`(留栈) |

**前端消费形态**(`frontend/src/api/client.ts`):统一 `apiFetch<T>`——`credentials: 'include'`、`Content-Type: application/json`;非 2xx 读 body 的 `message` 抛 `ApiError(status, message)`;204 返回 `undefined`。成功后普遍 `invalidateQueries(['config'])` 重拉聚合,多数写端点的响应体实际被丢弃(逐条见下)。

**config_version 镜像语义**(ADR-0006):任意配置写(pages/icons/layout-settings/config 全量替换)在写事务末尾 `ConfigVersionService.touch(userId)` bump `config_version.updated_at`,与配置写原子(回滚则不前进)。`GET /api/config` 下发该时间戳;前端 IndexedDB 本地镜像(`ConfigSyncProvider.reconcile`)据 `updatedAt` 做整体-blob LWW 和解——新者整份赢,离线脏则整体 PUT 推回。

---

## 1. auth(3 端点)——已冻结(见 issues/04)

issues/04 第 4 条为冻结验收清单,以下为代码现状(两侧一致,`Me` = `{id: number; username: string}` = `MeResponse(Long id, String username)`)。

### POST /api/login ——已冻结(见 issues/04)
- 请求体:`{username: string(@NotBlank), password: string(@NotBlank)}`(前端 `api/auth.ts login`)
- 响应 200:`{id, username}`
- 401 凭据错误:`{status:401, message:"用户名或密码错误"}`;400 空白字段
- 语义:认证成功写 SecurityContext、建 session(principal 即 User 实体免二次查库)。放行端点。空库首启 seed 逻辑在 `auth/DataBootstrap`(users 空→建 admin;pages 空→seed 3 页 26 图标 + touch 版本)。

### POST /api/logout ——已冻结(见 issues/04)
- 无请求体;响应 200 空体
- 语义:清 SecurityContext + invalidate session。**需登录**才可访问。

### GET /api/me ——已冻结(见 issues/04)
- 响应 200:`{id, username}`;未认证 401 **空体**(filter 层)

---

## 2. 配置聚合 /api/config(2 端点,ADR-0006)

### GET /api/config
- 响应 200 `ConfigResponse`:

```
{
  pages: [{ id: Long, name: String, sortOrder: Integer }]        // 按 sortOrder,id 升序
  icons: [{ id: Long, pageId: Long, parentId: Long|null,         // 按 pageId,sortOrder,id 升序
            type: "NAV"|"STOCK"|"CHANGELOG"|"WEATHER"|"GROUP",   // ⚠️ 大写枚举串
            sortOrder: Integer, data: object|null }]
  layoutSettings: { …14 字段,见 §3 出参… }                        // 无行时返回 defaults()
  updatedAt: "ISO 时间戳"|null                                    // config_version,无版本行为 null
}
```
- `data` 按类型(`icon/IconType.java`):nav=`{name,url}`、stock=`{symbol,name}`、changelog=`null`、weather=`{location:{name,adm1,adm2,lat,lon}}`(ADR-0009)、group=`{name}`(ADR-0011)。图标无尺寸档位、恒占 1 格(ADR-0016);parentId=分组成员指向组行 id,顶层 null。
- 前端消费:`api/config.ts useConfig`(React Query)+ `fetchConfigOnce`(和解/推送回填,不经 React Query)。⚠️ 前端在解析边界把 `type` 归一化为小写 id(`normalizeIcon`),`Icon` 类型声明的是小写形态;`RawConfig` 镜像 wire 大写。
- 语义:一次取齐省首屏多次往返;旧字段 navLinks/stockWatches/setting 已删。

### PUT /api/config(全量替换)
- 请求体 `ReplaceRequest`(`ConfigReplaceService.java`,前端 `WireConfig` 同形,`api/config.ts useReplaceConfig` + `context/ConfigSyncProvider.tsx reconcile` 两处消费):

```
{
  pages:    [{ id: Long(@NotNull), name: String(@NotBlank,≤64), sortOrder: Integer(@NotNull) }]  // @NotNull @Size(min=1)
  icons:    [{ id: Long, pageId: Long, parentId: Long|null, type: 大写枚举, sortOrder: Integer,
               data: object|null }]
  layoutSettings: { …可空… } | null     // null = 保留现有布局行
}
```
- 响应 200:完整 `ConfigResponse`(同 GET)。⚠️ 前端两处消费均只声明 `{updatedAt?: string}` 且实际不读,成功后一律 invalidate/重拉。
- 状态码:400 结构校验(@Valid:pages 缺失/空、name 空/超长);409 业务校验(icon id 重复、pageId/parentId 孤儿引用、parentId 指向非组、组嵌套、非 NAV 成员、成员跨页、每页顶层行数 > 64、单例类型重复、空组)。
- 语义(ADR-0006/0011/0016):离线重连推送与导入「完全替换」共用。清空当前 user 的 icons+pages 后按 blob 重建,**服务端重新分配全部 id**(blob 内 id 仅为客户端键,可来自服务端或离线临时 id);layout 非 null 则 upsert;bump config_version;回读聚合返回。先删成员行再删顶层行(parent FK RESTRICT)。旧备份(v2 前)多余 `size` 字段由 Jackson 忽略(前端 `mirror/backup.ts` 注释同述)。id 重分配后前端靠 invalidate 拉回真 id。

---

## 3. 布局设置 /api/layout-settings(1 端点)

### PUT /api/layout-settings
- 请求体 `LayoutSettingRequest`(`LayoutSettingService.java`,前端 `LayoutSettings` 类型对应,`api/config.ts useUpdateLayoutSettings`):

| 字段 | 类型 | 必填 | 约束/默认 |
|---|---|---|---|
| gridWidth | Integer | 是 | 640–1536,默认 1024 |
| gridGap | Integer | 是 | 0–24,默认 8 |
| gridGapY | Integer | 否 | 0–32(上限比横向宽),默认 8 |
| iconScale | Double | 是 | 0.75–2.0,默认 1.5(ADR-0016) |
| panelFog | Integer | 否 | 0–60,默认 36 |
| searchBarWidth | Integer | 否 | 320–1024,默认 576 |
| searchBarVisible | Boolean | 否 | 默认 true |
| searchEngine | String | 否 | 枚举 `google\|bing\|baidu`,默认 google |
| clockVisible | Boolean | 否 | 默认 true |
| clockFont | Integer | 否 | 28–72,默认 48 |
| clock24h | Boolean | 否 | 默认 true |
| labelVisible | Boolean | 否 | 默认 true |
| labelSize | Integer | 否 | 10–16,默认 12 |
| labelColor | String | 否 | `^#[0-9a-fA-F]{6}$`,默认 `#ffffff` |

- 响应 200:`LayoutSettingResponse`(全部 14 字段,可空项已落默认)。
- 400 范围/pattern 违例。无读端点(读经 GET /api/config 的 layoutSettings 字段)。
- 语义:upsert(有行则改、无行则建);按 user_id 持久化跨设备共享;可空字段为旧客户端/旧备份(复用本 record)缺省落默认;写后 bump config_version(ADR-0006)。前端 `LayoutSettings` 类型 14 字段全必填、恒发全量。

---

## 4. 页面 /api/pages(4 端点)

### POST /api/pages
- 请求体:`{name: string(@NotBlank ≤64)}`(服务端 trim)
- 响应 200(非 201):`{id, name, sortOrder}`(sortOrder = 现有末尾 +1)
- 400 name 违例;bump config_version。前端 `useCreatePage`。

### PATCH /api/pages/reorder
- 请求体:`[{id: Long(@NotNull), sortOrder: int}]` 数组
- 响应 200:该 user 全部页的 `PageResponse` 列表(实现按读库时**旧** sortOrder 序返回实体集,非按新序排);不存在的 id 静默跳过(注释:前端始终基于最新列表提交)
- bump config_version。前端 `useReorderPages`(乐观更新,响应体丢弃)。

### PUT /api/pages/{id}
- 请求体:`{name}`(同上约束,trim)
- 响应 200:`{id, name, sortOrder}`;404 `页面不存在`(不属当前 user 视同不存在)
- bump。前端 `useRenamePage`。

### DELETE /api/pages/{id}
- 响应:204 无体;404;409 `该页非空，请先移动或删除页内图标`
- bump。前端 `useDeletePage`(不做乐观更新,409 时读 `ApiError.message` 提示)。

---

## 5. 图标 /api/icons(6 端点)

通用(`icon/IconService.java`):页面容量 = 每页**顶层**行数 ≤ 64(`DataBootstrap.DEFAULT_CAPACITY_CELLS`,ADR-0002/0011/0016;组内成员不计);单例类型仅 CHANGELOG(CONTEXT.md,后端单一事实源);组行只能经 merge 创建、空组不存活;所有读写按 userId 隔离;每次写 bump config_version(ADR-0006)。响应 `IconResponse` = `{id, pageId, parentId, type(大写), sortOrder, data}`。

### POST /api/icons
- 请求体:`{pageId: Long(@NotNull), type: 大写枚举(@NotNull), data: object|null}`(前端 `useCreateIcon` 在请求边界 `toUpperCase()`)
- 响应 200:`IconResponse`(sortOrder 服务端末尾追加)
- 409 `分组需经合并创建，不能直接新建` / `该类型图标已存在，且为单例类型` / `页面容量不足，剩余 N 格`;404 `页面不存在`;400 @Valid
- 前端声明 `apiFetch<unknown>`,响应体丢弃(invalidate 重拉)。

### PATCH /api/icons/move(字面子路径,先于 PATCH /{id} 匹配)
- 请求体:`{id: Long(@NotNull), toPageId: Long(@NotNull), toIndex: int, parentId: Long|null}`(parentId null=落页面序列,非空=目标组行)
- 响应 200:`IconResponse`(前端声明 `void`,丢弃)
- 三分支(ADR-0011):
  - 组行自身:不可入组(409 `分组不能嵌套入组`);跨页校验容量、成员行 page_id 事务内同步(成员不计容量,组内 sortOrder 保留)
  - 入组/组内重排(`parentId != null`):仅 NAV 可入组(409);目标必须是组行(404/409);**入组(新进组)忽略 toIndex 恒落组内末尾,组内重排按 toIndex 夹紧**;移出致源组变空则自动删组行
  - 落页面顶层:同页纯重排不校验容量;跨页或从组内移出(开始占格)才校验,同页移出且源组因此变空时净占 0(对齐 dissolve 的 -1)
- 404 `图标不存在` / `目标页面不存在` / `目标分组不存在`。前端乐观更新复用纯 reducer(`iconReducer.moveIcon` / `groupReducer.moveIntoGroup`),toIndex 透传。

### POST /api/icons/merge(建组,ADR-0011)
- 请求体:`{pageId: Long(@NotNull), memberIds: Long[](有序,@NotNull)}`——首位=被拖图标、末位=悬停目标(组行继承其 sort_order)
- 响应 200:新组行 `IconResponse`(type=GROUP,data=`{"name":"新建分组"}`)
- 409:`合并成分组至少需要 2 个图标` / `成员存在重复` / `成员必须都是本页顶层的网站链接图标`(覆盖跨页、组行、已入组三种违例)
- 404 `页面不存在`。成员组内序按 memberIds 顺序 0..n-1;页面序列在末位成员位置换组行、其余成员位置消失重排。前端 `useMergeIcons` 乐观窗口用负数临时组 id(`-Date.now()`),invalidate 后由服务端真 id 替换;响应体声明 `unknown` 丢弃。

### POST /api/icons/{id}/dissolve
- 无请求体;响应 200 **无体**(前端 invalidate 聚合重拉)
- 404 `分组不存在`;409 `该图标不是分组` / `页面容量不足，请先移出部分图标后再解散`(组行让 1 格、成员各占 1 格)
- 语义:成员自组行 sort_order 位置起按组内序洒回本页顶层;组行删除;bump。

### PATCH /api/icons/{id}
- 请求体:`{data: object|null}`——data 仅在非 null 时覆盖(部分更新),无其他约束(controller 未加 @Valid,record 亦无约束注解)
- 响应 200:`IconResponse`(前端声明 `void` 丢弃);404 `图标不存在`;bump

### DELETE /api/icons/{id}
- 响应 204 无体;404;409 `分组内还有图标，请先解散分组`(FK RESTRICT 的 DB 兜底前置转可读 409)
- 语义:删组内最后一个成员 → 空组不存活,连带删组行;删顶层图标后页面序列补洞重排;bump。前端 `useDeleteIcon` 乐观更新失败回滚。

---

## 6. 更新日志 /api/changelog(2 端点,ADR-0005/0016/0017)

### GET /api/changelog
- 响应 200(`ChangelogController.ChangelogResponse`,前端 `hooks/useChangelog.ts` 同形):

```
{
  markdown: string                    // 拼装后全文:已译版本块取译文,未译取英文原文
  releasedAt: "ISO"|null              // 最新版 npm 发布时间(@anthropic-ai/claude-code dist-tags.latest
                                      //   的 time 条目,ADR-0016;失败 null,前端日期行降级「—」)
  translatedVersions: string[]        // 已有译文的版本号(前端对不在此列的版本渲染「翻译」按钮)
}
```
- 语义(ADR-0017):请求路径**纯读内存快照**(volatile 原子换新,零外呼零 LLM);快照由 `ChangelogScheduler` 每 6 小时定时预取刷新,启动先 `loadFromDb` 从快照表恢复(零外呼秒级可服务)再异步预热(失败沿用旧快照,最多旧 6h)。内存空(首部署定时未跑成)→ 同步兜底刷新一次,仍失败 → 500「服务器错误」(前端走「刷新失败/重试」)。**译制失败或译制方拒绝(Key 缺失)→ 记 warn、该版保持英文原文、行不入库 → 下轮自动重试**。译文按块原文 SHA-256 主键持久化(MySQL,一版一行终身只译一次);增量检测纯算法零 token。前端 staleTime 1h(新鲜度由后端定时保证)。

### POST /api/changelog/translate(按需补译)
- 请求体:`{versions: string[]|null}`(null 容忍→空表;versions = 前端 parseChangelog 的版本标题)
- 响应 200:同上 `ChangelogResponse`(重拼后的最新全文;前端也可 invalidate 后重 GET)
- 语义(ADR-0017):指定版本缺失则译、入库持久化,随后的 GET 即含新译文;已译跳过(零 LLM);失败的该版保持英文。`translateVersions` 与 `refresh` `synchronized` 互斥防并发重复译制。

---

## 7. 天气 /api/weather(2 端点,ADR-0009)

### GET /api/weather?location=lat,lon&location=lat,lon(重复参数,批量)
- 请求:重复 `location` 参数,值为 `"lat,lon"`。**不能用 `@RequestParam List<String>`**——Spring 会把单个 `"lat,lon"` 按逗号拆成两值导致空响应(历史 bug,代码注释),故用 `getParameterValues`。非法格式**静默跳过**;无参 → `{}`。
- 响应 200:`Record<原始串, WeatherBundle|null>`——键为前端发送的原始串(发送与回查用同一串确保命中);**实况失败该键值为 null**(前端该图标显示重试)。前端 `hooks/useWeather.ts`(由 IconDataContext 收集全部天气图标位置一次批量调用,staleTime 5min + 10min refetch)。

```
WeatherBundle {
  location: string          // ⚠️ 规范化 "lat,lon"(2 位小数)缓存键,与响应 map 的原始串键不同表示
  now: {                    // 必填(和风 /v7/weather/now,经度在前 location=lon,lat)
    obsTime: string, temp: int, feelsLike: int, icon: string, text: string,
    humidity: int, windDir: string, windScale: string, windSpeed: string,
    pressure: int, vis: int, precip: double }
  air: {                    // 可空,整个字段 @JsonInclude(NON_NULL)——null 时**不输出该字段**
    aqi: int, category: string, primary: string,
    pm2p5/pm10/no2/so2/co/o3: double|null }   // 和风 v1 空气,取通用 AQI qaqi;每字段 NON_NULL
  alerts: [{                // 无预警时空数组(和风 v1 预警,路径 /{lat}/{lon} 纬度在前)
    id, senderName, severity, eventType, headline, description,
    effectiveTime, expireTime, icon: string|null,
    color: {red, green, blue}|null }]
}
```
- 前端 `lib/weather.ts` 类型逐字段对齐(`WeatherAir.primary` 等声明 `| null`,后端实际是省略字段)。
- 缓存(`WeatherService`,ADR-0009):按 (canonicalKey, endpoint) 内存 TTL——实况 10min、空气 30min、预警 5min;**仅缓存成功结果**,失败不缓存;降级:实况失败→整 bundle null;空气/预警失败→各自 null/空数组记 warn,不影响实况。经纬度统一 2 位小数(和风精度上限)。Key/Host 未配置 → `IllegalStateException` → 500「服务器错误」。

### GET /api/weather/locations?q=城市名
- 响应 200:`[{name: string, adm1: string, adm2: string, lat: double, lon: double}]`(`LocationCandidate`,和风 GeoAPI /geo/v2/city/lookup 代理,≤10 条;前端 `WeatherLocation` 同形)
- 空白 q → `[]`;未配置 Key → 500。供新增抽屉城市选择器消歧,选中后经纬度存入图标 data(不再保留 Location ID)。

---

## 8. 壁纸 /api/wallpaper(1 端点)

### GET /api/wallpaper
- 响应 200(`WallpaperResponse`,前端 `api/wallpaper.ts Wallpaper` 同形):

```
{ url: string        // https://www.bing.com + urlbase + "_1920x1080.jpg" 拼好的完整图 URL
  copyright: string  // 必应 copyright 文案(缺省 "")
  date: string }     // 必应 enddate(yyyyMMdd,缺省 "")
```
- 语义:代理必应 `HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN` 规避 CORS,前端 `<img>` 直连图片 URL。进程内 `volatile cached` 单例缓存——**cached 非空即返回**(注释称「enddate 变化才重新拉取」,实现无该比较,重启才失效)。必应响应不含 images → `IllegalStateException` → 500。需登录。前端 staleTime 1h、retry 1。

---

## 9. 系统(1 端点)

### GET /api/ping
- 响应 200:`"pong"`(text/plain)。放行端点(permitAll),M1 连通性检查、M3 起保留作健康探针。**前端无消费方**(grep frontend/src 无引用)。

---

## 前端消费方一览

| 端点 | 前端调用点 |
|---|---|
| POST /api/login、/api/logout、GET /api/me | `api/auth.ts` |
| GET /api/config | `api/config.ts`(useConfig / fetchConfigOnce) |
| PUT /api/config | `api/config.ts`(useReplaceConfig)、`context/ConfigSyncProvider.tsx`(reconcile 推送) |
| PUT /api/layout-settings | `api/config.ts`(useUpdateLayoutSettings) |
| POST/PATCH/PUT/DELETE /api/pages* | `api/config.ts`(useCreatePage/useReorderPages/useRenamePage/useDeletePage) |
| POST/PATCH/DELETE /api/icons* | `api/config.ts`(useCreateIcon/useMoveIcon/useMergeIcons/useDissolveGroup/useUpdateIconData/useDeleteIcon) |
| GET /api/changelog、POST /api/changelog/translate | `hooks/useChangelog.ts` |
| GET /api/weather、/api/weather/locations | `hooks/useWeather.ts` |
| GET /api/wallpaper | `api/wallpaper.ts` |
| GET /api/ping | 无 |

另:股票行情/公司概况前端**直连外部**(`hooks/useCompanyProfile.ts` → `datacenter-web.eastmoney.com`,行情同源走前端),不经本后端。

---

## 双侧不一致 / 可疑设计候选

- icon `type` wire 大小写双侧不一致:后端大写枚举串("NAV"),前端小写 id('nav'),前端在请求边界 `toUpperCase()`、响应边界 `normalizeIcon` 逐端点转换。
- `PATCH /api/icons/{id}`、`PATCH /api/icons/move` 后端返回完整 `IconResponse`(200 JSON),前端两处声明 `apiFetch<void>` 丢弃响应体。
- `POST /api/icons`、`POST /api/icons/merge` 前端声明 `apiFetch<unknown>`,响应体里的服务端新 id 被丢弃(merge 乐观窗口自造负数临时 id `-Date.now()`)。
- `PUT /api/config` 后端返回完整 `ConfigResponse`,前端两处消费只声明 `{updatedAt?: string}` 且实际不读,一律 invalidate/重拉。
- `GET /api/weather` 响应 map 键 = 前端原始串(如 `39.9042,116.4074`),`bundle.location` = 2 位小数规范化串(`39.90,116.41`),同一坐标两种表示并存。
- `WeatherBundle.Air`/`Alert` 及其字段 `@JsonInclude(NON_NULL)`:null 字段整段省略,前端类型声明 `| null`(运行时实际收到 undefined)。
- `GET /api/ping` 无前端消费方。
- issues/04 冻结清单写 401 错误体为 `{code:401, message}`,实际 `ErrorResponse` 字段名是 `status`;前端 client.ts 只读 `message`,不读该字段。
- 未认证 401 为空 body(`HttpStatusEntryPoint`),与带 JSON body 的凭据错误 401(`BadCredentials` handler)响应形态不一。
- 无体成功响应状态码不统一:`DELETE /api/icons/{id}`、`DELETE /api/pages/{id}` 为 204,`POST /api/icons/{id}/dissolve` 为 200;`POST /api/pages`/`POST /api/icons` 建成功亦为 200 而非 201。
- `WallpaperController` 注释称「按天缓存:enddate 变化才重新拉取」,实现是 `cached` 非空即返回、进程内永不失效(无 enddate 比较)。
- `PATCH /api/icons/move` 的 `toIndex` 在「入组」分支被后端忽略(恒落组内末尾),wire 字段该分支无效果;前端乐观 reducer 却透传 toIndex(注释自述「语义无冲突」)。
- `PATCH /api/pages/reorder` 返回列表按读库时旧 sortOrder 序排列(未按新序排),且不存在的 id 静默跳过。
- `PATCH /api/icons/{id}` controller 未加 `@Valid` 且 `UpdateRequest` 无任何约束注解,是唯一无参数校验的写端点。
- stock 类型图标 data=`{symbol,name}` 仅由后端存取,行情/公司概况由前端直连 eastmoney,后端无任何 stock 数据端点。
- `GET /api/config` 的 icons 按 pageId,sortOrder,id、pages 按 sortOrder,id 排序,契约未显式声明排序承诺,前端每次 invalidate 整体重拉自排。

---

## 修正白名单(已批,2026-08-21,工单 05)

以下修正经用户批准,作为迁移的**目标契约**——Java 侧不回修,Node 侧直接实现修正后语义,切换日起生效。其余一切(含上面「双侧不一致 / 可疑设计候选」中未列入本节的条目)按现状逐字冻结。

1. **删除 `GET /api/ping`**:无前端消费方、无部署依赖(backend 容器未配 healthcheck;compose 里的 healthcheck 是 MySQL 容器自身的 `mysqladmin ping`)。放行面相应修订为 `/api/login` + `/api/logout`。
2. **无体成功状态码语义化**:`POST /api/pages`、`POST /api/icons`、`POST /api/icons/merge` 建成功 → **201**;`DELETE` 维持 **204**;`POST /api/icons/{id}/dissolve` 维持 **200**。前端 `client.ts` 只判 `res.ok`,零感知。
3. **`GET /api/wallpaper` 缓存按天失效**:落地实现注释声称的「enddate 变化才重新拉取」语义(`cached.date` ≠ 新 enddate 时重拉;失败沿用旧值)。
4. **`PATCH /api/icons/move` 入组分支尊重 `toIndex`**:新进组也按 toIndex 插入并夹紧(现状恒落组内末尾);组内重排语义不变,乐观 reducer 与重拉结果一致。
5. **`PATCH /api/pages/reorder` 按新序返回**:响应列表按更新后的 sortOrder 排列(现状按读库旧序);静默跳过不存在 id 的行为保留(幂等友好)。
6. **`PATCH /api/icons/{id}` 补参数校验**:对齐其他写端点的 400 行为(现状是唯一无校验的写端点)。
7. **`POST /api/logout` 幂等化**:加入放行面,过期 session 登出返回 200(现状 401)。修订 issues/04 拦截面。

### 冻结确认(候选中不修的,逐字照搬)

- icon `type` 大写枚举 wire(转换层在前端 `normalizeIcon`/`toUpperCase()`,不动)
- PATCH/POST/PUT 各端点多返回的响应体(前端不读,照搬返回)
- weather 响应 map 原始串键 vs `bundle.location` 规范化键并存
- `@JsonInclude(NON_NULL)`:null 字段**省略输出**(前端声明 `| null` 但运行时收到 undefined,现状已适配)——Node 序列化须同样省略,不得置 null
- 401 双形态:凭据错误带 body(`{status, message}`)、未认证空体——前者 LoginPage 读 `message`,后者状态码驱动跳登录,各有消费场景
- ErrorResponse 字段名为 `status`(issues/04 原文笔误写 `code`,已在该工单修订)
- config 排序承诺显式化:GET /api/config 的 pages 按 `sortOrder,id`、icons 按 `pageId,sortOrder,id` 升序——升格为显式契约
- stock 行情/公司概况前端直连 eastmoney 格局不变
