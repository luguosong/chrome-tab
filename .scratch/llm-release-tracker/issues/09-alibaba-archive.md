# 09: 接入阿里通义(Qwen/万相)模型档案

**What to build:** 让用户查看阿里通义商业 API 模型(Qwen 旗舰系)与官方开放权重模型、万相 Wan 视频与 Qwen-Image 图像模型,保留别名原地升级与快照归并的历史,正确表示多模态各类型。

**Status:** ready-for-agent

决策(grilling 2026-08-26):id `alibaba`、展示名「通义」;万相 Wan 与 Qwen-Image 入档同一厂家;一次全量对齐六家既有口径;主发布源 = 百炼「模型上下架与更新」首表(SSR HTML 纯表格、日粒度、modelID 独立列,对标 DeepSeek HTML 解析先例;qwen.ai 是 SPA 无 feed、GitHub QwenLM 零 releases,均出局)。

- [ ] 通义商业旗舰与独立产品差异变体入档(单一主要模型种类),开源尺寸变体(各 B 档 checkpoint)、`latest` 别名、日期快照不另立行、归并家族行动态。
- [ ] 万相 Wan(视频生成)与 Qwen-Image(图像生成)随同厂家入档;百炼托管的第三方模型(kimi-k3、ZHIPU/GLM-5.3 等)不误认领。
- [ ] 主线别名(qwen-plus/turbo/max 等)与快照的原地升级生成对应「模型动态」,别名自身不立行;已退役模型保留并沉底标记。
- [ ] AA 评测 slug 映射人工核验增补(2026-08-26 sitemap 已核:文本模型在 /models/<slug>,媒体模型带 image/、video/、speech-to-text/、text-to-speech/ 路径前缀;reasoning/non-reasoning/effort 分档页与日期快照不映射——同既有排除口径)。
- [ ] 通义在图标、「全部」tab 和独立「通义」tab 中可用,详情区分 API 与开放权重渠道。
- [ ] 自动检查覆盖表格解析(首表锚定/多 ID 单元格切分/第三方过滤)、归属、基线形状(别名不立行/非退役必有渠道)、陈旧降级与 tab 展示。

## Comments
