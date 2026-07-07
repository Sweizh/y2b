# Web Interface Guidelines 合规审查报告

**审查对象:**
- `/workspace/public/console.html` (2753 行)
- `/workspace/public/login.html` (672 行)

**审查规则来源:** https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md

**审查日期:** 2026-07-07

---

## 一、可访问性 (Accessibility)

### 1.1 缺少 `<h1>` 主标题 / 缺少 skip link

- `console.html:516` — 第一个标题直接是 `<h2>账号凭证</h2>`,全页无 `<h1>`。页面缺少主标题层级。
- `console.html:417` / `login.html:316` — 两个页面均无 "跳到主内容" 的 skip link,键盘用户需 Tab 过整个 sidebar 才能到主区。

**建议:** 在 `<main>` 起始处增加 `<a href="#main-content" class="sr-only focus:not-sr-only">跳到主内容</a>`,并在 console 顶部加 `<h1 class="sr-only">YT2BILI 控制台</h1>`。

### 1.2 Label 未与 input 关联(无 `for`/`id` 或包裹)

login.html:
- `login.html:360` — `<label>密码</label>` 未关联 line 365 的 input(无 `for`/`id`)
- `login.html:375` — `<label>确认密码</label>` 未关联 line 380 的 input

console.html(全部缺失 `for`/`id` 关联):
- `console.html:533` 管理密码 / `console.html:541` B站 SESSDATA / `console.html:550` B站 bili_jct / `console.html:559` B站 buvid3 / `console.html:568` B站 ac_time_value
- `console.html:584` YouTube OAuth Client ID / `console.html:588` Client Secret / `console.html:592` Redirect URI
- `console.html:600` YouTube API Key / `console.html:609` YouTube Cookie / `console.html:618` GitHub Token / `console.html:627` GitHub 仓库
- `console.html:653` 语音识别 API 地址 / `console.html:662` 语音识别 API 密钥 / `console.html:671` 翻译 API 地址 / `console.html:680` 翻译 API 密钥 / `console.html:689` 标题翻译模板
- `console.html:810` 失败通知开关 label / `console.html:822` Webhook URL input(完全无 label)
- `console.html:1810` B站合集 / `console.html:1814` 投稿分区 / `console.html:1818` 默认标签 / `console.html:1822` 投稿类型 / `console.html:1826` 字幕模式(动态渲染)
- `console.html:2520` 弹窗内 pasteLabel(无 `for`)
- `console.html:2657` makeField 函数生成的 label(无 `for`)

**建议:** 给每个 input/select/textarea 加 `id`,label 加 `for="对应id"`。

### 1.3 完全缺少 label 的表单控件

- `console.html:711` — 频道搜索 input,无 label、无 aria-label、无 placeholder 示例
- `console.html:822` — Webhook URL input,仅有 placeholder,无 label
- `console.html:839` — 手动添加视频 textarea,无 label
- `console.html:841` — 频道 select,无 label
- `console.html:844` — 合集 select,无 label

### 1.4 图标按钮缺少 `aria-label`

- `console.html:1003` — `closeIcon.innerHTML='&times;'` 关闭按钮,无 `aria-label`
- `console.html:1576` / `console.html:1589` / `console.html:1603` — 搜索结果清除按钮 `×`,无 `aria-label`

### 1.5 装饰性图标未加 `aria-hidden="true"`

所有 `<i data-lucide="...">` 标签均未设 `aria-hidden="true"`,屏幕阅读器会朗读无关内容:
- `login.html:364`、`login.html:368`、`login.html:379`、`login.html:383`
- `console.html:465`、`console.html:469`、`console.html:473`、`console.html:477`、`console.html:481`、`console.html:493`、`console.html:501`

### 1.6 `<div onClick>` 应使用 `<button>`

- `console.html:1831` — 启用自动投稿开关用 `<div data-toggle-channel>` + click,无 `role`/`tabindex`/`onKeyDown`,键盘用户无法操作
- `console.html:2172` — `notifySwitchWrap` div 绑定 click 切换开关,同样不可键盘访问
- `console.html:816-818` — 失败通知 toggle 视觉容器,与 2172 配合,本质是 div 模拟开关

**建议:** 改用 `<button role="switch" aria-checked="...">` 或原生 `<input type="checkbox">` + label。

### 1.7 异步更新缺少 `aria-live`

- `console.html:923` — toast-container 无 `aria-live="polite"`,新 toast 不会被屏幕阅读器播报
- `login.html:434` — 同上
- `console.html:525` — bili-login-status 文本动态变化,无 `aria-live`
- `console.html:579` — yt-login-status 同上
- `console.html:757` — data-cookie-hint 失效提示动态显示,无 `aria-live`
- `console.html:1251` / `console.html:1262` — 已登录状态动态文本

### 1.8 图片缺少 `alt` 与尺寸属性

- `console.html:1618` — `<img src="'+escapeHtml(ch.avatar)+'">` 无 `alt`、无 `width`/`height` 属性、无 `loading="lazy"`(仅有内联 style 宽高)
- `console.html:2393` — 二维码 `<img>` 无 `alt`、无 `width`/`height` 属性

### 1.9 section 锚点缺少 `scroll-margin-top`

- `console.html:514` / `console.html:643` / `console.html:703` / `console.html:732` / `console.html:831` — 各 `<section id="section-...">` 锚点目标未设 `scroll-margin-top`,平滑滚动(`console.html:1181`)后顶部内容可能贴边或被遮挡。

---

## 二、焦点状态 (Focus States)

### 2.1 大量按钮/链接缺少 `:focus-visible` 样式

`.btn:focus-visible` 仅作用于带 `.btn` class 的按钮,而页内绝大多数按钮使用内联 style 而非 `.btn` class,导致它们没有可见焦点环:

- `console.html:522` 修改密码按钮 / `console.html:524` 弹窗登录 B 站 / `console.html:578` OAuth 登录 YouTube / `console.html:580` OAuth 配置 toggle
- `console.html:544`、`console.html:553`、`console.html:562`、`console.html:571`、`console.html:603`、`console.html:612`、`console.html:621` 各 "测试" 按钮
- `console.html:636`、`console.html:696`、`console.html:712`、`console.html:725`、`console.html:761`、`console.html:823`、`console.html:847` 各主要操作按钮
- `console.html:500` mobile-menu-btn(无 focus 样式)
- 所有 modal 内动态创建的按钮(`console.html:974` cancelBtn、`console.html:977` okBtn、`console.html:1003` closeIcon、`console.html:2402` refreshBtn、`console.html:2405` closeBtn、`console.html:2529` saveBtn、`console.html:2532` closeBtn、`console.html:2671` cancelBtn、`console.html:2674` submitBtn)

### 2.2 `.control` 使用 `outline:0` 但仅靠父级 `:focus-within`

- `console.html:268`、`console.html:339` — `.control{...outline:0;...}`,焦点环依赖外层 `.field:focus-within`。但 login.html 的 password input 在 `.field` 内,而 console 中 `console.html:543`、`console.html:552` 等大量 input **不在 `.field` 容器内**,直接使用内联样式,因此 `outline:0` 不适用但也没有任何焦点指示——这些 input 实际上既无 `:focus` 也无 `:focus-visible` 样式,完全无焦点反馈。

---

## 三、表单 (Forms)

### 3.1 Input 缺少 `autocomplete` 与 `name`

- `login.html:365`、`login.html:380` — 已设 `autocomplete="new-password"` ✓,但缺 `name` 属性
- console.html 全部 input/select 均无 `autocomplete` 也无 `name`:
  - `console.html:543`、`console.html:552`、`console.html:561`、`console.html:570`(密码型字段未设 `autocomplete="off"` 或 `current-password`)
  - `console.html:585`、`console.html:589`、`console.html:593`、`console.html:602`、`console.html:611`、`console.html:620`、`console.html:629`、`console.html:655`、`console.html:664`、`console.html:673`、`console.html:682`、`console.html:690`
  - `console.html:711` 搜索 input / `console.html:822` Webhook URL / `console.html:839` textarea / `console.html:841`、`console.html:844` select / `console.html:1819`、`console.html:1811`、`console.html:1815`、`console.html:1827` 动态渲染的控件

**建议:** token/key 类字段加 `autocomplete="off" name="<field_key>" spellcheck="false"`;Webhook URL 加 `type="url"`。

### 3.2 错误类型 / inputmode / type 错误

- `console.html:711` — 频道搜索 input 应使用 `type="search"`(并 `inputmode="search"`)
- `console.html:822` — Webhook URL 应使用 `type="url"` 并 `inputmode="url"`,可触发移动端键盘优化
- `console.html:593` — Redirect URI 应使用 `type="url"`
- `console.html:585`、`console.html:629`、`console.html:655`、`console.html:673`、`console.html:689`、`console.html:690` — 含 ID/路径/URL 的字段未设 `spellcheck="false"`,移动端可能划红线

### 3.3 未使用 `<form>` 语义

- `login.html:341`-`406` — 表单字段未包裹在 `<form>` 中,Enter 提交需 JS 监听(`login.html:591`),丢失原生 form validation 与密码管理器集成
- `console.html:514`-`638` / `console.html:643`-`698` / `console.html:831`-`857` — 同样未使用 `<form>`

### 3.4 错误提示用 Toast 而非内联字段错误

- `login.html:547`、`login.html:549`、`login.html:550` — 密码校验失败用 `showToast`,应在字段下方内联显示并 focus 第一个错误字段(目前仅 `passwordInput.focus()` 一次,未在 confirm 字段错误时 focus confirm)
- `console.html:2184` — Webhook URL 校验失败用 toast,无内联错误
- `console.html:2694`-`2696` — 修改密码校验失败用 toast,无内联错误

### 3.5 Placeholder 未以 `…` 结尾且无示例模式

- `login.html:365` "输入管理密码" → 应 "输入管理密码…"
- `login.html:380` "再次输入密码" → "再次输入密码…"
- `console.html:543`、`console.html:552`、`console.html:561`、`console.html:570`、`console.html:585`、`console.html:589`、`console.html:593`、`console.html:602`、`console.html:611`、`console.html:620`、`console.html:655`、`console.html:664`、`console.html:673`、`console.html:682` — "未设置" 应为 "未设置…" 或显示示例
- `console.html:711` "输入 YouTube 频道名称或 ID" → 加 `…`
- `console.html:822` 长 URL 占位 → 加 `…`
- `console.html:839` textarea 占位 → 加 `…`
- `console.html:2524` "粘贴此处(形如 ...)" → 加 `…`

### 3.6 未提示未保存变更警告

- `console.html:1313`-`1431` setupSave 实现了脏值检测并禁用保存按钮,但用户在已修改未保存时导航离开(刷新/关闭)无 `beforeunload` 警告
- `console.html:711`-`713` 频道搜索、`console.html:839`-`848` 手动添加同样如此

---

## 四、动画 (Animation)

### 4.1 未遵守 `prefers-reduced-motion`

- `console.html:864`-`883` — 移动端 sidebar `transition: transform 0.2s ease` 无 reduced-motion 兜底
- `console.html:2750`-`2751` — `@keyframes toast-in`、`@keyframes modal-fade` 无 `@media (prefers-reduced-motion: reduce)` 降级
- `login.html:666`-`669` — `@keyframes toast-in` 同上
- 各按钮 `transition: background-color .18s ease, color .18s ease...`(`console.html:271`、`console.html:347` 等)未提供 reduced 变体

**建议:** 增加
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### 4.2 未使用 `transition: all` ✓(无违规)

### 4.3 卡片 hover 动画 `box-shadow` 非 compositor-friendly(轻微)

- `console.html:271`、`console.html:299` — `.card:hover{transform:translateY(-2px);box-shadow:...}`,box-shadow 动画触发重绘。轻微,可接受但非最佳。

---

## 五、排版 (Typography)

### 5.1 `...` 应为 `…`

- `login.html:337` — "加载中..." → "加载中…"
- `console.html:2574` — `saveBtn.textContent='保存中...'` → "保存中…"
- `console.html:2575` — `statusP.textContent='正在保存...'` → "正在保存…"

### 5.2 中文标点一致性(直角问号 vs 全角)

- `console.html:1882` — "确认删除?" 用半角 `?`,应 "确认删除?"
- `console.html:2124` — "确认删除?" 同上
- `console.html:2342` — "确认从队列删除「…」？" 用全角 `？` ✓(不一致)

### 5.3 数字列缺少 `font-variant-numeric: tabular-nums`

- `console.html:742`、`console.html:746` — 上次运行 / 累计处理 stats 数字使用 `font-mono`,可加 `tabular-nums` 防止数字宽度抖动
- `console.html:2074`、`console.html:2112` — 处理记录时间列同上(虽 mono 字体通常已等宽,显式声明更稳妥)

### 5.4 标题缺少 `text-wrap: balance`

- `console.html:516`、`console.html:645`、`console.html:705`、`console.html:734`、`console.html:833` 各 `<h2>` 无 `text-wrap: balance`(login.html:325 的 h1 已设 ✓)

---

## 六、内容处理 (Content Handling)

### 6.1 数字 stat 卡片可能溢出

- `console.html:742`、`console.html:746` — stats 文本仅 `whitespace-nowrap`,当累计处理数极大(如 999999)或时间字符串长时可能撑破 grid。建议加 `truncate` 或 `min-w-0`。

### 6.2 空状态处理 ✓(通过)

- `console.html:1734` "暂无关注的频道"、`console.html:2061` "暂无处理记录"、`console.html:2096` "暂无已处理视频"、`console.html:2323` "暂无待处理视频"、`console.html:1609` "未找到匹配的频道" 均已处理。

---

## 七、图片 (Images)

### 7.1 `<img>` 缺少显式 width/height 属性(CLS)

- `console.html:1618` — avatar img 仅有 style 宽高,无 `width`/`height` 属性,浏览器加载前无法预留空间 → CLS
- `console.html:2393` — 二维码 img 同上

**建议:** `<img src="..." width="48" height="48" ...>` / `<img src="..." width="220" height="220" ...>`。

### 7.2 非首屏图片未懒加载

- `console.html:1618` — 频道头像(列表项)非首屏,应 `loading="lazy"`

---

## 八、性能 (Performance)

### 8.1 大列表未虚拟化

- `console.html:2063`-`2077` — 处理记录 `records.forEach` 渲染所有行,无分页/虚拟化
- `console.html:2100`-`2114` — 已处理视频列表同上
- `console.html:2326`-`2358` — 手动队列列表同上
- `console.html:1612`-`1633` — 频道搜索结果同上

**建议:** 列表 > 50 项时使用 `content-visibility: auto` 或虚拟滚动,并加分页。

### 8.2 CDN 域名未 `preconnect`

- `console.html:371` — `https://cdn.jsdelivr.net` 无 `<link rel="preconnect">`
- `console.html:372` — `https://unpkg.com` 同上
- `login.html:270`、`login.html:271` — 同上

**建议:** `<head>` 内加
```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="preconnect" href="https://unpkg.com" crossorigin>
```

### 8.3 字体未 preload 也未声明 `@font-face`

- `console.html:177`、`console.html:179` — `--font-sans: DM Sans, ...`、`--font-mono: JetBrains Mono, ...`,但全文件无 `@font-face` 声明也无 `<link rel="preload" as="font">`,DM Sans / JetBrains Mono 实际不会加载,退化为系统字体。
- `login.html:177`、`login.html:179` — 同上

**建议:** 要么通过 Google Fonts CDN 引入并 `font-display: swap`,要么删除自定义字体名直接用 system-ui。

### 8.4 Tailwind CDN 与 lucide 在 head 阻塞渲染

- `console.html:371`、`console.html:372` — 同步 `<script src=...>` 在 `<head>` 中,阻塞首屏。Tailwind browser 版会编译 CSS,建议加 `defer` 或挪到 body 末(注意 lucide 依赖顺序)。

---

## 九、导航与状态 (Navigation & State)

### 9.1 OAuth 配置展开状态未同步 URL

- `console.html:582` — `yt-oauth-config-wrap` 折叠/展开仅 setState 在 JS 内存,刷新后丢失。应同步到 URL query(`?oauth-config=open`)或 hash。

### 9.2 破坏性操作已确认 ✓(通过)

- 删除频道(`console.html:1880`)、删除已处理视频(`console.html:2122`)、删除队列项(`console.html:2340`)、退出登录(`console.html:1190`)均使用 showModal 二次确认。

---

## 十、触控与交互 (Touch & Interaction)

### 10.1 未设 `touch-action: manipulation`

- 所有按钮/链接未设 `touch-action: manipulation`,移动端有 300ms 双击缩放延迟(现代浏览器部分缓解但仍推荐显式声明)。

### 10.2 未设 `-webkit-tap-highlight-color`

- `console.html:417`、`login.html:316` — body 未设 `-webkit-tap-highlight-color: transparent`,移动端点击有默认蓝色高亮。

### 10.3 Modal 缺少 `overscroll-behavior: contain`

- `console.html:961`、`console.html:994`、`console.html:2386`、`console.html:2494`、`console.html:2646` 以及 login.html:601 — modal overlay 未设 `overscroll-behavior: contain`,模态内滚动到底会带动背景滚动。

### 10.4 mobile-menu-btn 在小屏仅 `display:flex` 切换,无 `inert` 管理

- `console.html:500` — 桌面端 `hidden` 但仍可 Tab 到达。当 sidebar 在桌面常驻时,hamburger 按钮 hidden 后应加 `inert` 或 `tabindex="-1"` 避免被 Tab。

---

## 十一、暗色模式与主题 (Dark Mode & Theming)

### 11.1 缺少 `color-scheme: dark`

- `console.html:2` — `<html class="dark">` 但无 `color-scheme: dark` CSS 属性。导致滚动条、原生 input/select 在暗色下仍用浅色主题。
- `login.html:2` — 同上

**建议:** `<html style="color-scheme: dark">` 或 `:root.dark { color-scheme: dark; } :root:not(.dark) { color-scheme: light; }`。

### 11.2 缺少 `<meta name="theme-color">`

- `console.html:5` / `login.html:5` — viewport meta 后无 `<meta name="theme-color" content="#000000">`,移动端浏览器顶栏不会跟随页面背景色。

---

## 十二、本地化与 i18n (Locale & i18n)

### 12.1 硬编码日期格式(应使用 `Intl.DateTimeFormat`)

- `console.html:1250` — `biliDt.getFullYear()+'-'+...+':'+...` 手拼 `YYYY-MM-DD HH:mm`
- `console.html:2008` — `dt.getFullYear()+'-'+...` 同上(last_run_at)
- `console.html:2070` — 处理记录时间同上
- `console.html:2104` — 已处理视频时间同上

**建议:** `new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(dt)`。

### 12.2 品牌/代码标识未设 `translate="no"`

- `console.html:459` — "YT2BILI" 品牌名无 `translate="no"`,浏览器自动翻译会乱码
- `login.html:327` — 同上
- `console.html:541`、`console.html:550`、`console.html:559`、`console.html:568` — "SESSDATA"、"bili_jct"、"buvid3"、"ac_time_value" 等代码 token 在 label 文本中,无 `translate="no"`
- `console.html:620`、`console.html:627` — "GitHub Token"、"GitHub 仓库"

**建议:** 将品牌名与代码 token 包裹 `<span translate="no">SESSDATA</span>`。

---

## 十三、安全 (Security)

### 13.1 缺少 CSP

- `console.html` / `login.html` — 无 `<meta http-equiv="Content-Security-Policy">`,无法防御 XSS 注入。结合下方 13.2 风险更显重要。

### 13.2 OAuth 回调 innerHTML 存在 XSS 风险(高危)

- `console.html:443` —
  ```js
  document.body.innerHTML='<div ...>'+
    (result.success?'登录成功':'登录失败')+'</p>'+
    '<p ...>'+(result.error||result.email||'')+'</p>'+...
  ```
  `result.email`、`result.error` 来源于 `window.location.hash` 参数(`console.html:427`-`430`),未转义直接拼接到 innerHTML。攻击者构造 `#youtube-oauth-success&email=<img src=x onerror=alert(1)>` 即可执行任意 JS。

**建议:** 使用 `textContent` 或先 `escapeHtml()` 再拼接,或用 DOM API 创建节点。

### 13.3 showHelp 的 innerHTML 使用硬编码内容(可接受)

- `console.html:1010` — `body.innerHTML=html`,`html` 来自 `helpTexts`(`console.html:1029`-`1044`)硬编码字符串,非用户输入。可接受,但若未来扩展需注意。

### 13.4 inline event handler(`onerror`/`onmouseover`)

- `console.html:1618` — `<img ... onerror="this.style.display='none'"/>` 内联事件,违反 CSP `unsafe-inline` 限制
- `console.html:1625`、`console.html:1802` — `onmouseover="..." onmouseout="..."` 内联事件
- `console.html:443` — `<a href="javascript:void(0)" onclick="try{window.close()}catch(e){}">` 内联

**建议:** 改用 `addEventListener` 绑定。

---

## 十四、悬停与交互状态 (Hover & Interactive States)

### 14.1 大量按钮缺少 `:hover` 状态

- `console.html:522` 修改密码 / `console.html:524` 弹窗登录 B 站 / `console.html:544`-`571` 测试按钮 / `console.html:578` OAuth 登录 / `console.html:636`、`console.html:696` 保存 / `console.html:712` 搜索 / `console.html:725` 保存频道配置 / `console.html:761` 立即执行 / `console.html:823` 通知保存 / `console.html:847` 添加到队列
- 所有 modal 内动态按钮(cancelBtn/okBtn/closeIcon/refreshBtn 等)

这些按钮仅用内联 style,无 `:hover` class,CSS 也未对 `button:hover` 做通用规则。

### 14.2 nav 链接缺少 hover 反馈

- `console.html:464`-`483` — sidebar nav `<a>` 仅 `transition-colors`,无 `:hover` 背景变化(仅 active 高亮)。可加 `hover:bg-apple-secondary`。

---

## 十五、内容与文案 (Content & Copy)

### 15.1 错误信息仅描述问题,缺少下一步

- `login.html:585` — "网络错误:"+msg,未提示重试或检查网络
- `console.html:1425` — "网络错误："+msg 同上
- `console.html:552`、`console.html:1465` 等 "测试失败" 信息同上
- `console.html:2856`/`console.html:2256` — "添加失败" 同上

**建议:** 改为 "网络错误:...,请检查网络后重试" 或附重试按钮。

### 15.2 按钮文案不够具体

- `console.html:636` — "保存"(账号凭证区)可改 "保存账号凭证"
- `console.html:696` — "保存"(AI 服务区)可改 "保存 AI 配置"
- 多处 "测试" 按钮可改 "测试 SESSDATA"、"测试 GitHub Token" 等(虽然 label 旁边有字段名,但按钮本身不够具体)

### 15.3 第一人称/第二人称

- 文案基本为指令式,可接受。

---

## 十六、反模式汇总 (Anti-patterns)

| 反模式 | 位置 |
|---|---|
| `<div onClick>` 替代 `<button>` | `console.html:1831`、`console.html:2172` |
| 图标按钮无 `aria-label` | `console.html:1003`、`console.html:1576`、`console.html:1589`、`console.html:1603` |
| 表单 input 无 label | `console.html:711`、`console.html:822`、`console.html:839`、`console.html:841`、`console.html:844` |
| 图片无尺寸属性 | `console.html:1618`、`console.html:2393` |
| 大数组无虚拟化 `.map()` | `console.html:1612`、`console.html:2063`、`console.html:2100`、`console.html:2326` |
| 硬编码日期格式 | `console.html:1250`、`console.html:2008`、`console.html:2070`、`console.html:2104` |
| `outline:0`/无 focus 替代 | console.html 大量内联 style 按钮与直接 input |
| 内联 `onclick`/`onmouseover`/`onerror` | `console.html:443`、`console.html:1618`、`console.html:1625`、`console.html:1802` |
| `javascript:void(0)` 链接 | `console.html:443` |
| Modal 无 `overscroll-behavior` | `console.html:961`、`console.html:994`、`console.html:2386`、`console.html:2494`、`console.html:2646`、`login.html:601` |

未发现以下反模式 ✓:
- `user-scalable=no` / `maximum-scale=1`
- `onPaste` + `preventDefault`
- `transition: all`
- `autoFocus` 滥用

---

## 优先级排序

### 🔴 必修复(安全与可访问性阻断)

1. **`console.html:443` XSS 漏洞** — OAuth 回调参数未转义直接拼 innerHTML,可执行任意代码
2. **`console.html:2` / `login.html:2` 缺少 `color-scheme: dark`** — 暗色下原生控件异常
3. **大量 input 无 label 关联**(`console.html:533`-`690`、`login.html:360`-`380`)— 屏幕阅读器无法识别字段
4. **`<div onClick>` 模拟开关**(`console.html:1831`、`console.html:2172`)— 键盘用户完全无法操作
5. **`console.html:711`、`console.html:822`、`console.html:839`、`console.html:841`、`console.html:844` 完全无 label** — 不可访问
6. **图标按钮无 `aria-label`**(`console.html:1003`、`console.html:1576`、`console.html:1589`、`console.html:1603`)
7. **未加 CSP** — 结合 XSS 风险,建议加 `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' cdn.jsdelivr.net unpkg.com; ...">`

### 🟡 建议(可用性与一致性)

1. **大量按钮无 `:focus-visible` 与 `:hover` 样式** — 键书用户无焦点反馈,鼠标用户无悬停反馈
2. **未遵守 `prefers-reduced-motion`** — 影响前庭功能敏感用户
3. **图片无 width/height 属性** — CLS 风险
4. **CDN 未 preconnect / 字体未 preload** — 首屏性能
5. **硬编码日期格式** — i18n 兼容性
6. **大列表无虚拟化** — 数据量大时卡顿
7. **品牌/代码 token 未 `translate="no"`** — 自动翻译乱码
8. **Modal 缺 `overscroll-behavior: contain`** — 滚动穿透
9. **`...` → `…`** — 一致性
10. **placeholder 应以 `…` 结尾并含示例**
11. **input 缺 `autocomplete`/`name`/`spellcheck`**
12. **toast/状态文本缺 `aria-live="polite"`**
13. **错误用 toast 而非内联**
14. **未保存变更无 `beforeunload` 警告**
15. **缺少 `<h1>` 与 skip link**
16. **装饰图标未 `aria-hidden`**
17. **Webhook URL input 应 `type="url"`,搜索 input 应 `type="search"`**

### 🟢 可选(打磨与优化)

1. **数字列加 `font-variant-numeric: tabular-nums`**
2. **标题加 `text-wrap: balance`**
3. **按钮文案更具体("保存" → "保存账号凭证")**
4. **错误信息附下一步("网络错误,请检查后重试")**
5. **`<meta name="theme-color">`**
6. **`touch-action: manipulation` / `-webkit-tap-highlight-color`**
7. **safe-area-inset 适配**
8. **section 锚点 `scroll-margin-top`**
9. **OAuth 配置展开状态同步 URL**
10. **card hover 动画避免 `box-shadow`**

---

## 关键发现摘要

**最严重风险为 `console.html:443` 的 XSS 漏洞**:OAuth 回调页面直接将 `window.location.hash` 中的 `email`/`error` 参数拼接进 `document.body.innerHTML`,未做 HTML 转义。攻击者构造恶意链接即可在受害者浏览器执行任意脚本(窃取 cookie、伪造操作),建议立即用 `escapeHtml()` 或 DOM API 重写。

**可访问性是系统性短板**:两个文件存在大量 label 未关联 input(或完全无 label)、图标按钮无 `aria-label`、`<div onClick>` 替代 `<button>`(导致键盘不可达)、modal 与 toast 缺 `aria-live`、装饰图标未 `aria-hidden` 等问题。同时缺少 `<h1>` 主标题与 skip link,焦点环覆盖严重不足——除 `.btn` class 的按钮外,几乎所有内联 style 按钮与直接 input 都没有 `:focus-visible`/`:hover` 样式,键盘与鼠标用户均缺乏反馈。

**性能与一致性方面**:DM Sans / JetBrains Mono 字体在 CSS 中声明但全文无 `@font-face` 也无 preload,实际不会加载;CDN(tailwind、lucide)未 preconnect 且在 head 同步加载阻塞首屏;处理记录/已处理视频/频道列表均无虚拟化或分页,数据量大时会卡顿;四处日期手拼 `YYYY-MM-DD HH:mm` 未使用 `Intl.DateTimeFormat`;动画/过渡全无 `prefers-reduced-motion` 兜底。这些虽不阻断使用,但显著影响专业度与可维护性,建议分批治理。
