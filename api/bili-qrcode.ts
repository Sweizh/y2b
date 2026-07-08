// Vercel Edge Function:代理 B 站二维码生成接口
// 目的:验证 Vercel 出口 IP 能否绕过 B 站对 Cloudflare Worker IP 的风控
//
// 路由:GET /bili/qrcode?endpoint=bilibili|biligame
//   - bilibili(默认):passport.bilibili.com
//   - biligame:passport.biligame.com(DSA CDN,不同 IP 段)
// 返回:{ qrcode_url, qrcode_key, expires_at, endpoint } 或 { error, ... }
//
// 不使用 Hono:单端点代理函数,原生 Web API 更简单可靠

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ENDPOINTS: Record<string, string> = {
  bilibili: 'passport.bilibili.com',
  biligame: 'passport.biligame.com',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // CORS:允许任意来源调用(本函数只返回公开的二维码数据,无敏感信息/cookie)
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' } });
  }
  const start = Date.now();
  const vercelRegion = req.headers.get('x-vercel-id') || 'unknown';
  const url = new URL(req.url);
  const ep = url.searchParams.get('endpoint') || 'bilibili';
  const host = ENDPOINTS[ep] || ENDPOINTS.bilibili;
  const biliUrl = `https://${host}/x/passport-login/web/qrcode/generate`;
  try {
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
      // 风控典型返回:{"code":-412,"message":"request was banned"}
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
    // 成功:返回二维码 URL + key + 过期时间
    return json({
      qrcode_url: data.data?.url || '',
      qrcode_key: data.data?.qrcode_key || '',
      expires_at: Math.floor(Date.now() / 1000) + 180,
      endpoint: ep,
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
