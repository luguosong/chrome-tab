# 12 — 切换日(big bang,一 session)

**What to build:** 按可照做的清单在一个 session 内完成,无临场决策、无回滚(失败向前修复):停旧 backend → 终版 mysqldump 纯文件存档(清毁数据卷前唯一保留物)→ 全量 ETL 重跑(秒级)→ 新 compose(无 mysql 段)up 起新容器 → `pnpm smoke` 冒烟:登录链路 + config/changelog/weather/wallpaper 各一探 + 401 探针。切换日本身需登录一次(sessions 载体更换);此后重启不再掉线。停机几分钟,无切换窗口。

**Blocked by:** 11 — 服务器 ETL 演练。

**Status:** ready-for-agent

- [ ] 终版 mysqldump 存档落地且校验可读(唯一安全网)
- [ ] 新单后端容器 up,smoke 全部通过
- [ ] 现有账密原样可登,页面/图标/分组/布局设置分毫不动(对账零差异)
- [ ] 后端容器强制 GC 后 RSS 实测 ≤ ~100 MiB 档
- [ ] mysql 容器已停(清除归票 13)
