// YouTube OAuth 2.0 登录路由
// 参考: https://developers.google.com/identity/protocols/oauth2/web-server
//
// 流程:
//   1. 管理员在 Google Cloud Console 创建 OAuth 2.0 客户端(Web application)
//   2. 在 Authorized redirect URIs 中加入 <Worker URL>/api/youtube/oauth/callback
//   3. 在控制台「YouTube OAuth 配置」区填入 client_id / client_secret / redirect_uri
//   4. 点击「OAuth 登录 YouTube」→ 弹窗跳转 Google → 授权 → 回调交换 token
//   5. 用 access_token 调 YouTube Data API(替代 yt_api_key)
//   6. 通过认证请求铸造 SAPISID cookie(供 yt-dlp 下载高清视频用),存入 yt_cookies
//
// 端点:
//   - GET  /start    — 跳转 Google 授权页(公开,用 state 关联会话)
//   - GET  /callback — 接收授权码,交换 token,铸造 cookie(公开)
//   - POST /refresh  — Runner 用 refresh_token 刷新 access_token(需 Pipeline Token)

import { Hono } from 'hono';
import { getRawConfig, putConfig } from '../kv';
import { getSessionFromRequest, getSession } from '../auth';

const app = new Hono<{ Bindings: Env }>();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// 用 access_token 调 YouTube 首页,捕获 Set-Cookie 中的 SAPISID 等 cookie
// 这两个端点任一返回都会带 Set-Cookie
const YT_ACCOUNTS_LIST_URL = 'https://www.youtube.com/youtubei/v1/account/accounts_list';
const YT_BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.readonly',
  'openid',
  'email',
  'profile',
].join(' ');

// state 在 KV 中的 TTL(秒)
const OAUTH_STATE_TTL = 600;

function log(event: string, status: string, extra: Record<string, any> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, status, ...extra }));
}

function getRequestId(c: any): string {
  return c.req.header('x-request-id') || crypto.randomUUID();
}

// 起始页:重定向到 Google 授权(SEC-02: 需登录,index.ts 鉴权中间件已校验 Session)
app.get('/start', async (c) => {
  const requestId = getRequestId(c);
  // SEC-02: 把当前 sessionId 绑定到 state,/callback 凭 state 反查发起方是否已登录
  const sessionId = getSessionFromRequest(c.req.raw);
  if (!sessionId) {
    return c.json({ error: '未登录,无法发起 OAuth' }, 401);
  }
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.yt_client_id || !cfg.yt_client_secret || !cfg.yt_redirect_uri) {
    return c.json({ error: '请先在配置中填写 yt_client_id / yt_client_secret / yt_redirect_uri' }, 400);
  }
  // 生成 state,值存 sessionId(TTL 10 分钟,单次使用)
  // /callback 是 Google 跨站重定向,SameSite=Strict Cookie 不发送,但可凭 state 反查到发起方 session
  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await c.env.YT2BILI_KV.put(`oauth_state:${state}`, sessionId, { expirationTtl: OAUTH_STATE_TTL });

  const params = new URLSearchParams({
    client_id: cfg.yt_client_id,
    redirect_uri: cfg.yt_redirect_uri,
    response_type: 'code',
    scope: SCOPES,
    state,
    access_type: 'offline',  // 拿 refresh_token
    prompt: 'consent',       // 强制重新授权(确保每次都能拿 refresh_token)
  });
  const redirectUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
  log('yt_oauth_start', 'redirect', { requestId, state });
  return c.redirect(redirectUrl);
});

// 回调:接收 code,交换 token,铸造 cookie,重定向回控制台
app.get('/callback', async (c) => {
  const requestId = getRequestId(c);
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorParam = c.req.query('error');

  if (errorParam) {
    log('yt_oauth_callback', 'denied', { requestId, error: errorParam });
    return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('用户拒绝授权: ' + errorParam)}`);
  }
  if (!code || !state) {
    return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('回调缺少 code 或 state')}`);
  }

  // 校验 state(单次使用,校验后立即删除)
  const stateKey = `oauth_state:${state}`;
  const stateVal = await c.env.YT2BILI_KV.get(stateKey);
  if (!stateVal) {
    log('yt_oauth_callback', 'invalid_state', { requestId });
    return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('state 无效或已过期,请重新登录')}`);
  }
  await c.env.YT2BILI_KV.delete(stateKey);
  // SEC-02: 校验 state 绑定的 session 仍有效,确保 OAuth 由已登录管理员发起(防凭证替换)
  const sessionOk = await getSession(c.env.YT2BILI_KV, stateVal);
  if (!sessionOk) {
    log('yt_oauth_callback', 'session_invalid', { requestId });
    return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('发起 OAuth 的会话已失效,请重新登录')}`);
  }

  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.yt_client_id || !cfg.yt_client_secret || !cfg.yt_redirect_uri) {
    return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('OAuth 客户端配置丢失')}`);
  }

  // 交换 code → tokens
  let tokenResp: any;
  try {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.yt_client_id,
        client_secret: cfg.yt_client_secret,
        redirect_uri: cfg.yt_redirect_uri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    tokenResp = await r.json();
    if (tokenResp.error) {
      log('yt_oauth_callback', 'token_exchange_failed', { requestId, error: tokenResp.error });
      return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('交换 token 失败: ' + tokenResp.error)}`);
    }
  } catch (e: any) {
    log('yt_oauth_callback', 'token_exchange_error', { requestId, error: e.message });
    return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('请求 Google 失败: ' + e.message)}`);
  }

  const accessToken = tokenResp.access_token;
  const refreshToken = tokenResp.refresh_token;
  const expiresIn = tokenResp.expires_in || 3600;  // 秒
  const idToken = tokenResp.id_token;

  if (!accessToken || !refreshToken) {
    return c.redirect(`/console.html#youtube-oauth-failed&error=${encodeURIComponent('返回的 token 不完整(缺 access_token 或 refresh_token)')}`);
  }

  // 解码 id_token 取 email/name/picture
  let userEmail = '', userName = '', userAvatar = '';
  if (idToken) {
    try {
      const decoded = decodeJwt(idToken);
      userEmail = decoded.email || '';
      userName = decoded.name || '';
      userAvatar = decoded.picture || '';
    } catch (e) {
      log('yt_oauth_callback', 'id_token_decode_warning', { requestId, error: (e as Error).message });
    }
  }

  // 铸造 SAPISID cookie(供 yt-dlp 下载高清视频用)
  // 调 YouTube 认证端点,捕获 Set-Cookie 头中的 SAPISID/__Secure-3PAPISID/HSID 等
  let ytCookies = '';
  let cookieForgeStatus: 'success' | 'partial' | 'failed' = 'failed';
  let cookieForgeError = '';
  try {
    ytCookies = await forgeYtCookies(accessToken);
    cookieForgeStatus = ytCookies ? 'success' : 'partial';
    if (!ytCookies) {
      cookieForgeError = '调 YouTube 端点未返回 Set-Cookie(可能 access_token 权限不足或需要二次登录)';
    }
  } catch (e: any) {
    cookieForgeError = e.message || String(e);
    log('yt_oauth_callback', 'cookie_forge_failed', { requestId, error: cookieForgeError });
  }

  // 加密写入 KV
  const now = Date.now();
  await putConfig(c.env.YT2BILI_KV, {
    ...cfg,
    yt_access_token: accessToken,
    yt_refresh_token: refreshToken,
    yt_token_expires_at: now + expiresIn * 1000,
    yt_cookies: ytCookies || cfg.yt_cookies,  // 铸造失败时保留旧 cookies
    yt_user_email: userEmail,
    yt_user_name: userName,
    yt_user_avatar: userAvatar,
    yt_login_at: now,
  }, c.env.ENCRYPTION_KEY || '');

  log('yt_oauth_callback', 'success', {
    requestId,
    email: userEmail,
    cookie_forge: cookieForgeStatus,
  });

  // 重定向到控制台,带状态 hash
  if (cookieForgeStatus === 'success') {
    return c.redirect(`/console.html#youtube-oauth-success&email=${encodeURIComponent(userEmail)}`);
  } else {
    // Cookie 铸造失败但 OAuth 成功,前端提示用户手动补 yt_cookies
    return c.redirect(`/console.html#youtube-oauth-partial&email=${encodeURIComponent(userEmail)}&cookie_error=${encodeURIComponent(cookieForgeError)}`);
  }
});

// 刷新 access_token 的核心逻辑(供 pipeline 路由调用,自身不做鉴权)
// 由 /api/pipeline/yt-oauth-refresh 包装并加 Pipeline Token 鉴权
export async function refreshYouTubeAccessToken(
  kv: KVNamespace,
  encryptionKey: string,
  requestId: string,
): Promise<{ ok: boolean; access_token?: string; expires_at?: number; refreshed?: boolean; error?: string }> {
  const cfg = await getRawConfig(kv, encryptionKey);
  if (!cfg.yt_refresh_token || !cfg.yt_client_id || !cfg.yt_client_secret) {
    return { ok: false, error: '未配置 OAuth refresh_token 或 client 凭证' };
  }
  // 检查是否需要刷新(剩余有效期 > 5 分钟则直接返回当前 token)
  const now = Date.now();
  if (cfg.yt_token_expires_at && cfg.yt_token_expires_at - now > 5 * 60 * 1000) {
    return {
      ok: true,
      access_token: cfg.yt_access_token,
      expires_at: cfg.yt_token_expires_at,
      refreshed: false,
    };
  }
  // 调 Google 刷新
  try {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: cfg.yt_refresh_token,
        client_id: cfg.yt_client_id,
        client_secret: cfg.yt_client_secret,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data = await r.json() as any;
    if (data.error) {
      log('yt_oauth_refresh', 'failed', { requestId, error: data.error });
      return { ok: false, error: '刷新失败: ' + data.error };
    }
    const newExpiresAt = now + (data.expires_in || 3600) * 1000;
    await putConfig(kv, {
      ...cfg,
      yt_access_token: data.access_token,
      yt_token_expires_at: newExpiresAt,
    }, encryptionKey);
    log('yt_oauth_refresh', 'success', { requestId, expires_at: newExpiresAt });
    return {
      ok: true,
      access_token: data.access_token,
      expires_at: newExpiresAt,
      refreshed: true,
    };
  } catch (e: any) {
    log('yt_oauth_refresh', 'error', { requestId, error: e.message });
    return { ok: false, error: '请求 Google 失败: ' + e.message };
  }
}

// 解码 JWT(id_token)的 payload
// JWT 格式: header.payload.signature (base64url)
function decodeJwt(jwt: string): any {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payloadB64 = parts[1];
  // base64url → base64
  let b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  // 补齐 padding
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  const json = atob(b64);
  return JSON.parse(json);
}

// 用 access_token 调 YouTube 认证端点,捕获 Set-Cookie 铸造 cookies.txt
// 返回 Netscape cookies.txt 格式字符串(供 yt-dlp --cookies 使用)
async function forgeYtCookies(accessToken: string): Promise<string> {
  // 尝试 accounts_list 端点(优先),失败用 browse 兜底
  let setCookies: string[] = [];
  for (const url of [YT_ACCOUNTS_LIST_URL, YT_BROWSE_URL]) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://www.youtube.com',
          'Referer': 'https://www.youtube.com/',
        },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } } }),
      });
      // Workers 运行时支持 getSetCookie()(返回 string[])
      const cookies = (r.headers as any).getSetCookie?.() || [];
      if (cookies.length > 0) {
        setCookies = cookies;
        break;
      }
    } catch (e) {
      // 继续尝试下一个端点
    }
  }
  if (setCookies.length === 0) return '';

  // 解析 Set-Cookie 数组,过滤出对 yt-dlp 有用的 cookie
  // 关注: SAPISID, __Secure-3PAPISID, HSID, SSID, SID, APISID, LOGIN_INFO, VISITOR_INFO1_LIVE
  const usefulNames = new Set([
    'SAPISID', '__Secure-3PAPISID', 'HSID', 'SSID', 'SID', 'APISID',
    'LOGIN_INFO', 'VISITOR_INFO1_LIVE', 'PREF', 'SIDCC', '__Secure-3PSID',
  ]);
  const lines: string[] = ['# Netscape HTTP Cookie File', '# This file was generated by yt2bili Worker'];
  for (const sc of setCookies) {
    const parsed = parseSetCookie(sc);
    if (!parsed || !usefulNames.has(parsed.name)) continue;
    // Netscape 格式: domain \t include_subdomains(TRUE/FALSE) \t path \t secure(TRUE/FALSE) \t expiry \t name \t value
    const domain = parsed.domain || '.youtube.com';
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = parsed.secure ? 'TRUE' : 'FALSE';
    const expiry = parsed.expires || 0;
    lines.push([
      domain,
      includeSub,
      parsed.path || '/',
      secure,
      String(expiry),
      parsed.name,
      parsed.value,
    ].join('\t'));
  }
  if (lines.length <= 2) return '';  // 只有注释行,无实际 cookie
  return lines.join('\n');
}

// 解析单个 Set-Cookie 字符串
function parseSetCookie(sc: string): {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  expires?: number;
} | null {
  // 形如: NAME=VALUE; Domain=.youtube.com; Path=/; Secure; HttpOnly; Expires=...
  const parts = sc.split(';').map(s => s.trim());
  const [nameVal, ...attrs] = parts;
  const eqIdx = nameVal.indexOf('=');
  if (eqIdx < 0) return null;
  const name = nameVal.slice(0, eqIdx);
  const value = nameVal.slice(eqIdx + 1);
  if (!name) return null;
  let domain: string | undefined;
  let path: string | undefined;
  let secure = false;
  let expires = 0;
  for (const attr of attrs) {
    const [k, v] = attr.split('=');
    const key = (k || '').toLowerCase();
    if (key === 'domain') domain = v;
    else if (key === 'path') path = v;
    else if (key === 'secure') secure = true;
    else if (key === 'expires') {
      const t = Date.parse(v || '');
      if (!isNaN(t)) expires = Math.floor(t / 1000);
    } else if (key === 'max-age') {
      const s = parseInt(v || '0', 10);
      if (!isNaN(s)) expires = Math.floor(Date.now() / 1000) + s;
    }
  }
  return { name, value, domain, path, secure, expires };
}

export default app;
