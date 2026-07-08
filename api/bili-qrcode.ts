// Vercel Edge Function:代理 B 站二维码生成接口
// 目的:验证 Vercel 出口 IP 能否绕过 B 站对 Cloudflare Worker IP 的风控
//
// 路由:GET /bili/qrcode (经 vercel.json rewrite 到 /api/bili-qrcode)
// 返回:{ qrcode_url, qrcode_key, expires_at } 或 { error, ... }
//
// 不使用 Hono:这些是单端点代理函数,原生 Web API 更简单可靠,
// 避免路由匹配问题(Hono Vercel 适配器传完整路径,app.get('/') 无法匹配 /api/bili-qrcode)

export const config = { runtime: 'edge' };

const BILI_QRCODE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const start = Date.now();
  const vercelRegion = req.headers.get('x-vercel-id') || 'unknown';
  try {
    const resp = await fetch(BILI_QRCODE_URL, {
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
        vercelRegion,
        duration: Date.now() - start,
      }, 502);
    }
    // 成功:返回二维码 URL + key + 过期时间
    return json({
      qrcode_url: data.data?.url || '',
      qrcode_key: data.data?.qrcode_key || '',
      expires_at: Math.floor(Date.now() / 1000) + 180,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      error: 'Vercel Edge 请求 B 站失败',
      message: e.message || String(e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
