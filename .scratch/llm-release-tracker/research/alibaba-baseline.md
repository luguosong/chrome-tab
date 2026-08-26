# 阿里通义(百炼)基线候选数据调研(issues/09)

核对日 2026-08-26。全部数据来自官方一手信源,关键处引原文。基线行数校准:智谱 44 / OpenAI 91 / DeepSeek 15。

## 信源与获取方式

| 信源 | URL | 用途 |
|---|---|---|
| 百炼「模型上下架与更新」 | `help.aliyun.com/zh/model-studio/newly-released-models` | 上架日期、功能说明原文(首表=华北2北京,398 行) |
| 百炼模型分类目录页 | `help.aliyun.com/zh/model-studio/model-list-{text-generation,visual-understanding,omni,image-generation,video-generation,speech-synthesis,speech-recognition,embedding-reranking}`(枢纽页 `/model-studio/model-studio-model-list/`) | 现役清单 + 模型→文档页 slug 映射 |
| 各模型文档页 | `help.aliyun.com/zh/model-studio/<slug>`(slug 规律:**点号→连字符**,`qwen3.8-max`→`qwen3-8-max`;少数前缀 `model-`;两处例外见 C-6) | 「上下文限制」「模型价格」(分区域:北京/新加坡/法兰克福/弗吉尼亚/东京)+ 限流 RPM/TPM |
| HuggingFace `Qwen` org | `huggingface.co/api/models?author=Qwen`(462 仓,SSR 可达) | 开放权重仓名与 createdAt |
| 功能动态页 | `help.aliyun.com/zh/model-studio/model-release-notes` | 下线/降价通知索引(标题+日期 SSR 可证) |

**反爬警示**:help.aliyun.com 并发抓约 20 页触发 x5sec punish(返回 2.6KB captcha 跳转脚本)。慢速(≥9s 间隔)+浏览器 UA+Referer+cookie jar 可稳定通过。生产 poll 单轮只打 1 页,天然安全;**人工核验批量抓取须限速**。

**AA sitemap 核验(2026-08-26,同日)**:文本模型在 `/models/<slug>`;图像/视频/语音模型带路径前缀(`image/models/`、`video/models/`、`speech-to-text/models/`、`text-to-speech/models/`),映射取路径尾段(OpenAI 图像系 `openai-gpt_image-1-5` 先例)。reasoning/non-reasoning/effort 分档页与日期快照不映射(既有排除口径)。相关 slug 清单(节选,与基线行对齐时用):`qwen3-8-max`、`qwen3-7-max`、`qwen3-6-max`、`qwen3-max`、`qwen3-6-plus`、`qwen3-7-plus`、`qwen-turbo`(别名,不映射)、`qwen3-8-2-4t-a95b`、`qwen3-8-27b`(+`-low`/`-medium` 不映射)、`qwq-32b`、`qwen3-coder-next`、`qwen3-coder-480b-a35b-instruct`、`qwen3-coder-30b-a3b-instruct`、`qwen3-next-80b-a3b-instruct`(+`-reasoning`)、`qwen3-vl-235b-a22b-instruct`、`qwen2-5-72b-instruct`、`image/models/qwen-image`、`video/models/wan-2-1-14b`、`video/models/wan-2-2-5b`、`video/models/wan-2-2-a14b`、`video/models/wan-2-5-preview`、`speech-to-text/models/qwen3-asr`、`text-to-speech/models/qwen-audio-3-0-tts-plus`、`text-to-speech/models/qwen3-tts-flash`、`text-to-speech/models/qwen3-tts-vc-realtime`。3.5/3.6 各尺寸与 VL 各尺寸均有独立页(家族行映射时只取旗舰尺寸)。

## 表格结构样本(解析器口径)

首表(华北2(北京))前 3 行原文(已剥 `<span class="help-letter-space"></span>`——该 span 在中西文之间做视觉间距,**解析必须剥掉**):

```
| 模型类型 | 时间 | 模型ID | 功能说明 |
| 图片生成 | 2026-08-24 | vidu/vidu-image-pro_reference2image | 输入0-14张参考图片或文本描述…(第三方) |
| 视频生成 | 2026-08-20 | wan3.0-video-prime | Wan3.0-Video-Prime 是万相3.0 的高速版视频生成模型,能力对齐 Wan3.0-Video 标准版… |
```

多 ID 单元格实样(一格内多个 `<p><code>ID</code></p>`,空格分隔):

```
qwen3.7-flash qwen3.7-flash-2026-07-15                              ← 主线+快照
qwen-audio-3.0-asr-flash-streaming qwen-audio-3.0-asr-flash-filetrans qwen-audio-3.0-asr-flash   ← 一行三产品形态
qwen-tts-realtime qwen-tts-realtime-latest qwen-tts-realtime-2025-07-15   ← 主线+latest+快照
```

解析器要点:
1. 页面 10 张表 = 5 张唯一表 × 2 份拷贝(SSR+hydration)。顺序:北京(398)/新加坡(203)/弗吉尼亚(92)/法兰克福(87)/东京(30)。**只取第一个 `<table>`**。
2. 无下架行——时间列全为上架/更新;「模型下线」不在本表(见「未核验到」#1)。
3. 模型 ID 单元格无链接;文档页 slug 按点号→连字符规律推导(例外见 C-6)。
4. 第三方托管混行按前缀过滤:`vidu/ kimi ZHIPU/ MiniMax deepseek glm- pixverse happyhorse siliconflow vanchin xiaomi stepfun Tripo` 等。

## A. 候选模型清单(205 qwen/wan 行 → 蒸馏 94,分级 P0 核心/P1 产品线/P2 边缘)

### A-1 文本:商业旗舰/主力线

| # | officialId | 展示名 | 种类 | 首次上架 | 归并链(详 C) | 现役 API ID | HF 权重 | 官方参数 | 级 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | qwen3.8-max | Qwen3.8-Max | 文本 | 2026-08-02 | 无 | qwen3.8-max | 无 | **「2.4万亿参数MoE旗舰」**(表格原文) | P0 |
| 2 | qwen3.7-max | Qwen3.7-Max | 文本 | 2025-05-21(preview 05-20 行) | C-3 三段链 | qwen3.7-max | 无 | 未披露 | P0 |
| 3 | qwen3.6-max-preview | Qwen3.6-Max-Preview | 文本 | 2026-04-20 | 表内无 GA 行 | qwen3.6-max-preview | 无 | 未披露 | P1 |
| 4 | qwen3-max | Qwen3-Max | 文本 | 2025-09-23(preview 09-05) | C-4 两段 | qwen3-max | 无 | 未披露 | P0 |
| 5 | qwen-max | Qwen-Max | — | 2024-10-15 | **别名不立行**(C-2 官方自证「滚动更新升级」) | qwen-max | — | — | — |
| 6 | qwen3.7-plus | Qwen3.7-Plus | 文本 | 2026-06-01 | 05-26 快照同格 | qwen3.7-plus | 无 | 未披露 | P0 |
| 7 | qwen3.6-plus | Qwen3.6-Plus | 文本 | 2026-04-01 | 04-02 快照同格 | qwen3.6-plus | 无 | 未披露 | P1 |
| 8 | qwen3.5-plus | Qwen3.5-Plus | 文本 | 2026-02-15 | 02-15 快照同格 | qwen3.5-plus | 无 | 未披露 | P1 |
| 9 | qwen-plus | Qwen-Plus | — | 2025-06-24(指向 Qwen3-Plus 代) | **别名不立行**(C-1 九快照链+latest) | qwen-plus | — | — | — |
| 10 | qwen3.7-flash | Qwen3.7-Flash | 文本 | 2026-07-21 | 07-15 快照同格 | qwen3.7-flash | 无 | 未披露 | P0 |
| 11 | qwen3.6-flash | Qwen3.6-Flash | 文本 | 2026-04-16 | 同格 | qwen3.6-flash | 无 | 未披露 | P1 |
| 12 | qwen3.5-flash | Qwen3.5-Flash | 文本 | 2026-02-23 | 同格 | qwen3.5-flash | 无 | 未披露 | P1 |
| 13 | qwen-flash | Qwen-Flash | — | 2025-08-05 | **别名不立行** | qwen-flash | — | — | — |
| 14 | qwen-turbo | Qwen-Turbo | — | 2025-06-24 | **别名不立行**(AA qwen-turbo slug 不映射,同移动别名口径) | qwen-turbo | — | — | — |

### A-2 文本:开源家族行(尺寸归并)

| # | officialId | 展示名 | 首次上架 | 归并 | HF 主仓(创建日) | 参数 | 级 |
|---|---|---|---|---|---|---|---|
| 15 | qwen3.8-2.4t-a95b | Qwen3.8-2.4T-A95B | 2026-08-12 | — | Qwen/Qwen3.8-2.4T-A95B(2026-08-08,FP8 同日) | **「总参数 2.4 万亿,每步激活约 950 亿」**(表格原文) | P0 |
| 16 | qwen3.8-27b | Qwen3.8-27B | 2026-08-17 | — | Qwen/Qwen3.8-27B(2026-08-05) | 27B 原生视觉语言 Dense | P0 |
| 17 | qwen3.6-27b | Qwen3.6-27B | 2026-04-22 | — | Qwen/Qwen3.6-27B(2026-04-21) | 未披露 | P1 |
| 18 | qwen3.6-35b-a3b | Qwen3.6-35B-A3B | 2026-04-16 | — | Qwen/Qwen3.6-35B-A3B(2026-04-15) | 未披露 | P1 |
| 19 | qwen3.5-open | Qwen3.5 开源系列 | 2026-02-15(397b)~02-23 | 四尺寸行(397b-a17b/122b-a10b/35b-a3b/27b);0.8B~9B 档仅 HF | Qwen3.5-397B-A17B(02-16)、-122B-A10B/-35B-A3B/-27B(02-24) | ID 自明 | P1 |
| 20 | qwen3-next-80b-a3b | Qwen3-Next-80B-A3B | 2025-09-11 | thinking/instruct 两行(C-7) | Qwen3-Next-80B-A3B-Instruct/-Thinking(2025-09-09) | 未披露 | P1 |
| 21 | qwen3-open | Qwen3 开源系列 | 2025-04-29 | 8b/14b/32b/30b-a3b/235b-a22b 五行+2507 系快照(07-21~30) | Qwen3-235B-A22B(04-27)等、2507 版(07-21~29) | 未披露 | P1 |
| 22 | qwen2.5-omni-7b | Qwen2.5-Omni-7B | 2025-03-26 | — | Qwen/Qwen2.5-Omni-7B(2025-03-22) | 未披露 | P2 |

### A-3 编程/翻译/长文本/专项

| # | officialId | 种类 | 首次上架 | 归并 | HF | 级 |
|---|---|---|---|---|---|---|
| 23 | qwen3-coder-plus | 文本 | 2025-07-22 | 09-23 快照;关联开源 480b-a35b | Qwen3-Coder-480B-A35B-Instruct(2025-07-22) | P0 |
| 24 | qwen3-coder-flash | 文本 | 2025-08-05 | 07-28 快照;关联开源 30b-a3b | Qwen3-Coder-30B-A3B-Instruct(2025-07-31) | P1 |
| 25 | qwen3-coder-next | 文本 | 2026-02-19 | — | Qwen3-Coder-Next(2026-01-30)、-Base(02-01) | P0 |
| 26 | qwen-coder-plus | 文本 | 2024-11-12 | qwen-coder-turbo(2024-09-19)归并或分立 | 无 | P2 |
| 27 | qwen-mt-plus | 文本(翻译) | 2025-07-22 | mt-turbo 同日;mt-flash(11-06)、mt-lite(11-19)归并 | 无 | P1 |
| 28 | qwen-mt-image | 图像(图片翻译) | 2025-08-22 | — | 无 | P2 |
| 29 | qwen-math-plus | 文本(数学) | 2024-09-13 | 0816 快照;0919+latest | 无 | P2(官方原文「预计维护到下个版本发布后一个月(待定)」——退役线索) |
| 30 | qwen-math-turbo | 文本(数学) | 2024-09-19 | — | 无 | P2 |
| 31 | qwen-long | 文本(长文档) | 2024-05-20 | latest+0125 快照(2025-03-19) | 无 | P2(10M 上下文) |
| 32 | qwen-doc-turbo | 文本(文档) | 2025-07-23 | — | 无 | P2 |
| 33 | qwen-deep-research | 文本(智能体) | 2025-08-22 | 2025-12-15 快照(2026-03-23 上表) | 无 | P1 |
| 34 | qwen-plus-character | 文本(角色扮演) | 2025-03-20 | — | 无 | P2 |
| 35 | qwen-flash-character | 文本(角色扮演) | 2026-01-13 | 02-26 快照(2026-02-28 上表) | 无 | P2 |

### A-4 视觉理解/全模态

| # | officialId | 种类 | 首次上架 | 归并 | HF | 级 |
|---|---|---|---|---|---|---|
| 36 | qwen3-vl-plus | 多模态理解 | 2026-01-26 | 2025-09-23、12-19 快照行 | 无 | P0 |
| 37 | qwen3-vl-flash | 多模态理解 | 2026-01-22 | 2025-10-15 快照同格 | 无 | P1 |
| 38 | qwen3-vl-open | 多模态理解 | 2025-09-23(235b)~10-21(32b) | 235b/32b/30b-a3b/8b 各 instruct+thinking(C-7) | Qwen3-VL-235B-A22B-*(09-22)、32B-*(10-19)、30B-A3B-*(09-30)、8B-*(10-11) | P1 |
| 39 | qwen-vl-plus | 多模态理解 | 2025-06-13 | — | 无 | P2 |
| 40 | qwen-vl-max | 多模态理解 | 2025-05-26 | — | 无 | P2 |
| 41 | qwen-vl-ocr | 多模态理解(OCR) | 2025-11-20(主线) | 1028(2024-11-14)→2025-04-13→08-28 快照+latest 行 | 无 | P1(slug 异常 `qwenvl-ocr` 见 C-6) |
| 42 | qwen3.5-ocr | 多模态理解(OCR) | 2026-06-16 | — | 无 | P1 |
| 43 | qwen3.5-omni-plus | 音频语音(全模态) | 2026-03-30 | 03-15 快照+realtime 同格同日 | 无 | P1 |
| 44 | qwen3.5-omni-flash | 音频语音(全模态) | 2026-03-30 | 同上 | 无 | P1 |
| 45 | qwen3-omni-flash | 音频语音(全模态) | 2025-12-04 | 12-01 快照+realtime;09-15 旧快照;captioner(09-17) | Qwen3-Omni-30B-A3B-Instruct/-Thinking(09-15/20)、-Captioner | P1 |
| 46 | qwen-omni-turbo | 音频语音(全模态) | 2025-02-14 | latest 同格;01-19/03-26 快照;realtime 系(05-08) | 无 | P2 |

### A-5 图像生成(Qwen-Image + 万相图像)

| # | officialId | 首次上架 | 归并 | HF | 级 |
|---|---|---|---|---|---|
| 47 | qwen-image-3.0 | 2026-08-04 | — | 3.0 未放权重(HF 最新 Qwen-Image-2512,2025-12-30) | P0 |
| 48 | qwen-image-3.0-pro | 2026-07-20 | — | 无 | P0 |
| 49 | qwen-image-2.0 | 2026-03-03 | 03-03 快照同格 | Qwen/Qwen-Image-2512(2025-12-30,2.0 系开源版) | P1 |
| 50 | qwen-image-2.0-pro | 2026-04-23 | 04-22 快照同格;06-22 快照行(06-25) | 同上系 | P1 |
| 51 | qwen-image-max | 2025-12-30 | 12-30 快照同格 | 同上系 | P1 |
| 52 | qwen-image-plus | 2025-09-23 | 2026-01-09 快照行 | Qwen/Qwen-Image(2025-08-02) | P1 |
| 53 | qwen-image | 2025-08-13 | — | Qwen/Qwen-Image(2025-08-02) | P1 |
| 54 | qwen-image-edit | 2025-09-22 | — | Qwen/Qwen-Image-Edit(2025-08-17)、-2509(09-22) | P1 |
| 55 | qwen-image-edit-plus | 2025-10-30 | 同格快照 | Qwen-Image-Edit-2509 | P2 |
| 56 | qwen-image-edit-max | 2026-01-15 | 同格快照 | Qwen-Image-Edit-2511(2025-12-17)、Qwen-Image-Layered | P2 |
| 57 | wan2.7-image | 2026-04-01 | — | 无 | P1 |
| 58 | wan2.7-image-pro | 2026-04-01 | — | 无 | P1 |
| 59 | wan2.6-image | 2025-12-15 | — | 无 | P2 |
| 60 | wan2.6-t2i | 2025-12-15 | — | 无 | P2 |
| 61 | wan2.5-t2i-preview | 2025-09-19 | — | 无 | P2 |
| 62 | wan2.5-i2i-preview | 2025-09-23 | — | 无 | P2 |
| 63 | wan2.2-t2i | 2025-07-28 | t2i-plus/flash 归并 | 无 | P2 |
| 64 | wanx2.1-t2i | 2025-01-09 | t2i-plus/turbo 归并;imageedit(2025-03-25)另立待裁 | 无 | P2 |
| 65 | wanx2.0-t2i-turbo | 2025-01-20 | — | 无 | P2 |
| 66 | wanx-v1 | 2024-01-05(首表最早 qwen/wan 行) | — | 无 | P2(初代) |

wanx 应用类(virtualmodel 2024-06-25、poster-generation-v1 2024-06-21、sketch-to-image-lite 2024-06-11、x-painting 2024-05-28、style-repaint/background-generation 2024-03-22):应用 SKU 非模型型号,建议不入(virtualmodel/poster/x-painting 官方明示「暂无公开定价信息」)。

### A-6 视频生成(万相 Wan)

| # | officialId | 首次上架 | 归并 | 级 |
|---|---|---|---|---|
| 67 | wan3.0-video | 2026-08-06 | — | P0 |
| 68 | wan3.0-video-prime | 2026-08-20 | — | P0 |
| 69 | wan2.7-video | 2026-04-03 | t2v/i2v/r2v 三行+06-12 快照(C-8);videoedit 同日另立待裁 | P1 |
| 70 | wan2.6-video | 2025-12-03(t2v/i2v) | r2v(12-16)、r2v-flash/i2v-flash(2026-01-15/29) | P1 |
| 71 | wan2.5-video-preview | 2025-09-19 | t2v/i2v-preview | P2 |
| 72 | wan2.2-video | 2025-07-28(t2v/i2v plus) | i2v-flash(08-11)、s2v(08-25)、kf2v-flash(09-12)、animate(09-19) | P2 |
| 73 | wanx2.1-video | 2025-01-09(t2v/i2v turbo/plus) | i2v-plus(01-20)、i2v-turbo(02-27)、kf2v-plus(04-21)、vace-plus(05-14) | P2 |

### A-7 音频语音

| # | officialId | 种类 | 首次上架 | 归并 | HF | 级 |
|---|---|---|---|---|---|---|
| 74 | qwen-audio-3.0-asr-flash | 语音识别 | 2026-07-30 | streaming/filetrans 同格三 ID | 无 | P0 |
| 75 | qwen-audio-3.0-tts-plus | 语音合成 | 2026-07-14 | — | 无 | P1 |
| 76 | qwen-audio-3.0-tts-flash | 语音合成 | 2026-07-14 | — | 无 | P1 |
| 77 | qwen-audio-3.0-realtime-plus | 实时语音对话 | 2026-07-14 | — | 无 | P1 |
| 78 | qwen-audio-3.0-realtime-flash | 实时语音对话 | 2026-07-14 | — | 无 | P1 |
| 79 | qwen3-asr-flash | 语音识别 | 2025-09-08 | realtime(10-27)、filetrans(11-17)、2026-02-10 快照 | Qwen3-ASR-0.6B/1.7B(2026-01-28) | P1 |
| 80 | qwen3-livetranslate-flash | 实时语音翻译 | 2025-12-04 | realtime(09-23) | 无 | P2 |
| 81 | qwen3.5-livetranslate-flash-realtime | 实时语音翻译 | 2026-05-19 | 05-19 快照同格 | 无 | P1(slug 异常见 C-6) |
| 82 | qwen-tts | 语音合成 | 2025-04-20 | latest+05-22 快照(06-26 行) | 无 | P2 |
| 83 | qwen-tts-realtime | 实时语音合成 | 2025-07-16 | latest+07-15 快照同格 | 无 | P2 |
| 84 | qwen3-tts-flash | 语音合成 | 2025-11-27 | realtime 同格+09-18 旧快照 | Qwen3-TTS-12Hz-0.6B/1.7B-Base(2026-01-21) | P1 |
| 85 | qwen3-tts-instruct-flash | 语音合成 | 2026-01-21 | realtime 同格+01-26 快照 | Qwen3-TTS-12Hz-*-CustomVoice(2026-01-21) | P1 |
| 86 | qwen3-tts-vc | 合成(音色复刻) | 2026-02-10 | 01-22 快照;realtime 两行 | 无 | P2 |
| 87 | qwen3-tts-vd | 合成(音色设计) | 2026-02-10 | 01-26 快照;realtime 两行 | Qwen3-TTS-12Hz-1.7B-VoiceDesign(2026-01-21) | P2 |
| 88 | qwen-voice-design | 声音设计 | 2025-12-12 | — | 无 | P2 |
| 89 | qwen-voice-enrollment | 声音复刻 | 2025-11-27 | — | 无 | P2 |

### A-8 向量/重排

| # | officialId | 首次上架 | HF | 级 |
|---|---|---|---|---|
| 90 | qwen3.7-text-embedding | 2026-07-15 | 未核验到新仓(Qwen3-Embedding-8B 为 2025-06 系) | P1 |
| 91 | qwen3-vl-embedding | 2026-01-21 | Qwen3-VL-Embedding-2B/8B(2026-01-07) | P1 |
| 92 | qwen3-vl-rerank | 2026-01-29 | Qwen3-VL-Reranker-2B/8B(2026-01-07) | P1 |
| 93 | qwen3-rerank | 2025-10-21 | Qwen3-Reranker-0.6B/4B/8B(2025-05-29~06-03) | P2 |
| 94 | qwen2.5-vl-embedding | 2025-10-21 | (基于 Qwen2.5-VL 系列) | P2 |

### C-5 前缀边界(不带 qwen/wan 的通义自研,默认排除、负例测试固定)

`qvq-max`/`qvq-plus`(视觉推理目录页现役)、`qwq-plus`(文本目录页现役,文档页在档:输入 1.6/输出 4 元)、`tongyi-embedding-vision-plus/flash`、`tongyi-intent-detect-v3`、`text-embedding-v4`、`gte-rerank-v2`、`cosyvoice-v3.5-*`、`fun-asr-*`、`gui-plus`、`aitryon-plus`。**裁定待定项**:qwq/qvq 是 Qwen 品牌线(QwQ="Qwen with Questions",AA 站归 Qwen 家),倾向入;tongyi-/gte/cosyvoice/fun-asr/gui/aitryon 是通义他线品牌,不入。

## B. 定价与限额(华北2(北京)区,官方文档页现价)

单位口径:文本/多模态 元/百万 tokens;图像 元/张;视频 元/秒;TTS 元/万字符;ASR 元/秒。

### 文本旗舰线

| API ID | 输入/输出(元/百万tokens) | 上下文 | 最大输出 | 备注 |
|---|---|---|---|---|
| qwen3.8-max | 12/36(缓存命中 1.5;显式缓存创建 15/命中 1) | 1,000,000 | 131,072 | 思考模式输入 983,616/思维链上限 262,144 |
| qwen3.7-max | 12/36(缓存命中 2.4) | 1,000,000 | 131,072 | |
| qwen3.6-max-preview | 阶梯:低档 9/54、高档 15/90 | 262,144 | 65,536 | 按输入长度两档 |
| qwen3-max | 阶梯:2.5/10 → 4/16 → 7/28 | 262,144 | 65,536 | 思考模式最大输出 32,768 |
| qwen3.7-plus | 2/8(思考高档 6) | 1,000,000 | 131,072 | |
| qwen3.6-plus | 2/12(高档 8/48) | 1,000,000 | 65,536 | |
| qwen3.5-plus | 0.8/4.8(高档 2/12) | 1,000,000 | 65,536 | |
| qwen3.7-flash | 0.2/0.8(高档 0.6) | 1,000,000 | 131,072 | |
| qwen3.6-flash | 1.2/7.2(高档 4.8/28.8) | 1,000,000 | 65,536 | |
| qwen3.5-flash | 0.2/2(高档 0.8/8) | 1,000,000 | 65,536 | |

### 开源家族行

| API ID | 输入/输出 | 上下文 | 最大输出 |
|---|---|---|---|
| qwen3.8-2.4t-a95b | 12/36(与 max 同价) | 1,000,000 | 131,072 |
| qwen3.8-27b | 3/12 | 1,000,000 | 131,072 |
| qwen3.6-27b | 3/18 | 262,144 | 65,536 |
| qwen3.6-35b-a3b | 1.8/10.8 | 262,144 | 65,536 |
| qwen3.5-397b-a17b | 1.2/7.2(思考 3/18) | 262,144 | 65,536 |
| qwen3.5-122b-a10b/-35b-a3b/-27b | 0.6/4.8 等 | 262,144 | 65,536 |
| qwen3-235b-a22b | 2/8(思考 2/20) | 131,072 | 16,384 |
| qwen3-next-80b-a3b | 1/4 | 131,072 | 32,768 |
| qwen2.5-omni-7b | 文本输入 0.6、音频输入 38、图视输入 2;文本输出 2.4(纯文本输入时)/6(含多模态);文本+音频输出 76 | 32,768 | 2,048 |

### 编程/翻译/专项

| API ID | 输入/输出 | 上下文 | 最大输出 |
|---|---|---|---|
| qwen3-coder-plus | 4/16(≤32K),6/24(长输入档) | 1,000,000 | 65,536 |
| qwen3-coder-flash | 1/4,1.5/6 | 1,000,000 | 65,536 |
| qwen3-coder-next | 阶梯 1/4→1.5/6→2.5/10 | 262,144 | 65,536 |
| qwen-mt-plus | 1.8/5.4 | 16,384 | 8,192 |
| qwen-mt-image | 生成 0.003 元/张 | — | — |
| qwen-math-plus | 4/12 | 4,096 | 3,072 |
| qwen-long | 0.5/2(Batch 0.25/1) | **10,000,000** | 8,192 |
| qwen-deep-research | 54/163 | 1,000,000 | 32,768 |
| qwen-plus-character | 0.8/2 | 32,768 | 4,096 |

### 视觉/全模态

| API ID | 输入/输出 | 上下文 | 最大输出 |
|---|---|---|---|
| qwen3-vl-plus | 1/10(高档 1.5) | 262,144 | 32,768 |
| qwen3-vl-flash | 0.15/1.5(高档 0.3) | 262,144 | 32,768 |
| qwen3-vl-235b-a22b-instruct | 2/8 | 131,072 | 32,768 |
| qwen-vl-plus | 0.8/2 | 131,072 | 8,192 |
| qwen-vl-max | 1.6/4 | 131,072 | 8,192 |
| qwen-vl-ocr | 0.3/0.5 | 38,192 | 8,192 |
| qwen3.5-ocr | 0.5/2 | 65,536 | 16,384 |
| qwen3.5-omni-plus | 音频输入 53、文本/图视 7;文本输出 40;文本+音频 213 | 262,144 | 65,536 |
| qwen3.5-omni-flash | 音频输入 18、文本/图视 2.2;文本输出 13.3;文本+音频 72 | 262,144 | 65,536 |
| qwen3-omni-flash | 文本 1.8/音频 15.8/图视 3.3 输入;文本输出 6.9(纯文本)/12.7(多模态);文本+音频 62.6 | 65,536 | 16,384 |

### 图像/视频(元/张、元/秒)

| API ID | 价格 |
|---|---|
| qwen-image-3.0 | 1K/2K 图片输入 0.02/张;1K/2K 生成 0.18/张 |
| qwen-image-3.0-pro | 输入 0.02;生成 1K 0.25、2K 0.5/张 |
| qwen-image-2.0/-plus/wan2.7-image/wan2.6-image/wan2.5-t2i-preview/wan2.2-t2i-plus/wanx2.1-t2i-plus | 0.2 元/张 |
| qwen-image-2.0-pro/-max/edit-max/wan2.7-image-pro | 0.5 元/张 |
| qwen-image | 0.25 元/张 |
| qwen-image-edit | 0.3 元/张;edit-plus 0.2 |
| wan3.0-video | 480P 0.3、720P 0.6、1080P 1.2 元/秒 |
| wan3.0-video-prime | 480P 0.45、720P 0.9、1080P 1.8 元/秒 |
| wan2.7-t2v/-videoedit | 720P 0.6、1080P 1 元/秒 |
| wan2.6-t2v | 720P 0.6、1080P 1 元/秒 |
| wanx2.0-t2i-turbo | 0.04 元/张;wanx-v1 0.16;sketch/style-repaint/background 0.06/0.12/0.08 |
| wanx-virtualmodel/poster-generation-v1/x-painting | 官方原文「暂无公开定价信息。」(非漏采) |

### 音频语音

| API ID | 价格 | 限额 |
|---|---|---|
| qwen-audio-3.0-asr-flash / qwen3-asr-flash | 音频时长 0.00022 元/秒 | — |
| qwen-audio-3.0-tts-plus | 合成 1.4 元/万字符 | — |
| qwen-audio-3.0-tts-flash | 合成 1 元/万字符 | — |
| qwen-audio-3.0-realtime-plus | 音频输入 40、文本输入 5、文本输出 40、文本+音频输出 150 | — |
| qwen-audio-3.0-realtime-flash | 30/3/30/100(同上序) | — |
| qwen-tts | 文本输入 1.6、音频输出 10 | 上下文 8,192、最大输出 7,680 |
| qwen-tts-realtime | 输入 2.4/输出 12 | 同上 |
| qwen3-tts-flash/-instruct-flash/-vc/-vd | 合成 0.8 元/万字符 | — |
| qwen3-livetranslate-flash | 音频输入 10、图片 4、文本输出 10、音频输出 40 | 上下文 53,248 |
| qwen3.5-livetranslate-flash-realtime | 40/3.3/100/160 | 53,248 |
| qwen-voice-design | 0.2 元/次;voice-enrollment 0.01 元/次 | — |

### 向量/重排

| API ID | 价格 | 最大输入 |
|---|---|---|
| qwen3.7-text-embedding / qwen3-rerank | 文本输入 0.5 元/百万tokens | 131,072 / 30,000 |
| qwen3-vl-embedding / qwen3-vl-rerank / qwen2.5-vl-embedding | 文本 0.7、图片 1.8 元/百万tokens | 32,000 / 120,000 / — |

附加:文档页另有分区域限流表(RPM/TPM,如 qwen3.8-max 北京 30,000 RPM/5,000,000 TPM)与新加坡区价(≈北京 1.248 倍)、德国/美国/日本区。

## C. 家族归并说明(要点)

- **C-1 qwen-plus 别名九快照链**:1220(2024-12-26)→0112(01-15)→2025-01-25(02-03)→2025-04-28(04-29,Qwen3-Plus 代)→2025-07-14(07-16)→2025-07-28(07-30)→2025-09-11→2025-12-01(desc「支持1M上下文…阶梯计费」);另有 qwen-plus-latest(07-31,desc「动态更新版本,模型更新不会提前通知」=动态别名自证)。全部归并别名,不立行。
- **C-2 qwen-max 滚动主线**:2024-10-15 行原文「千问2.5系列千亿级别超大规模语言模型……随着模型的升级,qwen-max将滚动更新升级。如果希望使用固定版本,请使用历史快照版本。」——别名语义官方自证。
- **C-3 qwen3.7-max 三段**:preview+05-17 快照(05-20 行)→主线+05-20 快照(05-21)→06-08 快照(06-09,desc「相较于5月20日快照增加了视觉模态理解能力」)。
- **C-4 qwen3-max 两段**:preview(09-05)→GA 主线+09-23 快照→2026-01-23 快照(desc 自证)。
- **C-6 目录页 slug 异常**:`qwen3.5-livetranslate-flash-realtime` 目录链接指向 `/zh/model-studio/qwen3-6`;`qwen3.7-livetranslate` 无独立页;`qwen-vl-ocr` 的 slug 是 `qwenvl-ocr`(无连字符)。
- **C-7 开源 thinking/instruct 双版**:qwen3-235b-a22b、qwen3-vl 全系、qwen3-next-80b-a3b 的双版 = 同一家族两种模式,归并同一行(与 HF 仓名一一对应)。
- **C-8 wan2.7 t2v/r2v 06-12 快照**(2026-07-01 行,desc 自证)归并 wan2.7 行。

## 未核验到(官方源拿不到,不猜)

1. **逐模型下架日期**:首表无下架行;「模型下线机制说明」页只有机制(快照提前 30 天、主线提前 3 个月通知);具体下线公告在 aliyun.com/notice/*(118434 部分老旧模型下线 2026-07-10、118427 长尾 07-09、118420 延期 07-06)——**正文 JS 渲染,SSR 只有标题+日期**。退役 stage 逐模型日期需渲染公告正文。
2. **qwen.ai 博客**:单篇 SSR 空壳(title 仅「Qwen」),博客佐证不可用;发布佐证以百炼表格+HF 仓为准。
3. **参数规模**:仅 qwen3.8-max(2.4 万亿 MoE)、qwen3.8-2.4t-a95b(总 2.4 万亿/激活约 950 亿)、qwen-max(千亿级,别名行不用)有官方数字;qwen3.7/3.6/3.5 系、qwen3-max、VL/omni/wan 全系未披露 → trainingParams=null。
4. **免费额度**:文档页明示「本文仅展示模型调用原价,不包含限时优惠等活动信息」。
5. **wanx-virtualmodel/poster/x-painting 定价**:官方明示「暂无公开定价信息」——pricing=null 注明官方明示。
