# 09 — Liquid Glass 基建:材质 token + LensBox 折射容器

Type: task
Status: ready-for-human
Blocked by: 无 — 可与 06–08 并行
落地:a27cc2b(代码/测试/双轴 review 完成;余下 3 项为实机手动验证)

**What to build:** 视觉地基,不动具体业务组件(换肤在 10/11/12)。`globals.css` 落三档材质 token(参数为原型实机验证定稿,逐项依据见 `research/liquid-glass` 分支 @ `bc2b909`):**L0** = `.page-panel` 定标(**现值已与定稿一致,不改**;`blur(8px) saturate(140%)`;亮 `rgba(255,255,255,0.18)` / 暗 `rgba(18,18,23,0.36)` + 顶部内高光);**L1** = `.glass-panel` 升参(现 blur 16 / saturate 160% → `blur(20px) saturate(180%)`;亮 `rgba(255,255,255,0.55)` / 暗 `rgba(24,24,27,0.50)`;border `1px` 白 50%/10%、内高光、外阴影 `0 8px 32px` 黑 18%/35% 明暗双值;文本密集面板可垫 white·20% / black·20% 兜底层);**L2** = 新样式(`backdrop-filter: url(#lens) blur(2px) saturate(160%)` + 近透明底 `rgba(255,255,255,0.06)` + 顶部 1px 内高光)。token 明暗双值均落——「亮」分支当前永久深色产品下不生效,为将来主题化留量、成本为零。新组件 `LensBox`(L2 折射容器):mount 后 `getBoundingClientRect` 实测盒尺寸 → canvas 逐像素 rounded-rect SDF 生成 displacement map(128 = 不位移;≈60 行,借鉴 shuding 方案,**不引库**)→ 注入 SVG 滤镜(`feImage` + `feDisplacementMap`×3 scale **-148/-150/-152**(RGB 色散)+ `feGaussianBlur` stdDeviation **0.7**);`ResizeObserver` 监听尺寸变化重建 map;多实例同屏考虑共享 map(帧率实测后定);`@supports (backdrop-filter: url(#f))` 不满足自动回落 L1。性能约束:L2 仅给少量 chrome 元素用,不大面积铺。

遵循 ADR-0012(三档材质 + 方向 C 裁决 + glass-on-glass 让位)。

**工具:** 实现时使用 ui-ux-pro-max 插件——动工前 Skill 调用 `ui-ux-pro-max:ui-ux-pro-max`(UI/UX 设计智能);涉及 Tailwind 样式细节可配 `ui-ux-pro-max:ui-styling`。

- [x] globals.css:L0 定标(现值已符,不改)/ L1 升参(明暗双值)+ L2 样式与 `@supports` 回落 L1
- [x] `LensBox`:SDF map 生成 + SVG 滤镜注入(色散 -148/-150/-152、blur 0.7)+ `filterUnits="userSpaceOnUse"` 像素对齐
- [x] `ResizeObserver` 重建 map;元素自身 `opacity<1` 不破坏 backdrop-filter(已知 Chromium 坑)— 以 LensBox JSDoc 记录约束(入场动画用 transform,勿用 opacity 渐显)
- [ ] DPR=1 下边缘像素化观感检查(stdDeviation 0.7 是否足够) — 待手动
- [ ] 多 LensBox 同屏帧率抽查(共享 map 视结果定,不做亦可) — 待手动
- [ ] 验证:临时套用到一两个元素实机目测(明/暗壁纸各一) — **待手动验证**(如临时试:<SearchBox 外壳换 `<LensBox radius={999}>` 看 L2 折射)
