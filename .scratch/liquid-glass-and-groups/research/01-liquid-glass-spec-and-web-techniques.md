# 调研:Apple Liquid Glass 材质规范与 Web 复刻技法

- 对应票据:`.scratch/liquid-glass-and-groups/issues/01-liquid-glass-spec-and-web-techniques.md`(本文件为独立结论,票据回填由主 session 负责)
- 日期:2026-08-19
- 环境:Chrome MV3 新标签页(Chromium-only),React 18 + Tailwind 4,壁纸为自渲染静态层(`frontend/src/components/Background.tsx`)

## 结论速览(TL;DR)

1. **Apple 只公开了两档玻璃(regular/clear)与一个数值**(clear 档在亮背景上的 35% 暗色调光层)。模糊半径、饱和度、折射率等均未公开,社区逆向值彼此不一,只能当起步参考。
2. **`backdrop-filter: url(#svgFilter)`(SVG 位移折射)在 Chromium 可用,Safari/Firefox 不可用**——我们目标是 Chrome 新标签页,这条路对我们完全开放,无需降级。
3. 推荐**两档落地**:纯 CSS 玻璃(blur+saturate+多层高光)做主力;SVG 折射档(`backdrop-filter: url()` + feDisplacementMap 色散)只给少量标志性浮层(dock/搜索条),做渐进增强。**不建议引库**(主流库是 React 组件且核心库已停更),自写 ≈ 百行。
4. Apple 用法铁律直译:玻璃只给**功能层**(导航/控件/弹层),**永远不要 glass 叠 glass**,内容层(图标网格)保持现有轻度雾化即可——这直接约束了我们哪些 UI 元素该上玻璃。

---

## 1. Apple HIG 对 Liquid Glass 的定义(一手)

来源:HIG Materials、WWDC25 Session 219「Meet Liquid Glass」transcript、Apple 开发者文档。

> 注意:网上常引的「session 250」编号有误,Meet Liquid Glass 是 **Session 219**;同心圆角的一手出处是 **Session 356**("Get to know the new design system"),HIG Layout 页经全文核对**并不含**同心圆角规则。

### 1.1 材质定位与档位

- 定义:「Liquid Glass 是一种动态材质……在不遮挡底层内容的情况下呈现控件和导航」。它构成**漂浮在内容层之上的功能层**,内容从其下方滚动并隐约透出。
- 两条硬规则:**不要在内容层使用 Liquid Glass**(例外:滑块/开关等瞬时交互控件激活时);**克制使用**,只给最重要的功能元素。
- 两档变体(官方语义,不混用):
  - **regular**:模糊背景并调整亮度以保可读性,大多数系统组件用它;含大量文本(alert/sidebar/popover)或背景可能干扰可读时用它。**有自适应行为**(下浅则亮、下深则暗)。
  - **clear**:高度半透明、无自适应,用于漂浮在照片/视频等媒体之上的组件,追求沉浸。**官方唯一公开数值**:底层内容明亮时,考虑加 **35% 不透明度的暗色调光层**;内容够暗则不必。
- 明暗:两档外观都随系统设置变化(用户偏好的外观、降低透明度、增强对比度)。

### 1.2 数值参数:官方未公开

- 除 clear 的 35% 调光层外,**模糊半径/饱和度/alpha/折射率/边缘高光规格均无公开数值**,WWDC 219 全文只有定性描述(「实时弯曲和塑造光」「分层系统」)。
- 社区逆向参考(二手,取值分歧大):折射按玻璃 IOR 1.52 建 SDF;CSS 复刻常见 `blur(2–50px) saturate(1.5–2)` + feDisplacementMap 边缘位移 + 分层内高光。图形工程师观察:真 Liquid Glass **在形状边缘附近修改采样 UV(折射)**,这是纯 blur+saturate 无法复现的关键差异。

### 1.3 同心圆角(concentric corners)

WWDC 356 原则:「让圆角与边距围绕**共同的圆心**对齐,形状可以舒适地嵌套」。三种形状:固定半径 / 胶囊(半径=高度一半)/ 同心(**内半径 = 外半径 − padding**)。圆角显「捏」或「张」时就该换 concentric。

Web 无原生 API,用公式手算:`innerRadius = outerRadius - inset`(配 CSS 变量 `calc()`),用于:磁贴内 icon 容器、面板内嵌卡片、dock 内图标槽。

### 1.4 边缘高光、折射与动态适应(WWDC 219 要点)

- **透镜感**:材质「实时弯曲、塑造并汇聚光」;出现/消失靠调制折射而非淡入淡出。
- **边缘高光**:环境光源产生随几何响应的镜面高光,交互时光沿边缘游走勾出轮廓。
- **动态适应**:每层基于背后内容持续自适应——文本滚过时阴影加深;小元素可整明暗翻转,大元素不整体翻转但字形镜像翻转保对比;附近彩色内容的光会「洒」在玻璃表面。
- **尺寸效应**:元素变大时模拟更厚材质(更深阴影、更明显折射);着色(tint)生成一组随背后亮度映射的色调范围。
- **可访问性**(系统级自动生效):Reduce Transparency → 更磨砂、遮挡更多;Increase Contrast → 黑白为主+对比描边;Reduce Motion → 减弱效果与弹性。

### 1.5 API 概览(仅备查,Web 项目不直接用)

SwiftUI:`glassEffect(_:in:)`、`Glass.regular/.clear/.identity`、`.interactive()`、`GlassEffectContainer`(合并/形变)、`backgroundExtensionEffect()`、`ConcentricRectangle`。UIKit:`UIGlassEffect(style: .regular/.clear)`。AppKit:`NSGlassEffectView`。

---

## 2. Web 复刻技法盘点

### 2.1 纯 CSS 玻璃(blur + saturate + 多层高光)

社区共识层叠配方:

```css
.glass {
  background: rgba(255, 255, 255, 0.10–0.55);   /* 必须半透明,否则 backdrop-filter 不可见 */
  backdrop-filter: blur(8–20px) saturate(150–180%);
  border: 1px solid rgba(255, 255, 255, 0.2–0.5);
  border-radius: 12–20px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.10–0.35),        /* 外投影,与背景分离 */
    inset 0 1px 0 rgba(255, 255, 255, 0.35–0.5); /* 顶部内高光 = 玻璃厚度感 */
}
```

要点:Chromium 76+ 无前缀可用(整体支持率 97%+);元素自身 `opacity<1` 会破坏 backdrop-filter;进阶可加顶部 specular 线性渐变伪元素、mask 渐隐模糊(Josh Comeau 的 200% 高兄弟层技法)。成本:纯合成器路径,**静态小面积近乎免费**。

### 2.2 SVG 位移折射(真折射)

**兼容性关键结论(多来源一致)**:`backdrop-filter: url(#f)` 引用 SVG 滤镜——**Chromium 可用**(Chrome ~108+ 起渲染,2025 年所有复刻实现均以 Chrome 为目标;kube.io/ekino/LogRocket/rebane2001 gist 相互印证);**Safari 不可用**(WebKit bug 245510)、**Firefox 不可用**(MDN BCA issue #24110 实测)。目标环境是 Chrome 新标签页 ⇒ 对我们开放。

滤镜链成熟配方(rebane2001 gist,病毒级传播;shuding/liquid-glass 同思路):

- `feImage` 喂一张与元素**同尺寸同圆角**的 displacement map(map 必须逐元素生成,不可跨尺寸缩放);
- `feDisplacementMap` × 3 次、scale ≈ -148/-150/-152 分别喂 R/G/B 通道 → **RGB 色散**(真玻璃的色散感);
- `feGaussianBlur stdDeviation≈0.7` 柔化像素锯齿(SVG 位移无超采样,边缘会像素化);
- 再接 `blur(0.25–2px) contrast(1.2) brightness(1.05) saturate(1.1)` 提质感。

Displacement map 生成:编码规则 128=不位移、0/255=±满偏移;canvas 逐像素算 rounded-rect SDF + smoothstep 最保真(shuding 方案 ≈60 行 JS),设计工具画径向渐变 PNG 也可。

### 2.3 变体:壁纸副本层折射(备选,不需要 backdrop-filter url())

对「壁纸的裁剪副本」施加普通 `filter: url(#displacement)`(普通 filter 引 SVG 全浏览器可用),负偏移对齐真实背景。rdev/liquid-glass-react 实际就是这么做的。局限:副本须与真实背景严格同步。**我们的壁纸静止且自渲染,天然适合;但既已能用 backdrop-filter url(),此路仅作备选。**

### 2.4 现成库盘点

| 库 | 形态 | 状态 | 判断 |
|---|---|---|---|
| rdev/liquid-glass-react (~5.9k★, MIT) | React 组件 | 2025-06 后停更,24 open issues | 不引:React 组件形态耦合,停更 |
| shuding/liquid-glass (~1.1k★, MIT) | 单文件 JS,canvas SDF 生成 map | 活跃(push 2026-03) | **抄思路**:map 生成函数 ≈60 行 |
| samasante/liquid-glass (MIT, 零依赖) | headless React lens | 小众 | 跨浏览器设计,我们用不上 |
| rebane2001 gist | CSS+SVG 片段 | — | **抄参数**:色散 scale/blur 链 |

未发现成熟 Tailwind liquid-glass 插件。**结论:不引依赖**,借鉴 shuding(map 生成)+ rebane2001(滤镜链)自写。

### 2.5 Chromium 性能注意

- backdrop-filter 走 GPU 合成:**静态小面积便宜;大面积 + 背后内容每帧变化才贵**。我们的壁纸静止,落在便宜区间。
- SVG 位移比 blur 便宜(位移是单次查找,blur 是邻域平均)。
- 每个滤镜实例占 GPU 资源:折射档只给少量元素(dock/搜索条/弹层),别大面积铺。
- MV3 新标签页无特殊限制:经 `chrome_url_overrides.newtab` 的扩展页具备标准 Web 平台能力,约束只有扩展页 CSP(禁远程/内联脚本),不影响 CSS/SVG 滤镜。
- 已知 Chromium bug:波动/涟漪类动态用法有绘制耗时异常报告(#404285923)——静态折射不受影响。

---

## 3. 两档方案成本/效果评估(Chromium)

| 维度 | 纯 CSS 玻璃 | + SVG 折射档 |
|---|---|---|
| 还原度 | 磨砂玻璃感(glassmorphism);**无边缘折射/色散**,与真 Liquid Glass 的差距正在此 | 有边缘弯折+RGB 色散,接近真品「透镜感」 |
| 实现量 | ~20 行 CSS,现有 `.glass-panel` 已具雏形 | +1 个 SVG 滤镜定义 + ~60 行 map 生成工具 + 逐元素注入尺寸 |
| 性能 | 近乎免费 | 静态小面积可忽略;元素多/大时有感 |
| 风险 | 无 | 依赖 Chromium 专属行为(`backdrop-filter: url()`,规范未定 w3c/svgwg#1142);map 须按元素尺寸生成,尺寸变化要重建 |
| 兼容 | 全浏览器 | 仅 Chromium——对我们即目标环境 |

## 4. 材质参数表(落地 3 档,含明暗双值)

对齐 Apple 语义,映射到现有类(`globals.css` 已有 `.page-panel`/`.glass-panel`,下表为收敛后的完整体系):

### L0 · 页板雾化 `page-panel`(= Apple standard material,非 Liquid Glass)

整视口内容层。Apple 明确「内容层不用 Liquid Glass」,**保持现状即可**:

| 参数 | 亮 | 暗 |
|---|---|---|
| background | `rgba(255,255,255,0.18)` | `rgba(18,18,23,0.36)` |
| backdrop-filter | `blur(8px) saturate(140%)` | 同左 |
| 内高光 | `inset 0 1px 0 rgba(255,255,255,0.1)` | 同左 |

### L1 · regular 玻璃 `glass-panel`(主力档:弹窗/抽屉/侧栏/编辑栏)

| 参数 | 亮 | 暗 |
|---|---|---|
| background | `rgba(255,255,255,0.55)` | `rgba(24,24,27,0.50)` |
| backdrop-filter | `blur(20px) saturate(180%)` | 同左 |
| border | `1px rgba(255,255,255,0.50)` | `1px rgba(255,255,255,0.10)` |
| 内高光 | `inset 0 1px 0 rgba(255,255,255,0.40)` | `inset 0 1px 0 rgba(255,255,255,0.12)` |
| 外阴影 | `0 8px 32px rgba(0,0,0,0.18)` | `0 8px 32px rgba(0,0,0,0.35)` |
| 可读性兜底 | 文本多的弹层再垫 `bg-white/20` | 暗色下垫 `black/20` |

### L2 · clear 玻璃(折射档,渐进增强:dock/顶部搜索条/标志性浮层)

| 参数 | 值 |
|---|---|
| background | `rgba(255,255,255,0.06)`(近透明) |
| backdrop-filter | `url(#lens-filter) blur(2px) saturate(160%)` |
| 滤镜链 | feImage(元素专属 map)→ feDisplacementMap×3(scale -148/-150/-152,RGB 色散)→ feGaussianBlur(stdDeviation 0.7) |
| 调光层 | 背景亮时叠 `rgba(0,0,0,0.35)`(**官方唯一数值**);背景暗可省 |
| 边缘 specular | 顶部 1px 内高光 + 可选线性渐变伪元素(opacity 0.2–0.35) |
| 启用条件 | Chrome 实测 `backdrop-filter: url()` 可用;不可用则回落 L1 |

实现要点:map 用 canvas 按「元素实际像素尺寸 × 圆角」生成 rounded-rect SDF(参考 shuding/liquid-glass 的 ~60 行方案);元素 resize 时重建;filter 需带 `filterUnits="userSpaceOnUse"` 按像素对齐。

### 通用规则(从 HIG 直译)

- **用法边界**:玻璃只给功能层(页签条/dock/弹层/抽屉/编辑工具条);图标磁贴、卡片等内容层不上玻璃。
- **禁止 glass 叠 glass**:弹层压在页签条上时,弹层用 L1,底下的玻璃元素视觉后退(降透明度),不做两层玻璃互相采样。
- **同心圆角**:`inner = outer − inset`(CSS 变量 calc);dock 图标槽、面板内嵌卡片适用。
- **可访问性降级**:高对比诉求下提高背景 alpha、去折射;`prefers-reduced-transparency` 媒体查询在 Chrome 的支持情况落地前先实测再决定是否接(验证项,见 §6)。

## 5. 推荐路径

1. **第一步(纯 CSS,低风险)**:按 §4 收敛 L0/L1 参数——基本是把现有 `.glass-panel` 的 blur 16→20、补内外高光与外阴影,工作量一个 CSS 文件。
2. **第二步(折射,渐进增强)**:先做一个 5 分钟验证页(单个 div + rebane2001 gist 滤镜链)确认目标 Chrome 版本 `backdrop-filter: url()` 渲染正常;通过后再写 map 生成工具,只给 dock/搜索条启用 L2。验证不过就停在 L1,无沉没成本。
3. **不引库**:主流库均为 React 组件、核心库停更;自写 map 生成 + 滤镜组件即覆盖。

## 6. 验证清单(落地前必做)

- [ ] Chrome(扩展运行的最低版本)实测 `backdrop-filter: url(#f) blur()` 是否渲染——L2 的唯一硬依赖
- [ ] 折射档在低分屏(DPR=1)的像素化程度,`stdDeviation 0.7` 是否够
- [ ] 明/暗壁纸下 L1 文本对比度(现有 dark 遮罩 black/25·black/45 与玻璃叠用的可读性)
- [ ] `prefers-reduced-transparency` 在 Chrome 的可用性与降级方案
- [ ] 多个 L2 元素同屏时的帧率(dock N 个图标槽若逐个生成 map,考虑共享一张 map)

## 来源清单

**一手(Apple 官方)**

1. HIG Materials — https://developer.apple.com/design/human-interface-guidelines/materials
2. WWDC25 Session 219「Meet Liquid Glass」transcript — https://developer.apple.com/videos/play/wwdc2025/219/
3. WWDC25 Session 356「Get to know the new design system」(同心圆角) — https://developer.apple.com/videos/play/wwdc2025/356/
4. Adopting Liquid Glass(API 总览) — https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
5. SwiftUI `Glass` / `glassEffect` / `GlassEffectContainer` / `ConcentricRectangle` — https://developer.apple.com/documentation/swiftui/glass 等
6. UIKit `UIGlassEffect`(.regular/.clear) — https://developer.apple.com/documentation/uikit/uiglasseffect
7. Apple Newsroom(设计发布) — https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
8. HIG Layout(核对:不含同心圆角规则) — https://developer.apple.com/design/human-interface-guidelines/layout

**一手(Web 平台)**

9. MDN backdrop-filter(语法允许 url()) — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
10. WebKit bug 245510(Safari 不支持 url() 于 backdrop-filter) — https://bugs.webkit.org/show_bug.cgi?id=245510
11. MDN browser-compat-data #24110(Safari/Firefox 实测失败) — https://github.com/mdn/browser-compat-data/issues/24110
12. W3C svgwg #1142(backdrop 折射未定规范) — https://github.com/w3c/svgwg/issues/1142
13. caniuse css-backdrop-filter / svg-filters — https://caniuse.com/css-backdrop-filter
14. Chrome 扩展覆盖新标签页(无特殊限制) — https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages
15. Chromium issues #404285923(动态涟漪类用法性能) — https://issues.chromium.org/issues/404285923

**技法与库(二手)**

16. rebane2001 gist(色散滤镜链参数) — https://gist.github.com/rebane2001/8ba35ad6e1b17c4cb5b2b2431d9e992c
17. shuding/liquid-glass(canvas SDF map 生成) — https://github.com/shuding/liquid-glass
18. rdev/liquid-glass-react(副本层 filter:url() 思路) — https://github.com/rdev/liquid-glass-react
19. samasante/liquid-glass — https://github.com/samasante/liquid-glass
20. kube.io(Snell 定律 map 生成、Chromium-only 论断) — https://kube.io/blog/liquid-glass-css-svg/
21. ekino(位移成本核算、map 同尺寸要求) — https://medium.com/ekino-france/liquid-glass-in-css-and-svg-839985fcb88d
22. LogRocket(map 制作与性能护栏) — https://blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg/
23. Josh Comeau backdrop-filter 进阶 — https://www.joshwcomeau.com/css/backdrop-filter/
24. CSS-Tricks(Liquid Glass 分层拆解 / 图标玻璃) — https://css-tricks.com/getting-clarity-on-apples-liquid-glass/ 、 https://css-tricks.com/icon-glassmorphism-effect-in-css/
25. Sebastian Aaltonen(边缘 UV 位移观察) — https://x.com/SebAaltonen/status/1932705387909955682
