# 新标签页接管:薄重定向扩展(不打包前端)

仓库新增 Chrome 扩展(根目录 `extension/`,纯静态文件、无构建、开发者模式 load unpacked),唯一职责:接管浏览器新标签页(`chrome_url_overrides`)并把它 `location.replace` 到「目标页 URL」。**刻意不把前端打包进扩展**——前端全部 API 走同源相对路径 `/api/...`(dev 靠 Vite proxy 转 `localhost:8082`、prod 靠 Caddy 反代,`credentials: 'include'`),一旦页面 origin 从部署域名换成 `chrome-extension://`,同源假设即刻断裂:要改绝对 URL + 后端开 CORS + cookie `SameSite`/`Secure` 全套跟着动,并牵连 ADR-0006 双端镜像与登录态。薄重定向对现有代码零侵入,页面更新与扩展完全解耦。

「目标页 URL」运行时可配:工具栏 popup 表单存 `chrome.storage.local`,出厂默认 `http://localhost:5173`(当前本地开发形态),将来发布到远程域名后改一次配置即可——本地开发与远程部署只是同一配置的两个取值,扩展不感知"环境"概念。popup 保存时校验仅允许 `http/https` scheme(信任边界输入校验,防 `javascript:` 等注入),防的是扩展页面上下文被导航到可执行脚本的 URL。用 `location.replace` 而非 `location.href`:中间重定向页不入历史,从目标页按返回键回到的是打开新标签页之前的页面。

**备选否决:**

- **否决「打包前端构建产物进扩展」**:见上,origin 断裂是根本性障碍;且页面每次改动都要重新构建 + 手动重载扩展,更新耦合。省掉一次跳转闪烁换不来这些。
- **否决「URL 写死为常量」」**:dev→远程迁移就得动代码重载;运行时可配 + 出厂默认让迁移 = 在 popup 里改一次值。
- **否决「`chrome.storage.sync`」**:走 Google 同步链路,国内网络不可靠;个人单机使用,`local` 足够。
- **否决「服务不可达兜底」**(先探测再跳/自绘友好错误页):基础设施不替网页操心可用性,浏览器原生 `ERR_CONNECTION_REFUSED` 错误页自带重试按钮;加兜底的代码量会数倍于扩展本体,方向反了。
- **否决「上 Chrome Web Store」**:个人使用,load unpacked 即终态,不引入开发者账号、$5、审核与打包流程。
- **Edge 场景不需要本扩展**:Edge 原生支持把新标签页设为自定义 URL;Chrome 砍掉了这个能力,这正是扩展存在的唯一理由(也是"这东西需要存在吗"检查的结论)。
