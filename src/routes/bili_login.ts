// B 站扫码登录路由
// 参考 bilibili-API-collect: https://github.com/SocialSisterYi/bilibili-API-collect
// 流程:
//   1. 前端 GET /qrcode → 拿到二维码 URL + qrcode_key
//   2. 用户用 B 站 App 扫码
//   3. 前端轮询 GET /qrcode/status?qrcode_key=xxx
//   4. 后端在登录成功时解析 cookie 并加密写入 KV
//
// 关键 API:
//   - 获取二维码: https://passport.bilibili.com/x/passport-login/web/qrcode/generate
//   - 查询状态:   https://passport.bilibili.com/x/passport-login/web/qrcode/poll
//                返回 {code:0, data:{code:86101|86090|86039, url?, message?}}

import { Hono } from 'hono';
import { getRawConfig, putConfig } from '../kv';

const app = new Hono<{ Bindings: Env }>();

const BILI_FINGER_SPI = 'https://api.bilibili.com/x/frontend/finger/spi';

// Vercel Edge Function 代理 URL(已验证可绕过 B 站对 Cloudflare Worker IP 的 -412 风控)
// 2026-07-08 实测:Cloudflare Worker 直连 passport.bilibili.com 会被风控,
// 走 Vercel Edge 代理(hnd1 东京节点)可正常拿到二维码和扫码状态
const VERCEL_BILI_PROXY = 'https://y2b-six.vercel.app';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 调 Vercel Edge Function nav 代理,绕过 CF Worker IP 对 api.bilibili.com 的 -412 风控
// 返回 nav 接口的原始 JSON data(成功)或 null(失败,调用方自行降级)
async function fetchBiliNavViaVercel(sessdata: string, biliJct: string, buvid3: string, requestId: string): Promise<any | null> {
  try {
    const resp = await fetch(`${VERCEL_BILI_PROXY}/bili/nav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ sessdata, bili_jct: biliJct, buvid3 }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      log('bili_nav_vercel', 'non_json', { requestId, status: resp.status, contentType: ct });
      return null;
    }
    const data = await resp.json() as any;
    if (data.error) {
      log('bili_nav_vercel', 'failed', { requestId, error: data.error, status: data.status });
      return null;
    }
    return data.nav || null;
  } catch (e: any) {
    log('bili_nav_vercel', 'error', { requestId, error: e.message });
    return null;
  }
}

function log(event: string, status: string, extra: Record<string, any> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, status, ...extra }));
}

function getRequestId(c: any): string {
  return c.req.header('x-request-id') || crypto.randomUUID();
}

// 生成二维码
// 返回 { qrcode_url, qrcode_key, expires_at }
// 走 Vercel Edge 代理绕过 Cloudflare Worker IP 的 -412 风控
app.get('/qrcode', async (c) => {
  const requestId = getRequestId(c);
  const start = Date.now();
  try {
    // 调 Vercel Edge Function /bili/qrcode(已验证可绕过风控)
    const resp = await fetch(`${VERCEL_BILI_PROXY}/bili/qrcode?endpoint=bilibili`, {
      headers: { 'User-Agent': UA },
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const body = await resp.text();
      log('bili_qrcode', 'failed', { requestId, status: resp.status, contentType: ct, bodyPreview: body.slice(0, 200) });
      return c.json({ error: `Vercel 代理返回非 JSON(status=${resp.status}, type=${ct})` }, 502);
    }
    const data = await resp.json() as any;
    if (data.error) {
      log('bili_qrcode', 'failed', { requestId, error: data.error, bili_code: data.bili_code, bili_message: data.bili_message });
      return c.json({ error: data.bili_message || data.error, bili_code: data.bili_code }, 502);
    }
    log('bili_qrcode', 'success', { requestId, vercelRegion: data.vercelRegion, duration: Date.now() - start });
    return c.json({
      qrcode_url: data.qrcode_url || '',
      qrcode_key: data.qrcode_key || '',
      expires_at: data.expires_at || Math.floor(Date.now() / 1000) + 180,
    });
  } catch (e: any) {
    log('bili_qrcode', 'error', { requestId, error: e.message });
    return c.json({ error: '请求 Vercel 代理失败:' + (e.message || e) }, 502);
  }
});

// 获取 buvid3:调 finger/spi 接口拿真实设备指纹
// buvid3 格式如 "AF0E8DB1-...-36043infoc",是 B 站风控必需的
// 随机 UUID 不带 infoc 后缀会被风控拒绝("request was banned")
async function getBuvid3(requestId: string): Promise<{ buvid3: string; source: string }> {
  try {
    const resp = await fetch(BILI_FINGER_SPI, {
      headers: { 'User-Agent': UA },
    });
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await resp.json() as any;
      if (data.code === 0 && data.data?.b_3) {
        return { buvid3: data.data.b_3 as string, source: 'spi' };
      }
      log('bili_finger', 'warning', { requestId, code: data.code, message: data.message });
    } else {
      log('bili_finger', 'warning', { requestId, status: resp.status, contentType: ct });
    }
  } catch (e: any) {
    log('bili_finger', 'warning', { requestId, error: e.message });
  }
  // 兜底:生成格式正确的 buvid3(UUID + 5位数字 + infoc 后缀)
  // finger/spi 接口从 Cloudflare Worker 可能也被风控,用本地生成兜底
  const uuid = crypto.randomUUID().toUpperCase();
  const num = (Math.floor(Date.now() / 1000) % 100000).toString().padStart(5, '0');
  return { buvid3: `${uuid}${num}infoc`, source: 'local_gen' };
}

// 查询登录状态
// 返回 { status: 'waiting'|'scanned'|'success'|'expired'|'error', uname?, message? }
// 走 Vercel Edge 代理绕过 Cloudflare Worker IP 的 -412 风控
app.get('/qrcode/status', async (c) => {
  const requestId = getRequestId(c);
  const start = Date.now();
  const qrcodeKey = c.req.query('qrcode_key');
  if (!qrcodeKey) {
    return c.json({ error: '缺少 qrcode_key 参数' }, 400);
  }
  try {
    // 调 Vercel Edge Function /bili/qrcode-status(已验证可绕过风控)
    const resp = await fetch(`${VERCEL_BILI_PROXY}/bili/qrcode-status?qrcode_key=${encodeURIComponent(qrcodeKey)}&endpoint=bilibili&login_type=web`, {
      headers: { 'User-Agent': UA },
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const body = await resp.text();
      log('bili_qrcode_status', 'failed', { requestId, status: resp.status, contentType: ct, bodyPreview: body.slice(0, 200) });
      return c.json({ status: 'error', message: `Vercel 代理返回非 JSON(status=${resp.status})` });
    }
    const data = await resp.json() as any;
    // Vercel Edge Function 已处理状态码映射,直接透传 status
    if (data.status === 'waiting') {
      return c.json({ status: 'waiting', message: data.message || '等待扫码' });
    }
    if (data.status === 'scanned') {
      return c.json({ status: 'scanned', message: '已扫码,请在手机上确认' });
    }
    if (data.status === 'expired') {
      return c.json({ status: 'expired', message: '二维码已过期' });
    }
    if (data.status === 'success') {
      // 登录成功:Vercel 代理已解析 crossDomainUrl,返回了 sessdata/bili_jct/dede_user_id
      // 但仍需走 parseBiliLoginCookies 流程:补 buvid3、调 nav 拿 uname、加密写 KV
      const sessdata = data.sessdata || '';
      const biliJct = data.bili_jct || '';
      if (!sessdata || !biliJct) {
        return c.json({ status: 'error', message: 'Vercel 代理返回 success 但缺少 sessdata/bili_jct' });
      }
      // 构造 crossDomainUrl 走原有解析流程(补 buvid3 + nav + 加密写 KV)
      const crossDomainUrl = data.crossDomainUrl || `https://passport.biligame.com/x/passport-login/web/crossDomain?DedeUserID=${encodeURIComponent(data.dede_user_id || '')}&SESSDATA=${encodeURIComponent(sessdata)}&bili_jct=${encodeURIComponent(biliJct)}`;
      const parsed = await parseBiliLoginCookies(crossDomainUrl, c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '', requestId);
      if (!parsed.ok) {
        return c.json({ status: 'error', message: parsed.error || '解析登录信息失败' });
      }
      log('bili_qrcode_status', 'success', { requestId, uname: parsed.uname, vercelRegion: data.vercelRegion, duration: Date.now() - start });
      return c.json({
        status: 'success',
        uname: parsed.uname || '',
        message: '登录成功',
      });
    }
    // Vercel 代理返回 error 或未知状态
    return c.json({ status: 'error', message: data.message || `Vercel 代理返回未知状态: ${data.status}` });
  } catch (e: any) {
    log('bili_qrcode_status', 'error', { requestId, error: e.message });
    return c.json({ status: 'error', message: '请求 Vercel 代理失败:' + (e.message || e) });
  }
});

// 登出:清空 B 站凭证(保留其他配置)
app.post('/logout', async (c) => {
  const requestId = getRequestId(c);
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  await putConfig(c.env.YT2BILI_KV, {
    ...cfg,
    bili_sessdata: '',
    bili_jct: '',
    bili_buvid3: '',
    ac_time_value: '',
    bili_login_at: 0,
    bili_uname: '',
  }, c.env.ENCRYPTION_KEY || '');
  log('bili_logout', 'success', { requestId });
  return c.json({ success: true });
});

// 检测 B 站登录态:用 KV 中已存的 SESSDATA 调 nav 接口,确认是否仍有效
// 返回 { ok, valid, uname?, expires_at?, message? }
//   - ok=false     网络/服务器错误(无法判断)
//   - ok=true,valid=true    cookie 有效
//   - ok=true,valid=false   cookie 已失效(-101 未登录 / -352 风控 / 网络异常)
app.post('/check', async (c) => {
  const requestId = getRequestId(c);
  const start = Date.now();
  try {
    const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
    if (!cfg.bili_sessdata) {
      log('bili_check', 'no_creds', { requestId });
      return c.json({ ok: true, valid: false, message: '尚未登录 B 站' });
    }
    // 走 Vercel nav 代理绕过 CF Worker IP 风控(api.bilibili.com 也被风控)
    const navData = await fetchBiliNavViaVercel(cfg.bili_sessdata, cfg.bili_jct || '', cfg.bili_buvid3 || '', requestId);
    if (!navData) {
      log('bili_check', 'vercel_failed', { requestId, duration: Date.now() - start });
      return c.json({ ok: false, message: 'Vercel nav 代理请求失败(详见 Worker 日志)' });
    }
    if (navData.code === 0 && navData.data?.isLogin) {
      // 有效:从 SESSDATA 解码 exp 时间(若有 ac_time_value 字段直接用)
      let expiresAt: number | undefined;
      const acTime = Number(cfg.ac_time_value);
      if (acTime && acTime > 0) expiresAt = acTime * 1000;
      log('bili_check', 'valid', { requestId, uname: navData.data.uname, expiresAt, duration: Date.now() - start });
      return c.json({
        ok: true,
        valid: true,
        uname: navData.data.uname || cfg.bili_uname || '',
        expires_at: expiresAt,
        message: 'B 站登录态有效',
      });
    }
    // 失效:典型 -101 (账号未登录) / -352 (风控) / -412 (被 ban)
    log('bili_check', 'invalid', { requestId, code: navData.code, message: navData.message });
    return c.json({
      ok: true,
      valid: false,
      message: 'B 站登录已失效' + (navData.message ? '(' + navData.message + ')' : ''),
    });
  } catch (e: any) {
    log('bili_check', 'error', { requestId, error: e.message });
    return c.json({ ok: false, message: '检测请求失败: ' + (e.message || e) });
  }
});

// 解析 B 站登录成功后的 cookie
// crossDomainUrl 形如:
//   https://passport.biligame.com/x/passport-login/web/crossDomain?DedeUserID=xxx&SESSDATA=xxx&bili_jct=xxx&...
async function parseBiliLoginCookies(
  crossDomainUrl: string,
  kv: KVNamespace,
  encryptionKey: string,
  requestId: string,
): Promise<{ ok: boolean; uname?: string; error?: string }> {
  try {
    const url = new URL(crossDomainUrl);
    const sessdata = url.searchParams.get('SESSDATA') || '';
    const biliJct = url.searchParams.get('bili_jct') || '';
    if (!sessdata || !biliJct) {
      return { ok: false, error: 'crossDomain URL 中缺少 SESSDATA 或 bili_jct' };
    }

    // buvid3:用统一的 getBuvid3 函数(优先调 finger/spi,失败用本地生成兜底)
    const { buvid3 } = await getBuvid3(requestId);

    // ac_time_value:从 SESSDATA 解码 JWT-like payload 取 exp
    // SESSDATA 实际格式是 base64url payload(非标准 JWT,无 signature 段)
    // 这里尝试解码并取 exp 字段;失败时设为 0(表示未知,Runner 会跳过过期检查)
    let acTimeValue = '';
    try {
      acTimeValue = String(decodeSessdataExp(sessdata) || 0);
    } catch (e) {
      log('bili_sessdata_decode', 'warning', { requestId, error: (e as Error).message });
      acTimeValue = '0';
    }

    // 调 nav 接口拿账号名 + 校验登录是否真成功
    // 走 Vercel nav 代理绕过 CF Worker IP 风控(api.bilibili.com 也被风控)
    let uname = '';
    try {
      const navData = await fetchBiliNavViaVercel(sessdata, biliJct, buvid3, requestId);
      if (navData && navData.code === 0 && navData.data?.isLogin) {
        uname = navData.data.uname || '';
      } else if (navData) {
        log('bili_nav', 'warning', { requestId, code: navData.code, message: navData.message });
      } else {
        // Vercel 代理失败,但 cookie 已拿到。仍写入,但警告
        log('bili_nav', 'warning', { requestId, error: 'Vercel nav 代理失败' });
      }
    } catch (e) {
      log('bili_nav', 'warning', { requestId, error: (e as Error).message });
    }

    // 加密写入 KV
    const cfg = await getRawConfig(kv, encryptionKey);
    await putConfig(kv, {
      ...cfg,
      bili_sessdata: sessdata,
      bili_jct: biliJct,
      bili_buvid3: buvid3,
      ac_time_value: acTimeValue,
      bili_login_at: Date.now(),
      bili_uname: uname,
    }, encryptionKey);

    return { ok: true, uname };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

// 解码 SESSDATA 取 exp 时间戳
// SESSDATA 不是标准 JWT(可能无 header.payload.signature 三段),
// 这里尝试多种格式: ① 标准 JWT 拆分; ② 整体 base64url payload
function decodeSessdataExp(sessdata: string): number | null {
  if (!sessdata) return null;
  const parts = sessdata.split('.');
  let payloadB64 = '';
  if (parts.length === 3) {
    // 标准 JWT: header.payload.signature
    payloadB64 = parts[1];
  } else if (parts.length === 2) {
    // 双段: payload.signature
    payloadB64 = parts[0];
  } else {
    // 单段: 整体当作 payload
    payloadB64 = sessdata;
  }
  // base64url → base64
  const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  // 补齐 padding
  const pad = b64.length % 4;
  const padded = pad ? b64 + '='.repeat(4 - pad) : b64;
  try {
    const json = atob(padded);
    const parsed = JSON.parse(json);
    if (typeof parsed.exp === 'number') {
      return parsed.exp;
    }
    return null;
  } catch {
    return null;
  }
}

export default app;
