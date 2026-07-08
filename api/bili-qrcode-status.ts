// Vercel Edge Function:代理 B 站二维码扫码状态轮询接口
// 目的:验证 Vercel 出口 IP 能否完成扫码登录全流程
//
// 路由:GET /bili/qrcode-status?qrcode_key=xxx&endpoint=bilibili|biligame|tv&login_type=web|tv
// 返回:
//   { status: 'waiting'|'scanned'|'success'|'expired'|'error', message?, ... }
//
// Web 登录状态码(data.data.code):
//   0      = 成功(data.url 含 SESSDATA/bili_jct/DedeUserID)
//   86090  = 已扫码待确认(有时也带 url 表示成功)
//   86101  = 等待扫码
//   86038  = 二维码过期
// TV 登录走 POST /x/passport-tv-login/qrcode/poll,成功直接返回 access_token

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const WEB_HOSTS: Record<string, string> = {
  bilibili: 'passport.bilibili.com',
  biligame: 'passport.biligame.com',
};

const TV_APPKEY = '4409e2ce8ffd12b8';
const TV_APPSEC = '59b43e04ad6965f34319062b478f83dd';
const TV_POLL_URL = 'https://passport.bilibili.com/x/passport-tv-login/qrcode/poll';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    },
  });
}

function randomStr(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// TV 签名:参数排序 + URL 编码 + appsec + MD5
async function signTVParams(params: Record<string, string>): Promise<string> {
  const sorted = Object.keys(params).sort();
  const query = sorted.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const data = new TextEncoder().encode(query + TV_APPSEC);
  const hashBuf = await crypto.subtle.digest('MD5', data);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pollTV(authCode: string): Promise<{ data: any; status: number; rawBody?: string; contentType: string }> {
  const params: Record<string, string> = {
    appkey: TV_APPKEY,
    auth_code: authCode,
    mobi_app: 'android_tv_yst',
    device: 'OnePlus',
    device_name: 'OnePlus7TPro',
    build: '102801',
    buvid: randomStr(37),
    local_id: randomStr(20),
  };
  params.sign = await signTVParams(params);
  const resp = await fetch(TV_POLL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&'),
  });
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const body = await resp.text();
    return { data: null, status: resp.status, rawBody: body, contentType: ct };
  }
  const data = await resp.json() as any;
  return { data, status: resp.status, contentType: ct };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' } });
  }
  const start = Date.now();
  const vercelRegion = req.headers.get('x-vercel-id') || 'unknown';
  const url = new URL(req.url);
  const qrcodeKey = url.searchParams.get('qrcode_key');
  const ep = url.searchParams.get('endpoint') || 'bilibili';
  const loginType = url.searchParams.get('login_type') || (ep === 'tv' ? 'tv' : 'web');
  if (!qrcodeKey) {
    return json({ status: 'error', message: '缺少 qrcode_key 参数' }, 400);
  }
  try {
    if (loginType === 'tv') {
      // ===== TV 轮询 =====
      const r = await pollTV(qrcodeKey);
      if (!r.data) {
        return json({
          status: 'error',
          message: 'TV 端返回非 JSON',
          httpStatus: r.status,
          bodyPreview: (r.rawBody || '').slice(0, 300),
          endpoint: ep,
          vercelRegion,
          duration: Date.now() - start,
        });
      }
      const d = r.data;
      if (d.code !== 0) {
        // TV 端错误码:86039 过期,86090 已扫码待确认,86101 等待扫码
        const msg = d.message || '';
        if (d.code === 86039) return json({ status: 'expired', message: '二维码已过期', endpoint: ep, vercelRegion, duration: Date.now() - start });
        if (d.code === 86090) return json({ status: 'scanned', message: '已扫码,请在手机上确认', endpoint: ep, vercelRegion, duration: Date.now() - start });
        if (d.code === 86101) return json({ status: 'waiting', message: '等待扫码', endpoint: ep, vercelRegion, duration: Date.now() - start });
        return json({ status: 'error', message: msg || `未知 TV 状态码 ${d.code}`, bili_code: d.code, endpoint: ep, vercelRegion, duration: Date.now() - start });
      }
      // TV 登录成功:直接返回 access_token / refresh_token / mid
      return json({
        status: 'success',
        message: 'TV 登录成功',
        access_token: d.data?.access_token || '',
        refresh_token: d.data?.refresh_token || '',
        mid: d.data?.mid || 0,
        expires_at: Math.floor(Date.now() / 1000) + (d.data?.expires_in || 2592000),
        endpoint: ep,
        login_type: 'tv',
        vercelRegion,
        duration: Date.now() - start,
      });
    }

    // ===== Web 轮询(bilibili / biligame) =====
    const host = WEB_HOSTS[ep] || WEB_HOSTS.bilibili;
    const resp = await fetch(`https://${host}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const body = await resp.text();
      return json({
        status: 'error',
        message: 'B 站返回非 JSON',
        httpStatus: resp.status,
        bodyPreview: body.slice(0, 300),
        endpoint: ep,
        vercelRegion,
        duration: Date.now() - start,
      });
    }
    const data = await resp.json() as any;
    const dataCode = data?.data?.code;
    // 0 = 成功(url 含 cookie),86090 = 已扫码待确认
    if (dataCode === 0 || dataCode === 86090) {
      const crossDomainUrl = data?.data?.url;
      if (!crossDomainUrl) {
        // 86090 但没有 url = 已扫码待确认
        return json({ status: 'scanned', message: '已扫码,请在手机上确认', endpoint: ep, vercelRegion, duration: Date.now() - start });
      }
      // 登录成功:解析 crossDomain URL 拿到 SESSDATA/bili_jct
      let sessdata = '';
      let biliJct = '';
      let dedeUserId = '';
      try {
        const u = new URL(crossDomainUrl);
        sessdata = u.searchParams.get('SESSDATA') || '';
        biliJct = u.searchParams.get('bili_jct') || '';
        dedeUserId = u.searchParams.get('DedeUserID') || '';
      } catch (e) {
        return json({
          status: 'success',
          message: '登录成功但 cookie 解析失败',
          crossDomainUrl,
          endpoint: ep,
          vercelRegion,
          duration: Date.now() - start,
        });
      }
      return json({
        status: 'success',
        message: '登录成功',
        sessdata,
        bili_jct: biliJct,
        dede_user_id: dedeUserId,
        crossDomainUrl,
        endpoint: ep,
        vercelRegion,
        duration: Date.now() - start,
      });
    }
    if (dataCode === 86101) {
      return json({ status: 'waiting', message: data?.data?.message || '等待扫码', endpoint: ep, vercelRegion, duration: Date.now() - start });
    }
    if (dataCode === 86038) {
      return json({ status: 'expired', message: '二维码已过期', endpoint: ep, vercelRegion, duration: Date.now() - start });
    }
    return json({
      status: 'error',
      message: data?.data?.message || `未知状态码 ${dataCode}`,
      bili_code: data?.code,
      bili_data_code: dataCode,
      endpoint: ep,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      status: 'error',
      message: 'Vercel Edge 请求 B 站失败: ' + (e.message || e),
      endpoint: ep,
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
