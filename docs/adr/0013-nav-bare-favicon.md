# nav 图标去底板:裸 favicon 直出

nav(网站链接)图标不再包 soft 档玻璃 squircle 底板,favicon 直接渲染、坐 L0 页板上,名称照旧外置图标下方;hover 反馈从 glass-soft 提亮改为 favicon 轻缩放(`hover:scale-110 active:scale-95`,接续 dwell 手势 `scale-[1.15]` 的既有缩放语言)。这是对 ADR-0012 方向 C 中 nav 部分的**有限度反转**:当时否决「裸图标」的理由是可读性,但被否的是**裸坐壁纸**;方向 C 定稿后图标实际坐 L0 页板雾化层(blur 8 / white·18%),壁纸细节已被削弱,可读性前提变了——用户据此定夺反转。反转范围仅 nav:分组底板(soft 档、30% 圆角,承载 iOS 文件夹容器心智、内压 9 枚迷你图标)、小组件玻璃卡与 L0/L1/L2 三档材质体系全部不动。

尺寸策略随之简化:favPx 即裸图标理想边长与上限(底板时代的 fav×1.5 留白系数无意义了);flex-1 + aspect-square 吃画格剩余高度的自适应骨架(9020806)保留,防 small 画格 + 大 iconScale 溢出。DragOverlay 拖拽幽灵同视觉:裸 favicon 固定 favPx。favicon 自身圆角 22% 沿用底板时代参数(原语义为嵌于 24% 底板内留缝),底板删除后无参照、作为独立审美参数保留;hover 缩放仅在网格态生效(幽灵恒处光标下方,`:hover` 会恒命中)。

## 备选方案(已否决)

- **保留底板(ADR-0012 原案)**:glass-on-glass 层级统一,但观感偏重;L0 页板雾化已兜底可读性,再叠一层理由不足。
- **hover 反馈用提亮/光晕**:提亮(brightness)对位图 favicon 效果因图而异,光晕装饰性与全局克制风格不符;缩放反馈区域精准(不动名称文字)且 transform 不触发重排。

## 注记(2026-09-01):hover 幅度 110 → 105

`hover:scale-110` 的立法语境是 nav 裸 favicon——缩放是**唯一** hover 反馈通道,10% 有理由。Tile 深 module 收拢(ADR-0016 注记 e)后这行类名延伸到所有非裸玻璃块:玻璃块已有 `.glass-soft:hover` 提亮(ADR-0012),叠成双反馈,且 10% 幅度对图标网格这一全应用最高频 hover 面(光标扫过网格沿途逐块放大-还原)未经独立评估。动效审计(emil-design-eng 标尺)裁:**存在性保留**(缩放仍是图标层 hover 语言,dwell `scale-[1.15]` 阶梯不变),幅度降半档至 `hover:scale-105`;hover→active 突跳随之 15% → 10%。nav 裸 favicon 同幅下调保持全类型一致,而非 nav 单独留 110 造成同面双档。
