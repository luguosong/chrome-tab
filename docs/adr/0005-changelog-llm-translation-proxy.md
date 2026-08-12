# 更新日志中文译制:后端 LLM 代理 + 最近 N 版截断

`更新日志` 图标运行时直连 GitHub 拉取 Anthropic `claude-code` 仓库的 `CHANGELOG.md`(英文,`useChangelog.ts` 的 `CL_URL`),外壳 UI 已是中文,仅条目正文为英文。为达成"以中文展示",新增**后端译制代理**:后端拉取原文 → 仅译制**最近 N(=5)个 `##` 版本** → 旧版本原样保留英文 → 拼回完整 markdown 返回;前端把 `CL_URL` 换成 `/api/changelog`,复用现有已测试的 `parseChangelog` + `inline`,解析逻辑零改动。

强制截断的硬约束:整份 `CHANGELOG.md` 实测 498 KB / 5420 行 / 361 版 / ~164 000 tokens,既超 `gpt-5-nano` 输入上下文、又远超任何模型单次输出上限,**整段一次译制技术上不可行、经济上荒谬**。截断到最近 5 版后约 1–2 万 token,一次调用几厘钱、秒回,且无损——旧 356 版不译不删。`N` 做成 `newtab.changelog.translate-recent` 可调。

引擎与配置:走 **aihubmix OpenAI 兼容网关** + `gpt-5-nano`(`newtab.changelog.llm.{base-url, model, api-key}`,Key 走环境变量 `AIHUBMIX_API_KEY` 不入库)。**GPT-5 系为推理模型,`temperature` 被网关强制忽略**(参见 lobehub issue #9327),故确定性不靠低温、改靠 Prompt 明文约束:"只输出译制后的 markdown,原样保留 `##`/`###`/`- ` 结构与内联 `` `code` `` / `**粗体**` / `[text](url)`,不译代码块/URL/版本号,不加任何解说"。

刻意的反直觉取舍:**否决"逐版本 JSON 契约"**——那要在 Java 重写 `parseChangelog` 并维护一套 JSON 契约,工作量大、YAGNI;后端只做"拉取 + 译制 + 缓存 markdown"的薄代理,解析仍归前端,契约即 markdown 文本。**否决"全量 361 版分块逐译"**——首次 361 次调用、又慢又贵,而旧版几乎无人看;最近 5 版已覆盖 Tile 与 Drawer 的有效视口。亦否决"前端直连翻译 API"——Key 会暴露在浏览器,且无后端缓存层压成本。

降级与缓存:译制失败(Key 失效/配额/网关宕机)→ 后端**直接透传 GitHub 英文原文**,仅 warn 日志,用户永不看到空白;仅当后端连 GitHub 都拉不到才走前端既有"日志刷新失败/重试"。缓存用**纯内存单条**(`volatile` 哈希 + 译文 + `synchronized`,key=最近 N 版切片的 SHA-256),不引 Caffeine;changelog 变更频率以周计,重启重译一次可忽略。

连带:UI 侧 `ChangelogTile` 的显示数由 `slice(0,20)` 收敛到 `slice(0,5)`,与译制范围对齐,避免"顶部中文、往下突变英文"的割裂;`ChangelogDrawer` 仍渲染全部 361 版(最近 5 中文 + 旧版英文),保留完整历史。
