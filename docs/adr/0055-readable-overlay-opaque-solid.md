# 文本密集浮层不透明化:readable 档从半透明垫底转实底

背景:`.glass-panel-readable` 自 ADR-0012 体系建立起是「玻璃底上的可读性垫底」——dark 态 zinc·60 叠在 blur(20px) 玻璃上,合成后浮层仍透壁纸约四成。2026-09-03 用户裁决「所有对话框以及悬浮提示框都做成非透明,避免文字穿透,影响阅读」:模糊后的壁纸轮廓在深底上仍构成低对比噪底,长文阅读(待办备注 / changelog / 模型评测)与浅色小字(meta 档 white/40–60)受扰明显;两次垫底加码(0.5→0.6)未根治,该轴已到顶。

**决策:`.glass-panel-readable` 转不透明实底(dark `#1c1c1e`,iOS 暗面 secondarySystemBackground 档)并显式 `backdrop-filter: none`;该类即「文本密集浮层」的既有语义标记,单点改值即全量生效,另为 5 处裸 `glass-panel` 的浮层(分组弹层 / 编辑气泡 / 容量与错误 toast / 离线与冲突 toast)补挂该类。**

1. **取色保持白系文字假设**:全库浮层文字 hardcode white 系、`.dark` 写死于 index.html(产品无亮态),实底必须维持深底;`#1c1c1e` 对齐 iOS 暗面材质惯例,比旧 zinc·60 的有效底色略深、与面板内 `bg-white/[0.04]` 卡片及 `border-white/10` 分隔的层级语汇兼容。亮分支取 `#f2f2f7` 仅为 ADR-0012 既定的主题化留量,真启用亮色主题时浮层文字须同步翻深。
2. **`backdrop-filter: none` 是实底化的必然推论**:不透明底下模糊不可见,留着纯烧 GPU;顺带令 pop-in/pop-out「只动 transform 不动 opacity」的核心理由(opacity 瞬态切断 backdrop 采样)在本档面板上失效化——动画语汇不变(与遮罩 fade 的分工已成惯例),但该坑对本档不再构成约束。子元素自身的 backdrop-filter(如抽屉 sticky 头)blur 的是面板内滚过内容,不受影响。
3. **补挂而非新建类**:分组弹层、toast 们此前裸 `glass-panel` 是「短文案浮层」的偶然缺标,补挂 `readable` 即归入同一语义;不新建第三档——「浮层实底、控件玻璃」二分已覆盖需求,材质档位不增殖。
4. **边界(仍是玻璃、不动)**:`glass-soft` 图标底板、`page-panel` 页板、`lens-panel` 折射 chrome、顶部胶囊 / 走马灯翻页钮 / 编辑模式小圆钮(控件非阅读面)、LoginPage 登录卡(页面主体非浮层)。

**代价与取舍。** 换来:浮层文字对比不再随壁纸明暗漂移,长文阅读稳定性一次到位;GPU 少一层全屏 blur;「可读性」轴从「垫底加码」的调参循环收口为布尔语义。付出:L1 主力档在文本浮层上的玻璃质感退场(iOS 浮层同样以实底为主,玻璃保留在 chrome 层),`.glass-panel-readable` 名字中「readable 垫底」的历史语义变为「实底浮层」(类名不改——十处消费方零改动压过改名收益)。
