# 04 auth 迁移语义冻结

Type: grilling
Status: resolved

## Question

auth 迁移语义冻结:现有 Spring Security + JWT + bcrypt 的行为,哪些必须**逐字保留**——users 表密码哈希不重置(ADMIN_* 仅首启生效的教训:线上密码须 UPDATE 表,迁移不能要求用户重设)、已发放 token 不失效(JWT 签名/claims/过期语义照搬)、登录/登出/me 端点行为。Node 侧等价实现选件(jose vs jsonwebtoken;bcryptjs 能否验证现有 bcrypt 哈希)。定出「迁移完成 = 前端对 auth 行为不可区分」的验收点。本地代码考古(现 auth 实现细节)由 agent 读码完成,不问用户。

## Answer

**核心发现(2026-08-21 读码,推翻工单预设):现状没有 JWT。** Spring Security + Tomcat **内存 session**(无 spring-session 依赖),`JSESSIONID` cookie httpOnly + SameSite=Strict + max-age 30d(prod 加 secure);后端重启 session 全灭,前端 401 → 引导重登——「已发放 token 不失效」的约束从未存在。工单中 jose vs jsonwebtoken 选型随之**消解**(不引入 JWT,两者都不用)。

**决策(2026-08-21 会话,用户按推荐确认):**

1. **Node 侧载体:SQLite sessions 表**(`session_id, user_id, expires_at`,TTL 30d 照搬 cookie max-age,多 session 并存)。~15 行 Hono 中间件 + `hono/cookie`。注意:切换日本身仍需登录一次(旧 session 在旧容器内存、从未持久化,无从迁移);本选型的收益是*今后*重启/部署不掉线。过期清理走惰性 + 复用既有 cron 即可,不另立机制。
2. **密码哈希:bcrypt `$2a$` 原样迁移、零重置。** bcryptjs 验证 `$2a$` 完全兼容(栈选型见工单 01);新哈希仅产生于空库 seed,bcryptjs 默认即 `$2a$`/10 rounds,与现状一致。
3. **空库首启 seed 保留**,照搬 `DataBootstrap` 语义:users 空表时用 `ADMIN_PASSWORD` 建 admin(缺失则启动报错);pages 空表才 seed 3 页 26 图标 + `config_version` touch;非空库全跳过。**ADMIN_* 仍仅首启生效**(教训已在地图 Notes)。
4. **冻结验收清单(迁移完成 = 前端对 auth 行为不可区分):**
   - `POST /api/login`:200 `{id, username}` + Set-Cookie;错凭据 401 `{status:401, message:"用户名或密码错误"}`;参数校验失败 400 `{status, message}`
   - `POST /api/logout`:200 空体,session 失效,后续请求 401
   - `GET /api/me`:200 `{id, username}`;未认证 401(filter 层,**空体**)
   - cookie:名 `JSESSIONID`、httpOnly、SameSite=Strict、max-age 30d、prod secure——全照搬
   - 拦截面:`/api/login` + `/api/ping` 放行;其余 `/api/**` 未认证 401;非 `/api`(静态资源)放行;无 CORS(同源 Caddy)
   - 单管理员(第一用户即 admin)、无角色分支、**无改密端点**(改密继续走 SQL;改密/lockout/rate-limit 等新能力一概不混入迁移——现状无,照搬)
   - users 表(`id, username, password, created_at`)原样进 SQLite(ETL 归工单 03 范围)

**下游影响:** 工单 05(契约冻结)的 auth 端点部分直接引用上面第 4 条清单;工单 08(迁移策略)须计入「切换日一次重新登录」。

### 修订(2026-08-21,工单 05 修正白名单)

- **勘误**:错误体字段名实为 `status`(`ErrorResponse(status, message)`),上文原笔误写 `code`,已改正。前端只读 `message`,无实际影响。
- **拦截面修订**:放行面改为 `/api/login` + `/api/logout`(logout 幂等化——过期 session 登出返回 200 而非 401);`/api/ping` 删除(dead endpoint,无前端消费方、无部署依赖)。
