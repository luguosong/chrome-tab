# Liquid Glass 三档材质体系

> **注记(2026-09-03)**:文本密集浮层(详情 Modal / 抽屉 / 下拉 / 快览卡 / toast)的 L1 材质经用户裁决转不透明实底——`.glass-panel-readable` 由「玻璃垫底」改义为「实底浮层」并 `backdrop-filter: none`,玻璃保留在 chrome/控件/页板层;见 [ADR-0055](0055-readable-overlay-opaque-solid.md)。L0/L2 与控件侧玻璃不变。

> **注记(2026-08-20)**:本文「图标层 nav 用 squircle soft 档」及方向 C 裁决中 nav 图标着玻璃底板的部分,已被 [ADR-0013](0013-nav-bare-favicon.md) 取代(nav 改裸 favicon 直出,前提:L0 页板雾化已兜底可读性);L0/L1/L2 三档、分组底板与小组件玻璃卡仍有效。

> **注记(2026-09-02)**:实机验证原型资产(/prototype/liquid-glass 免登录路由 + PrototypeLiquidGlassPage / prototype-lens / prototype-liquid-glass.css 三文件)当日定夺后退役删除——方向裁决已履行完毕(本文「方向 C 裁决」即其产物,生产 LensBox 为折射基建的正式形态);一次性原型不再随 dist 出货,资产 git 历史可考。

整个新标签页按 iOS 26 Liquid Glass 统一为三档材质:**L0 页板雾化**(整视口内容画布;项目自创档、非 Apple 官方 regular/clear 两档之一,即现有 `.page-panel`,现值 blur 8 / saturate 140% / 亮 white·18% 已与定稿一致,定标不动)、**L1 regular**(弹层 / 抽屉主力档:blur 20 / saturate 180%,明暗双值参数,含 border / 内高光 / 外阴影;「亮」分支当前永久深色产品下不生效,token 落全为将来主题化留量)、**L2 clear 折射**(搜索框 / 页签条 / 右上胶囊 / 翻页箭头等少量标志性 chrome:`backdrop-filter: url(#lens) blur(2px) saturate(160%)` + 近透明底,SVG 滤镜链 `feImage` → `feDisplacementMap`×3(RGB 色散 scale -148/-150/-152)→ `feGaussianBlur(0.7)`)。参数定稿与逐项依据见 `research/liquid-glass` 分支;图标层 nav 用 squircle soft 档(blur 6 / saturate 150% / white·16% / 圆角 24%),比 chrome 轻一档、视觉后退。

**方向 C 裁决(原型 `prototype/liquid-glass` 分支实机验证后用户定夺)**:保留 L0 页板 + 图标坐页板,搜索框 / 页签条 / 胶囊 / 箭头升 L2。这记录了一次对 Apple 用法铁律("玻璃只给功能层、禁 glass 叠 glass")的**有意让位**:本项目图标网格坐在 L0 页板上,图标自身再着玻璃底板——glass-on-glass 经原型目测放行,以 L0 轻档页板 + 图标 soft 档拉开层级。"图标裸坐壁纸"的方向 A 因可读性被否决。

**不引库**(社区库停更 / React 耦合):折射所需的 displacement map 逐元素按实测盒尺寸生成(canvas 逐像素 rounded-rect SDF,≈60 行,借鉴 shuding 方案),封装为 `LensBox` 组件——mount 后 `getBoundingClientRect`、`ResizeObserver` 重建、`@supports (backdrop-filter: url(#f))` 不满足回落 L1。`backdrop-filter: url()` 在目标 Chrome 实测生效是选 L2 的前提(原型已验证);回落路径保证失败无沉没成本。L2 只给少量 chrome 元素,不大面积铺(每滤镜实例占 GPU 资源)。

## 备选方案(已否决)

- **方向 A「图标裸坐壁纸」**:更贴 Apple 铁律,但内容可读性经原型否决。
- **引 liquid-glass 类库**:停更风险 + 新依赖,自写 ≈60 行可覆盖。
- **只做纯 CSS 两档(不做 L2)**:省一组滤镜基建,但 chrome 无折射质感,与"全 UI 重塑"的目标不符。
