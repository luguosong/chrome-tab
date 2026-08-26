# 线上数据类 bug 诊断回路

线上(tab.luguosong.cn,`ssh tab`)「某功能不生效/不更新/显示异常」类症状,先走本回路定位数据层,再读代码。三条铁律来自 2026-08-26 译制事故(表象「HN 标题没翻译」,根因是代理节点故障导致取数全挂)。

## 1. 直查 SQLite,别跟 401 的 API 缠斗

`/api/*` 要登录;数据类问题直接查容器里的库:

```
ssh tab 'docker cp /tmp/x.js chrome-tab-backend-1:/tmp/x.js && docker exec chrome-tab-backend-1 node /tmp/x.js'
```

三个坑:库名是 `newtab.db`(路径 `/app/backend/data/`);better-sqlite3 必须绝对路径 require——`/app/node_modules/.pnpm/node_modules/better-sqlite3/package.json` 读版本号再拼 `node_modules/.pnpm/better-sqlite3@<ver>/node_modules/better-sqlite3`;ssh 双引号套 SQL 单引号会被打穿,复杂查询一律先写脚本文件再 `docker cp`(如上)。诊断口径:`GROUP BY` 维度 + `MAX(created_at)` 对照时间窗。

## 2. 表象 ≠ 根因:先画出完整依赖链再怀疑「不工作」的那个模块

功能链路常有多级前置(例:新闻译制排在取数成功**之后**,取数挂则译制静默跳过——译文表 0 行 ≠ 译制代码坏了)。存量数据会让链路死亡看起来像「数据在但功能不生效」。两个锚点:`MAX(created_at)` 对照容器 `StartedAt`(数据全是旧的 = 链路早已死亡);`docker logs --since` 只覆盖**当前容器**的生命,替换前的日志已丢,「零日志」≠「从未尝试」。

## 3. 境外流量单点 mihomo:多个外部依赖同时异常,先查共享设施

backend 容器 `HTTPS_PROXY=http://mihomo:7890`,HN/YouTube/aihubmix 等全部境外流量汇于 chrome-tab-mihomo-1;国内源在 NO_PROXY 直连(清单在 `docker-compose.prod.yml`,线上同步见 deploy skill)。批量超时/静默不更新时,从 backend 容器 `node -e` 直调 `http://mihomo:9090`(REST API):`/providers/proxies` 看节点 history,**实测目标站才算数**——URLTest 探针只测 aihubmix,存在「半死节点」(aihubmix 通、HN 等超时)组仍判活不换路;`PUT /proxies/PROXY {"name":...}` 切节点。busybox wget 会对 URL 编码二次转义致 404,一律用 backend 容器的 node fetch。
