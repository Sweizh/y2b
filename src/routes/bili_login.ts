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

const BILI_NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const BILI_QRCODE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const BILI_QRCODE_INFO = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const BILI_FINGER_SPI = 'https://api.bilibili.com/x/frontend/finger/spi';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// B 站 passport 端点需要的请求头(缺少 Referer/Origin 时可能返回 HTML 错误页)
const BILI_PASSPORT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  'Referer': 'https://www.bilibili.com/',
  'Origin': 'https://www.bilibili.com',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function log(event: string, status: string, extra: Record<string, any> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, status, ...extra }));
}

function getRequestId(c: any): string {
  return c.req.header('x-request-id') || crypto.randomUUID();
}

// 生成二维码
// 返回 { qrcode_url, qrcode_key, expires_at }
app.get('/qrcode', async (c) => {
  const requestId = getRequestId(c);
  const start = Date.now();
  try {
    // B 站 passport 端点需要 buvid3 cookie 否则风控返回 "request was banned"
    const { buvid3, source: buvid3Source } = await getBuvid3(requestId);
    const headers = { ...BILI_PASSPORT_HEADERS };
    headers['Cookie'] = `buvid3=${buvid3}`;
    const resp = await fetch(BILI_QRCODE_URL, {
      headers,
      // 不自动跟随重定向(B 站可能 302 到 HTML 登录页)
      redirect: 'manual',
    });
    // 检查响应是否为 JSON,避免 HTML 解析报错
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const body = await resp.text();
      log('bili_qrcode', 'failed', { requestId, status: resp.status, contentType: ct, bodyPreview: body.slice(0, 200) });
      return c.json({ error: `B 站返回非 JSON(status=${resp.status}, type=${ct})` }, 502);
    }
    const data = await resp.json() as any;
    if (data.code !== 0) {
      log('bili_qrcode', 'failed', { requestId, code: data.code, message: data.message });
      // 诊断信息:帮助排查 "request was banned"
      const buvid3Preview = buvid3.slice(0, 20);
      const buvid3HasInfoc = buvid3.includes('infoc') ? 'yes' : 'no';
      return c.json({ error: data.message || '获取二维码失败', debug: { buvid3_source: buvid3Source, buvid3_preview: buvid3Preview, has_infoc: buvid3HasInfoc, bili_code: data.code } }, 502);
    }
    // data.data: { url, qrcode_key, webUrl(可选) }
    const d = data.data || {};
    log('bili_qrcode', 'success', { requestId, duration: Date.now() - start });
    return c.json({
      qrcode_url: d.url || '',
      qrcode_key: d.qrcode_key || '',
      // B 站不直接返回过期时间,文档约定 180s,这里加 30s 余量
      expires_at: Math.floor(Date.now() / 1000) + 180,
    });
  } catch (e: any) {
    log('bili_qrcode', 'error', { requestId, error: e.message });
    return c.json({ error: '请求 B 站失败:' + (e.message || e) }, 502);
  }
});

// 临时调试端点:诊断 Worker fetch 调 B 站为什么 -412
// 测试多种 fetch 配置,返回每种的结果,定位是请求头/TLS/还是其他问题
app.get('/debug', async (c) => {
  const results: any[] = [];
  const biliUrl = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header';

  // 1. 纯 fetch(无自定义头)
  try {
    const r = await fetch(biliUrl);
    const body = await r.text();
    results.push({ test: '1_pure_fetch', status: r.status, ct: r.headers.get('content-type'), body: body.slice(0, 200) });
  } catch (e: any) { results.push({ test: '1_pure_fetch', error: e.message }); }

  // 2. 只带 UA
  try {
    const r = await fetch(biliUrl, { headers: { 'User-Agent': UA } });
    const body = await r.text();
    results.push({ test: '2_ua_only', status: r.status, ct: r.headers.get('content-type'), body: body.slice(0, 200) });
  } catch (e: any) { results.push({ test: '2_ua_only', error: e.message }); }

  // 3. 完整头(当前代码风格)
  try {
    const r = await fetch(biliUrl, { headers: BILI_PASSPORT_HEADERS });
    const body = await r.text();
    results.push({ test: '3_full_headers', status: r.status, ct: r.headers.get('content-type'), body: body.slice(0, 200) });
  } catch (e: any) { results.push({ test: '3_full_headers', error: e.message }); }

  // 4. 完整头 + redirect follow(而非 manual)
  try {
    const r = await fetch(biliUrl, { headers: BILI_PASSPORT_HEADERS, redirect: 'follow' });
    const body = await r.text();
    results.push({ test: '4_full_follow', status: r.status, ct: r.headers.get('content-type'), body: body.slice(0, 200) });
  } catch (e: any) { results.push({ test: '4_full_follow', error: e.message }); }

  // 5. 用 httpbin 看 Worker fetch 实际发出的请求头
  try {
    const r = await fetch('https://httpbin.org/headers');
    const data = await r.json() as any;
    results.push({ test: '5_echo_headers', workerSentHeaders: data.headers });
  } catch (e: any) { results.push({ test: '5_echo_headers', error: e.message }); }

  return c.json({ results });
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
app.get('/qrcode/status', async (c) => {
  const requestId = getRequestId(c);
  const start = Date.now();
  const qrcodeKey = c.req.query('qrcode_key');
  if (!qrcodeKey) {
    return c.json({ error: '缺少 qrcode_key 参数' }, 400);
  }
  try {
    const { buvid3 } = await getBuvid3(requestId);
    const pollHeaders = { ...BILI_PASSPORT_HEADERS };
    pollHeaders['Cookie'] = `buvid3=${buvid3}`;
    const resp = await fetch(`${BILI_QRCODE_INFO}?qrcode_key=${encodeURIComponent(qrcodeKey)}`, {
      headers: pollHeaders,
      redirect: 'manual',
    });
    // 检查响应是否为 JSON
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const body = await resp.text();
      log('bili_qrcode_status', 'failed', { requestId, status: resp.status, contentType: ct, bodyPreview: body.slice(0, 200) });
      return c.json({ status: 'error', message: `B 站返回非 JSON(status=${resp.status})` });
    }
    const data = await resp.json() as any;
    // poll 接口返回结构: {"code":0,"data":{"code":86101,"url":"","message":"未扫码"}}
    //   - 顶层 code: 0=HTTP 请求成功(不代表登录成功)
    //   - data.code: 真正的扫码状态码
    //     86101 = 未扫码
    //     86090 = 已扫码,且若 data.url 非空则表示已确认登录成功
    //     86039 = 二维码已过期
    const dataCode = data?.data?.code;
    if (dataCode === 86101) {
      return c.json({ status: 'waiting', message: data?.data?.message || '等待扫码' });
    }
    if (dataCode === 86090) {
      // 已扫码。data.url 非空表示已确认登录(url 含 crossDomain 跳转地址,带 cookie 参数)
      const crossDomainUrl = data?.data?.url;
      if (!crossDomainUrl) {
        return c.json({ status: 'scanned', message: '已扫码,请在手机上确认' });
      }
      // 登录成功,解析 cookie
      const parsed = await parseBiliLoginCookies(crossDomainUrl, c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '', requestId);
      if (!parsed.ok) {
        return c.json({ status: 'error', message: parsed.error || '解析登录信息失败' });
      }
      log('bili_qrcode_status', 'success', { requestId, uname: parsed.uname, duration: Date.now() - start });
      return c.json({
        status: 'success',
        uname: parsed.uname || '',
        message: '登录成功',
      });
    }
    if (dataCode === 86039) {
      return c.json({ status: 'expired', message: '二维码已过期' });
    }
    return c.json({ status: 'error', message: data?.data?.message || `未知状态码 ${dataCode}` });
  } catch (e: any) {
    log('bili_qrcode_status', 'error', { requestId, error: e.message });
    return c.json({ status: 'error', message: '请求 B 站失败:' + (e.message || e) });
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

// 用户侧浏览器弹窗登录后提交 cookie(绕过 Worker IP 风控的唯一可行方案)
// 流程:
//   1. 前端弹窗打开 https://passport.bilibili.com/login,用户在浏览器中正常登录
//   2. 登录成功后,用户在 B 站页面按 F12 → Console,粘贴一行 JS:
//      window.opener.postMessage({type:'bili-cookie-result',success:true,cookie:document.cookie},'*')
//   3. 主窗口收到 message 后 POST cookie 字符串到本端点
//   4. 后端解析 SESSDATA/bili_jct/buvid3,调 nav 接口验证(失败不阻断),加密存 KV
//
// 为什么不用 Worker 代理 B 站 QR 登录: passport.bilibili.com 对 Cloudflare Worker IP 严格风控,
// 即使带 buvid3 也返回 {"code":-412,"message":"request was banned"}
app.post('/cookie', async (c) => {
  const requestId = getRequestId(c);
  const start = Date.now();
  try {
    const body = await c.req.json().catch(() => ({})) as { cookie?: string };
    const cookieStr = (body?.cookie || '').trim();
    if (!cookieStr) {
      return c.json({ error: 'cookie 不能为空' }, 400);
    }
    const cookies = parseCookieString(cookieStr);
    const sessdata = cookies['SESSDATA'] || '';
    const biliJct = cookies['bili_jct'] || '';
    const buvid3FromCookie = cookies['buvid3'] || '';
    if (!sessdata || !biliJct) {
      return c.json({ error: 'cookie 中缺少 SESSDATA 或 bili_jct,请确认已在 bilibili.com 登录后再提取 cookie' }, 400);
    }
    // buvid3: 优先用用户提交的;若没有则从 finger/spi 获取或本地生成兜底
    let finalBuvid3 = buvid3FromCookie;
    if (!finalBuvid3) {
      const { buvid3: fallback, source } = await getBuvid3(requestId);
      finalBuvid3 = fallback;
      log('bili_cookie_buvid3', 'fallback', { requestId, source });
    }
    // 调 nav 接口验证 cookie + 取 uname
    // 注意: nav 接口(api.bilibili.com)可能也被风控,验证失败不阻断流程
    // 实际有效性由 Runner 在 GitHub Actions 中调上传接口时验证
    let uname = '';
    let navVerified = false;
    try {
      const navResp = await fetch(BILI_NAV_URL, {
        headers: {
          'Cookie': `SESSDATA=${sessdata}; bili_jct=${biliJct}; buvid3=${finalBuvid3}`,
          'User-Agent': UA,
        },
      });
      const ct = navResp.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const navData = await navResp.json() as any;
        if (navData.code === 0 && navData.data?.isLogin) {
          uname = navData.data.uname || '';
          navVerified = true;
        } else {
          log('bili_cookie_nav', 'warning', { requestId, code: navData.code, message: navData.message });
        }
      } else {
        log('bili_cookie_nav', 'warning', { requestId, status: navResp.status, contentType: ct });
      }
    } catch (e: any) {
      log('bili_cookie_nav', 'error', { requestId, error: e.message });
    }
    // 解码 SESSDATA 取 exp(用于 Runner 判断 cookie 是否临近过期)
    let acTimeValue = '0';
    try {
      acTimeValue = String(decodeSessdataExp(sessdata) || 0);
    } catch (e) {
      log('bili_sessdata_decode', 'warning', { requestId, error: (e as Error).message });
    }
    // 加密写入 KV
    const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
    await putConfig(c.env.YT2BILI_KV, {
      ...cfg,
      bili_sessdata: sessdata,
      bili_jct: biliJct,
      bili_buvid3: finalBuvid3,
      ac_time_value: acTimeValue,
      bili_login_at: Date.now(),
      bili_uname: uname,
    }, c.env.ENCRYPTION_KEY || '');
    log('bili_cookie_login', 'success', { requestId, uname, navVerified, duration: Date.now() - start });
    return c.json({
      success: true,
      uname,
      nav_verified: navVerified,
      message: navVerified ? `登录成功,账号: ${uname}` : 'Cookie 已保存(nav 接口未能验证,实际有效性将在 Runner 运行时确认)',
    });
  } catch (e: any) {
    log('bili_cookie_login', 'error', { requestId, error: e.message });
    return c.json({ error: e.message || String(e) }, 500);
  }
});

// 解析 cookie 字符串(形如 "SESSDATA=xxx; bili_jct=xxx; buvid3=xxx; ...")
function parseCookieString(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  s.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const name = pair.slice(0, idx).trim();
      result[name] = pair.slice(idx + 1).trim();
    }
  });
  return result;
}

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
    let uname = '';
    try {
      const navResp = await fetch(BILI_NAV_URL, {
        headers: {
          'Cookie': `SESSDATA=${sessdata}; bili_jct=${biliJct}; buvid3=${buvid3}`,
          'User-Agent': UA,
        },
      });
      const navData = await navResp.json() as any;
      if (navData.code === 0 && navData.data?.isLogin) {
        uname = navData.data.uname || '';
      } else {
        // nav 接口未确认登录,但 cookie 已拿到。仍写入,但警告
        log('bili_nav', 'warning', { requestId, code: navData.code, message: navData.message });
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
