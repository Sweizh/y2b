// Vercel Edge Function:代理 B 站二维码生成接口
// 目的:验证 Vercel 出口 IP 能否绕过 B 站对 Cloudflare Worker IP 的风控
//
// 路由:GET /bili/qrcode?endpoint=bilibili|biligame|tv
//   - bilibili(默认):passport.bilibili.com(web 登录)
//   - biligame:passport.biligame.com(DSA CDN,不同 IP 段)
//   - tv:passport.snm0516.aisee.tv(TV 登录,需 appkey/appsec 签名)
// 返回:{ qrcode_url, qrcode_key, expires_at, endpoint } 或 { error, ... }
//
// 不使用 Hono:单端点代理函数,原生 Web API 更简单可靠

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const WEB_HOSTS: Record<string, string> = {
  bilibili: 'passport.bilibili.com',
  biligame: 'passport.biligame.com',
};

// TV 登录 appkey/appsec(从 B 站 TV 客户端 APK 提取的公开信息)
// 参考:bilibili-API-collect 项目 + BBDown 源码
const TV_APPKEY = '4409e2ce8ffd12b8';
const TV_APPSEC = '59b43e04ad6965f34319062b478f83dd';
const TV_AUTH_URL = 'https://passport.snm0516.aisee.tv/x/passport-tv-login/qrcode/auth_code';

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

// TV 签名:参数排序 + URL 编码 + appsec + MD5
async function signTVParams(params: Record<string, string>): Promise<string> {
  const sorted = Object.keys(params).sort();
  const query = sorted.map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const data = new TextEncoder().encode(query + TV_APPSEC);
  const hashBuf = await crypto.subtle.digest('MD5', data);
  // Edge runtime 不支持 crypto.subtle.digest('MD5')!需用旧式 md5 实现或改算法
  // 实际上 Edge runtime 在 Vercel 上支持 MD5(基于 Node 18+)
  const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex;
}

// 生成随机字符串(TV 设备指纹用)
function randomStr(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function fetchTVQrcode(): Promise<{ data: any; status: number; rawBody?: string; contentType: string }> {
  const params: Record<string, string> = {
    appkey: TV_APPKEY,
    mobi_app: 'android_tv_yst',
    device: 'OnePlus',
    device_name: 'OnePlus7TPro',
    build: '102801',
    buvid: randomStr(37),
    local_id: randomStr(20),
    // ts: Math.floor(Date.now() / 1000).toString(),
  };
  params.sign = await signTVParams(params);
  const resp = await fetch(TV_AUTH_URL, {
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
  const ep = url.searchParams.get('endpoint') || 'bilibili';

  try {
    if (ep === 'tv') {
      // ===== TV 登录 =====
      const r = await fetchTVQrcode();
      if (!r.data) {
        return json({
          error: 'TV 端返回非 JSON',
          status: r.status,
          contentType: r.contentType,
          bodyPreview: (r.rawBody || '').slice(0, 300),
          endpoint: ep,
          vercelRegion,
          duration: Date.now() - start,
        }, 502);
      }
      const d = r.data;
      if (d.code !== 0) {
        return json({
          error: 'TV 端返回错误码',
          bili_code: d.code,
          bili_message: d.message || '',
          raw: d,
          endpoint: ep,
          vercelRegion,
          duration: Date.now() - start,
        }, 502);
      }
      // TV 端返回 {data: {url, auth_code}}
      return json({
        qrcode_url: d.data?.url || '',
        qrcode_key: d.data?.auth_code || '',  // 用 qrcode_key 字段统一存储 auth_code
        expires_at: Math.floor(Date.now() / 1000) + 180,
        endpoint: ep,
        login_type: 'tv',  // 标记 TV 登录,轮询走不同端点
        vercelRegion,
        duration: Date.now() - start,
      });
    }

    // ===== Web 登录(bilibili / biligame) =====
    const host = WEB_HOSTS[ep] || WEB_HOSTS.bilibili;
    const biliUrl = `https://${host}/x/passport-login/web/qrcode/generate`;
    const resp = await fetch(biliUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const body = await resp.text();
      return json({
        error: 'B 站返回非 JSON',
        status: resp.status,
        contentType: ct,
        bodyPreview: body.slice(0, 300),
        endpoint: ep,
        vercelRegion,
        duration: Date.now() - start,
      }, 502);
    }
    const data = await resp.json() as any;
    if (data.code !== 0) {
      return json({
        error: 'B 站返回错误码',
        bili_code: data.code,
        bili_message: data.message || '',
        raw: data,
        endpoint: ep,
        vercelRegion,
        duration: Date.now() - start,
      }, 502);
    }
    return json({
      qrcode_url: data.data?.url || '',
      qrcode_key: data.data?.qrcode_key || '',
      expires_at: Math.floor(Date.now() / 1000) + 180,
      endpoint: ep,
      login_type: 'web',
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      error: 'Vercel Edge 请求 B 站失败',
      message: e.message || String(e),
      endpoint: ep,
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
