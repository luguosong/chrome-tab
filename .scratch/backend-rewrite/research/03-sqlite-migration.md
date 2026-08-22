# Research 03:MySQL → SQLite 适配与数据迁移面

Ticket:`issues/03-sqlite-migration.md` · 日期 2026-08-21
方法:通读 `backend/src/main/resources/db/migration/` 全部 11 个迁移(V1~V11)+ 对应 JPA 实体,把最终 schema 在 SQLite 3.46.1 上做了 21 项方言实验(`/tmp/sqlite-dialect-test/test_dialect.py`);并发/备份/语义命题经后台代理对照 SQLite 官网与 better-sqlite3 官方仓库逐条查证(来源见文末)。

## 结论(TL;DR)

**可行,零硬阻塞。** 最终 schema 共 7 张表(users / pages / icons / layout_settings / config_version / changelog_translations / changelog_snapshot),没有任何 MySQL 专有能力被真正依赖:无存储过程/触发器/视图、icons.data 本来就是 TEXT 存 JSON(应用层序列化)、全部时间戳由 Java 代码显式赋值、唯一用到的 `ON UPDATE CURRENT_TIMESTAMP` 落在应用从不读取的 `layout_settings.updated_at` 上。换库的不确定性远小于重写本身;**不建议两步走(Node+MySQL 过渡)**,建议「数据先行迁入 SQLite 对账,重写完成后一次性切换容器」来解耦两个变量。

---

## 1. Schema → SQLite 方言差异清单

11 个迁移压平后的最终形态,逐点差异(标注 ✅ = 已实验验证,SQLite 3.46.1):

| # | MySQL 形态 | SQLite 落法 | 说明 |
|---|---|---|---|
| 1 | `VARCHAR(n)/CHAR(n)/LONGTEXT/TEXT` | 全部映射 TEXT 亲和,**长度与列型名只是亲和提示,不强制** | ✅ 200 字符进 `VARCHAR(64)` 被接受。长度校验责任在应用层——现有 `LayoutLimits`/DTO 校验已覆盖;BCrypt hash(60 字符)、498KB changelog 原文(实测 `LENGTH` 完整读回 ✅)均无压力(SQLite 单值上限默认 10 亿字节,sqlite.org/limits.html) |
| 2 | `BIGINT AUTO_INCREMENT PRIMARY KEY` | `INTEGER PRIMARY KEY`(rowid 别名) | 差异:MySQL 8 计数器持久、删行不复用 id;SQLite 普通 rowid 在「删最大 id 且 id 连续」时复用(已实验钉住边界)。评估:`icons.parent_id` 有 FK RESTRICT 防悬挂引用,users/pages 的 id 无外部含义 → 按官方建议用普通 `INTEGER PRIMARY KEY` 即可;求绝对保守可给 icons 单独加 `AUTOINCREMENT`(官方明说有开销、通常不需要,sqlite.org/autoinc.html) |
| 3 | `DATETIME` 列 | SQLite 无日期类型;以 TEXT 存 | ✅ `DATETIME` 声明(数值亲和)列存 `'2026-08-21 12:34:56.123456'` 原样读回 str;Jackson ISO 格式(`T` 分隔)同样兼容。**建议 Node 侧统一存 ISO-8601 UTC 文本**,与现 Jackson 输出形态一致,排序按字典序即时间序 |
| 4 | `DEFAULT CURRENT_TIMESTAMP` | 语法兼容,但语义不同:SQLite 恒返回 **UTC** `'YYYY-MM-DD HH:MM:SS'` 秒级文本 | 无实际依赖:所有 `created_at`/`config_version.updated_at` 均由 Java 代码显式赋值(实体字段默认 `LocalDateTime.now()`),DB 默认值只是兜底。Node 版沿用「代码赋值」约定即可 |
| 5 | `ON UPDATE CURRENT_TIMESTAMP` | **SQLite 无此子句**(语法图不存在,要等效须写触发器) | 唯二使用处:settings 表(V4 已删)、`layout_settings.updated_at`——实体注释明写「由库管理,不在此映射」,应用从不读取。→ Node 版**直接删列或代码维护,零影响** |
| 6 | JSON 列 | 无需迁移 | ✅ `icons.data` 本来就是 `TEXT` + `JsonMapConverter` 应用层序列化(ADR-0001 刻意为之);`json_extract` 内置可直接查 TEXT 里的 JSON |
| 7 | 外键 `ON DELETE CASCADE/RESTRICT` | 语义保留,但 **`PRAGMA foreign_keys` 默认 OFF,每个连接必须显式开** | ✅ CASCADE、RESTRICT 行为均验证通过;better-sqlite3 侧即 `db.pragma('foreign_keys = ON')`(不能在事务中途开,官方文档明言)。注:实验发现「删 user 级联删组行」时 RESTRICT 是否拦截取决于引擎内部删行顺序——但应用从不删用户,且 `ConfigReplaceService` 已有「先删成员再删组」纪律(V7 注释),无影响 |
| 8 | `BOOLEAN ... DEFAULT TRUE` | SQLite 无布尔类型;`TRUE` 字面量合法(= 1) | ✅ 存 integer 1;Node 读回 `1/0`,用 `!!v` 归一 |
| 9 | `UNIQUE` / `CHECK` / 二级索引 | 原样支持 | ✅ `users.username UNIQUE`、`changelog_snapshot` 的 `CHECK (id = 1)` 单行约束均生效;5 个二级索引(idx_page_user、idx_icon_user、idx_icon_page、idx_icon_parent)全部重建 |
| 10 | `TEXT/CHAR PRIMARY KEY`(`changelog_translations.block_hash`) | 支持,但有历史怪癖:**不写 NOT NULL 时可插入 NULL 主键** | ✅ 实验确认;建表须显式 `block_hash TEXT PRIMARY KEY NOT NULL` |
| 11 | `ENGINE=InnoDB CHARSET=utf8mb4`、内联 `INDEX`/`UNIQUE KEY` 子句、`MODIFY COLUMN` | SQLite 不认 | 建表脚本需重写(去 ENGINE/AUTO_INCREMENT/内联索引);✅ 重写后的建表脚本 21 项检查全过(2 项 FAIL 为测试预期笔误,均已在补充实验中澄清,非 SQLite 缺陷) |
| 12 | mysqldump 风格多行 `INSERT ... VALUES (...),(...)` | ✅ SQLite 3.7.11+ 支持 | ETL 落地方便 |

**给执行 session 的直接产物:SQLite 建表脚本骨架**(已实验跑通,`V1__init.sql` 等价物):

```sql
-- Node 侧首启执行;better-sqlite3 连接后先 db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON')
CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    username    TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE pages (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_page_user ON pages (user_id);
CREATE TABLE icons (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    page_id     INTEGER NOT NULL,
    parent_id   INTEGER REFERENCES icons(id) ON DELETE RESTRICT,
    type        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    data        TEXT,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);
CREATE INDEX idx_icon_user ON icons (user_id);
CREATE INDEX idx_icon_page ON icons (page_id);
CREATE INDEX idx_icon_parent ON icons (parent_id);
CREATE TABLE layout_settings (
    user_id           INTEGER PRIMARY KEY,
    grid_width        INTEGER NOT NULL,
    grid_gap          INTEGER NOT NULL,
    grid_gap_y        INTEGER NOT NULL DEFAULT 8,
    icon_scale        REAL    NOT NULL,
    panel_fog         INTEGER NOT NULL DEFAULT 36,
    search_bar_width  INTEGER NOT NULL DEFAULT 576,
    search_bar_visible INTEGER NOT NULL DEFAULT 1,
    search_engine     TEXT    NOT NULL DEFAULT 'google',
    clock_visible     INTEGER NOT NULL DEFAULT 1,
    clock_font        INTEGER NOT NULL DEFAULT 48,
    clock_24h         INTEGER NOT NULL DEFAULT 1,
    label_visible     INTEGER NOT NULL DEFAULT 1,
    label_size        INTEGER NOT NULL DEFAULT 12,
    label_color       TEXT    NOT NULL DEFAULT '#ffffff'
    -- updated_at 删除:MySQL 的 ON UPDATE 维护、应用从不读(见差异 #5)
);
CREATE TABLE config_version (
    user_id     INTEGER PRIMARY KEY,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE changelog_translations (
    block_hash  TEXT PRIMARY KEY NOT NULL,   -- NOT NULL 必写:SQLite TEXT 主键的历史怪癖
    translated  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE TABLE changelog_snapshot (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    raw_markdown TEXT NOT NULL,
    released_at  TEXT,
    fetched_at   TEXT NOT NULL
);
```

## 2. better-sqlite3 + WAL 并发适用性:**适用,且正是本项目的理想形态**

- better-sqlite3 是**同步 API**(README:"Easy-to-use synchronous API (better concurrency than an asynchronous API)"),单 Node 进程单连接,所有调用在事件循环上天然串行 → **进程内不存在写竞争**;官方三处原话支撑:API 全同步、事务文档 "SQLite serializes all transactions"、备份文档建议单连接负责变更。
- `SQLITE_BUSY` 只在**多连接/多进程**同写时出现;内置 `timeout` 选项(默认 5000ms)即 busy timeout:`new Database(path, { timeout: 5000 })`,无需手动 pragma。
- WAL 模式:读不阻塞写、写不阻塞读,同时只有一个写者,超过 1000 页自动 checkpoint(sqlite.org/wal.html 原话)。本项目最长写事务(498KB 快照覆盖、LLM 译文批写)毫秒级;个位数用户低频写,负载离 WAL 上限差 6 个数量级。
- 两个条件:① 库文件必须在同主机文件系统(docker volume 满足,**不能 NFS**);② 若未来 AI 底座起独立 worker 进程写库,每连接都开 WAL + busy timeout 即可,better-sqlite3 连接不能跨线程共享。
- 内存收益:MySQL 容器(线上实测 68 MiB)+ JDBC 连接池整体归零,SQLite 嵌进程零额外常驻——正中 1.6 GiB 服务器的轻量化动机。

## 3. 线上数据 → SQLite 导入路径

数据规模(依代码注释与领域事实):users 个位数行、pages/icons 数百行级、layout_settings / config_version 每用户 1 行、changelog_snapshot 单行 498KB、changelog_translations 每版 1 行数 KB——**全库 1MB 级,ETL 秒级**。

**推荐:一次性 Node ETL 脚本(mysql2 读 + better-sqlite3 写,~100 行)**,不搞运行期双读双写:

1. **演练**(不影响线上):线上 `mysqldump`(既是备份又是迁移源)→ 本地起 MySQL 容器 restore → 对副本跑 ETL 生成 SQLite 文件;
2. **对账**:逐表 `count(*)` 与源库一致;`PRAGMA foreign_key_check` 零违例;抽查 `icons.data` 全部 `JSON.parse` 通过;`users.password` BCrypt hash 原样拷(字符串直拷,零转换);
3. **切换窗口**(分钟级):`docker compose stop backend` → 最终 dump → 重跑 ETL → 对账 → 起 Node 后端;MySQL 容器与卷原样保留 N 周作回滚;
4. 时间戳逐值**原样字符串拷贝**(不解析不转时区)——顺序语义天然保留。

**时区注意**(唯一隐蔽坑):两处容器都未设 TZ(docker 默认 UTC),Java `LocalDateTime.now()` 写的是 UTC 墙钟;**Node 容器保持默认 UTC**,`config_version.updated_at` 的 LWW 排序(ADR-0006)才连续。若 Node 侧换时区写,时间戳跳变会让前端「旧本地镜像反赢」触发一次不必要的和解推送。

**备选(不推荐)**:`mysqldump --compatible=ansi` + sed 清洗(去 `SET`/`LOCK` 语句、ENGINE 子句、内联 KEY、AUTO_INCREMENT)→ `sqlite3 .read`。能走通但脆、无对账钩子;7 张表的规模下省不了工。
**拒绝**:运行期双写代理——一次性迁移用不上(YAGNI)。

## 4. 备份策略变化

- **新方案**:`VACUUM INTO '/backup/newtab-$(date +%F).db'` 每日 cron(或 better-sqlite3 进程内 `db.exec("VACUUM INTO …")`)。官方 howtocorrupt.html §1.2 明列 VACUUM INTO / backup API 在 live database 上安全;产物是**一致快照且顺带压实**;目标文件已存在会报错 → 文件名必须带时间戳(已实验验证报错行为)。
- **禁止**:直接 `cp` 数据库文件——WAL 打开时可能拷出「半新半旧」的损坏副本(官方原话警告);除非停写后 checkpoint 并连同 `-wal/-shm` 一起拷。
- **恢复** = 把备份文件拷回去,比 mysqldump restore 简单一个量级;备份完整性可 `PRAGMA integrity_check` 验。
- 净变化:mysql 容器退役后 mysqldump 链路消失,被一行 sqlite3 备份命令替代;备份文件即完整数据库,离线可查。

## 5. 风险评估:重写 + 换库同时做?

**真实风险**:两个变量叠加时故障归因模糊(bug 在新业务代码还是存储语义?)、切换日回滚面变大。**但本项目换库风险被 schema 事实摊薄到很小**:无存储过程/触发器/视图、无 MySQL JSON 列、日期全部代码赋值、唯一 MySQL 专有行为(ON UPDATE)落在无人读的列上——「换库」是小变量,「业务重写」才是大变量。

**两步走(Node+MySQL 先行,再换 SQLite)不值得**:DB 层 CRUD 写两遍(mysql2 再改 better-sqlite3)、两次切换窗口、两次对账;中间态还要背 mysql 容器 68 MiB,违背轻量化动机。省下的只是「归因隔离」,而 schema 已证明几乎无方言风险可归因。

**替代解耦:数据先行,切换日只剩一个变量**——重写期间就把线上数据离线迁入 SQLite 并完成对账(旧 Java 栈继续跑 MySQL,完全不受影响);Node 重写完成、契约测试过了,切换日只做「换容器 + 导入最新增量」,当天变量仅剩新后端本身。回滚预案:Java 镜像与 MySQL 卷保留,出问题 `docker compose` 起 Java 栈即回。契约冻结与契约测试(ticket 05)是重写风险的真正解药。

## 来源

- 实验:`/tmp/sqlite-dialect-test/test_dialect.py`(21 项方言检查,SQLite 3.46.1;临时目录,已随会话留存)
- SQLite 官方:wal.html(WAL 并发/单写者/NFS 限制)、foreignkeys.html(默认 OFF)、autoinc.html(rowid 复用与 AUTOINCREMENT 开销)、howtocorrupt.html §1.2(备份安全方式与 cp 危险)、lang_vacuum.html(VACUUM INTO 快照语义/目标存在报错)、lang_createtable.html + lang_datefunc.html(CURRENT_TIMESTAMP = UTC 文本、无 ON UPDATE)、limits.html(10 亿字节上限)
- better-sqlite3 官方:README(同步 API、prebuild/N-API)、docs/api.md(`timeout` 选项、`pragma()`、`function()`)、releases(Node 大版本跟进记录)
- 仓库:V1~V11 迁移、`Icon.java`/`JsonMapConverter.java`/`LayoutSetting.java`/`ConfigVersion.java`/`ChangelogSnapshot.java`/`ChangelogTranslation.java`、`application.yml`、`docker-compose.prod.yml`、ADR-0006(LWW)、map.md(服务器实测内存数据)
