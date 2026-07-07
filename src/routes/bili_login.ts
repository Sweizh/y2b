// B 站扫码登录路由
// 参考 bilibili-API-collect: https://github.com/SocialSisterYi/bilibili-API-collect
// 流程:
//   1. 前端 GET /qrcode → 拿到二维码 URL + qrcode_key
//   2. 用户用 B 站 App 扫码
//   3. 前端轮询 GET /qrcode/status?qrcode_key=xxx
//   4. 后端在登录成功时解析 cookie 并加密写入 KV
//
// 关键 API:
//   - 获取二维码: https://passport.bilibili.com/x/passport-login/web/qrcode/url
//   - 查询状态:   https://passport.bilibili.com/x/passport-login/web/qrcode/info

import { Hono } from 'hono';
import { getRawConfig, putConfig } from '../kv';

const app = new Hono<{ Bindings: Env }>();

const BILI_NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const BILI_QRCODE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/url';
const BILI_QRCODE_INFO = 'https://passport.bilibili.com/x/passport-login/web/qrcode/info';
const BILI_FINGER_SPIDE = 'https://api.bilibili.com/x/frontend/finger/spide';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    const resp = await fetch(BILI_QRCODE_URL, {
      headers: { 'User-Agent': UA },
    });
    const data = await resp.json() as any;
    if (data.code !== 0) {
      log('bili_qrcode', 'failed', { requestId, code: data.code, message: data.message });
      return c.json({ error: data.message || '获取二维码失败' }, 502);
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
    const resp = await fetch(`${BILI_QRCODE_INFO}?qrcode_key=${encodeURIComponent(qrcodeKey)}`, {
      headers: { 'User-Agent': UA },
    });
    const data = await resp.json() as any;
    const code = data.code;
    // B 站返回码:
    //   0     : 未扫码
    //   86090 : 已扫码待确认
    //   86090 + data.url : 已确认登录成功(url 含 crossDomain 跳转地址,带 cookie 参数)
    //   86039 : 二维码已过期
    //   -1    : 其他错误
    if (code === 86039) {
      return c.json({ status: 'expired', message: '二维码已过期' });
    }
    if (code === 0) {
      return c.json({ status: 'waiting', message: '等待扫码' });
    }
    if (code === 86090) {
      // 检查 data.url 是否存在(存在表示已确认登录)
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
    return c.json({ status: 'error', message: data.message || `未知状态码 ${code}` });
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

    // buvid3:优先调 finger/spide 拿真实值,失败用随机 UUID 兜底
    let buvid3 = '';
    try {
      const fingerResp = await fetch(BILI_FINGER_SPIDE, { headers: { 'User-Agent': UA } });
      const fingerData = await fingerResp.json() as any;
      if (fingerData.code === 0 && fingerData.data?.b_3) {
        buvid3 = fingerData.data.b_3;
      }
    } catch (e) {
      log('bili_finger', 'warning', { requestId, error: (e as Error).message });
    }
    if (!buvid3) {
      // 兜底:生成 UUID-like 字符串(B 站对 buvid3 校验宽松)
      buvid3 = crypto.randomUUID().toUpperCase();
    }

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
