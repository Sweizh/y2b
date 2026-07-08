// Vercel Edge Function:代理 B 站 nav 接口(用 SESSDATA 验证登录态 + 取 uname)
// 目的:绕过 Cloudflare Worker IP 对 api.bilibili.com 的 -412 风控
//
// 路由:POST /bili/nav
//   body: { sessdata, bili_jct?, buvid3? }
// 返回:nav 接口的原始 JSON(透传),或 { error, ... }
//
// 安全说明:本函数接收 SESSDATA(敏感凭证),但:
//   1. 只做透传调 nav 接口,不存储不记录
//   2. Vercel Edge Function 日志默认不记录 body
//   3. 这是用户自己的 Vercel 项目,数据不出信任域

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BILI_NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS' } });
  }
  const start = Date.now();
  const vercelRegion = req.headers.get('x-vercel-id') || 'unknown';
  try {
    const body = await req.json() as { sessdata?: string; bili_jct?: string; buvid3?: string };
    const sessdata = body?.sessdata || '';
    if (!sessdata) {
      return json({ error: '缺少 sessdata', vercelRegion, duration: Date.now() - start }, 400);
    }
    const cookie = `SESSDATA=${sessdata}; bili_jct=${body.bili_jct || ''}; buvid3=${body.buvid3 || ''}`;
    const resp = await fetch(BILI_NAV_URL, {
      headers: { 'Cookie': cookie, 'User-Agent': UA },
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await resp.text();
      return json({
        error: 'B 站返回非 JSON',
        status: resp.status,
        contentType: ct,
        bodyPreview: text.slice(0, 200),
        vercelRegion,
        duration: Date.now() - start,
      }, 502);
    }
    const data = await resp.json();
    // 透传 nav 接口响应(不加工,让调用方按原逻辑解析)
    return json({
      nav: data,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      error: 'Vercel Edge 请求 nav 失败',
      message: e.message || String(e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
