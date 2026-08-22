# 04 — auth:登录/会话/空库种子

**What to build:** 会话载体从 Tomcat 内存迁到 SQLite sessions 表(`session_id, user_id, expires_at`,TTL 30d,多 session 并存)——收益是切换后重启不再掉线。auth 三端点以 api-contract.md 逐字为准:cookie 名 `JSESSIONID`、httpOnly、SameSite=Strict、max-age 30d、prod 加 secure,全照搬。拦截面:login/logout 放行(logout 幂等化,修正白名单第 7 项)、其余 `/api/**` 未认证 401 空体、非 `/api` 放行、无 CORS。密码 bcrypt `$2a$` 哈希原样验证、零重置。空库首启 seed 照 DataBootstrap 语义:users 空 → 用 `ADMIN_PASSWORD` 建 admin(缺失则启动报错);pages 空 → seed 3 页 26 图标 + config_version touch;非空全跳过;ADMIN_* 仅首启生效。

**Blocked by:** 03 — SQLite schema 全量落库。

**Status:** done

- [x] 用 Java 侧产出的 bcrypt `$2a$` 哈希可登录成功,cookie 属性逐项照契约
- [x] 重启容器后会话仍有效(sessions 落 SQLite)
- [x] 未认证访问受保护端点返回 401 空体;login/logout 放行
- [x] 过期/无会话下 logout 返回 200 而非 401(修正⑦ positive+negative 双断言)
- [x] 空库首启 seed 与 DataBootstrap 语义一致,二次启动不重复 seed
- [x] 空库且 `ADMIN_PASSWORD` 缺失时启动报错
