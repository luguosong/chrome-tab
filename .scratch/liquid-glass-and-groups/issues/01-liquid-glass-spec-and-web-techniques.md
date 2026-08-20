# 01 — 调研:iOS 26 Liquid Glass 设计规范与 Web 复刻技法

Type: research
Status: resolved

## Question

Apple iOS 26 的 Liquid Glass(液态玻璃)设计语言,落到 Web(CSS)上可靠复刻需要哪些事实?

- HIG 对 Liquid Glass 材质的定义:材质档位(regular/clear × 明暗)、模糊度、饱和度、透明度、同心圆角(concentric corners)、边缘高光/折射、对背景的动态适应——尽量给出可量化的参数或描述。
- Web 复刻主流技法:`backdrop-filter`(blur+saturate)、多层 inset 高光/border 渐变、SVG displacement 真折射方案、现成社区库/案例(liquid-glass 类组件)。
- 目标环境是 Chrome 新标签页(Chromium),兼容约束宽松;评估「纯 CSS 玻璃」vs「带 SVG 折射」两档的成本与效果。
- 输出:可执行的材质参数表(建议 2-3 档玻璃)与推荐技法,供「Liquid Glass 视觉原型」票直接取用。

结论写到仓库 `research/liquid-glass` 分支(throwaway),完成后本票正文回填指针。

## Answer

**结论文件**:`research/liquid-glass` 分支 @ `bc2b909`,路径 `.scratch/liquid-glass-and-groups/research/01-liquid-glass-spec-and-web-techniques.md`。读取:`git show research/liquid-glass:.scratch/liquid-glass-and-groups/research/01-liquid-glass-spec-and-web-techniques.md`。

要点(详证与参数表见结论文件):

1. Apple 只定义 **regular / clear 两档**玻璃:regular 有背景自适应(推荐默认);模糊/饱和/折射数值官方未公开,社区逆向值仅作起步。
2. 传言纠偏:「Meet Liquid Glass」是 WWDC25 **Session 219**(非 250);同心圆角一手出处是 **Session 356**,公式 `内半径 = 外半径 − padding`。
3. **真折射路线对我们开放**:`backdrop-filter: url(#svg)` 位移折射在 Chromium 108+ 可用(Safari/Firefox 不可用)——目标即 Chrome 新标签页。
4. **Apple 用法铁律(与本项目有张力,原型票必须验证)**:玻璃给功能层(页签条/搜索框/弹层/抽屉),内容层不上玻璃、禁 glass 叠 glass——而我们的图标坐在 L0 玻璃页板上。iOS 26 图标自身也可选玻璃渲染,故「图标玻璃 × 页板玻璃」的叠放合法性需在原型里两版对比后由用户定。
5. 产出 **3 档参数表**:L0 页板雾化(维持现有 `page-panel`,≈ Apple standard material)、L1 regular 玻璃(blur 20 / saturate 180% / 多层 inset 高光,明暗双值)、L2 clear 折射档(SVG feDisplacementMap 三色散 + blur 0.7,仅 dock/搜索条级 chrome)。
6. 推荐两步走:先纯 CSS 收敛 L0/L1(一个 CSS 文件);L2 先做 5 分钟验证页再上,失败回落 L1 无沉没成本。**不引库**(相关库停更/React 耦合),借鉴 shuding 的 canvas-SDF map 生成(≈60 行)自写。
7. 性能:壁纸静止 + 小面积玻璃在 Chromium backdrop-filter 便宜区间;MV3 新标签页无平台限制。文件含 5 项落地前验证清单(核心:实测目标 Chrome 版本的 `backdrop-filter: url()`)。

