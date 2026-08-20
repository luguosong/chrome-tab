# 03 — 原型:Liquid Glass 视觉原型(图标层 + 外围 chrome)

Type: prototype
Status: resolved
Blocked by: 01

## Question

Liquid Glass 落到本项目的真实壁纸与真实内容上,长什么样、选哪一档?做**静态原型页**(一次性资产,不动生产代码):真实壁纸背景上呈现——

- 五种图标形态:nav(app 图标式)、stock/weather/changelog(widget 式,各至少两档尺寸)、分组(iOS 文件夹式);
- 外围 chrome:搜索框、页签条、时钟、(任一)抽屉的玻璃皮肤;
- 至少两档玻璃材质(取自「Liquid Glass 规范与 Web 复刻调研」的参数表)并排对比,不同壁纸上各出一版;
- **对照 Apple 铁律验证叠放合法性**(研究票 01 §4):图标裸坐壁纸 vs 坐 L0 玻璃页板两版都要出——玻璃页板上再放玻璃图标是否"glass 叠 glass"违和,由用户目测定夺。

与用户一起挑:材质档位、圆角/高光倾向、widget 内容排版方向。原型放 throwaway 分支或独立路由,链接回本票。

## Answer

**用户裁决(2026-08-19,看过原型实机后):方向 C · 折射 chrome。**

**原型资产**:`prototype/liquid-glass` 分支 @ `3f10ddf`。复跑:`git checkout prototype/liquid-glass && cd frontend && pnpm dev`,访问 `/prototype/liquid-glass?variant=A|B|C`。文件:`frontend/src/routes/PrototypeLiquidGlassPage.tsx` + `prototype-liquid-glass.css` + `prototype-lens.ts` + App.tsx 一行路由(均标 PROTOTYPE)。

裁决细目:

1. **材质档位 = C**:保留 L0 页板(整体雾化画布,现状结构强化),搜索框/页签条/右上胶囊/箭头升 **L2 clear 折射档**(SVG feDisplacementMap RGB 色散 + feGaussianBlur 0.7),`backdrop-filter: url()` 在用户 Chrome 实测**生效**(选 C 的前提;研究票 01 §6 验证清单第 1 条通过)。A「图标裸坐壁纸」方向否决。
2. **叠放裁决(隐含)**:C 构建于 B 之上 → L0 页板保留,「图标坐玻璃页板 + 图标自身玻璃底板」的 glass-on-glass 叠放经目测**可接受**(Apple 铁律「禁叠放」在本项目让位于现状结构)。图标底板用 soft 档(轻一档,视觉后退),与 chrome 的 L2/L1 拉开层级。
3. **材质参数落定候选**(取研究票 01 §4 参数表,已在原型 css 验证观感):L0 页板 blur(8)/saturate(140%)/white·18%;L1 regular(抽屉/弹层)blur(20)/saturate(180%)/white·55% 明暗双值;L2 折射 = url(#lens) blur(2px) saturate(160%) + 近透明底 white·6% + 色散 scale -148/-150/-152;图标 squircle soft 档 blur(6)/saturate(150%)/white·16% + 圆角 24%。最终数值票 05 落 spec。
4. **未提异议项**(原型呈现方向默认通过,细节留票 04 逐节确认):widget 内容排版方向(iOS 小组件式:stock=大价格+sparkline、weather=城市+大温度+状况、changelog=版本列表);nav squircle 玻璃底板 + 名称外置;分组 iOS 文件夹式 3×3 迷你预览;页签 active 实心白凸起;时钟大字裸排(iOS 锁屏式)。
5. **实现注意**:L2 的 displacement map 必须**逐元素按实测盒尺寸生成**(原型 `<LensBox>` mount 后 getBoundingClientRect → canvas SDF,生产化需 ResizeObserver 重建;多元素考虑共享 map,见研究票 01 §6 帧率项)。
