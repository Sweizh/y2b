// Vercel Edge Function:代理 B 站创作中心 seasons 接口(合集列表)
// 目的:绕过 Cloudflare Worker IP 对 member.bilibili.com 的反爬(返回 HTML 登录页)
// 与 bili-nav.ts 同一模式:接收凭证,透传 B 站 API 响应

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BILI_SEASONS_URL = 'https://member.bilibili.com/x2/creative/web/seasons?pn=1&ps=30';

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
    const biliJct = body?.bili_jct || '';
    const buvid3 = body?.buvid3 || '';
    if (!sessdata || !biliJct) {
      return json({ error: '缺少 sessdata 或 bili_jct', vercelRegion, duration: Date.now() - start }, 400);
    }
    const cookie = `SESSDATA=${sessdata}; bili_jct=${biliJct}; buvid3=${buvid3}`;
    const resp = await fetch(BILI_SEASONS_URL, {
      headers: {
        'Cookie': cookie,
        'User-Agent': UA,
        'Referer': 'https://member.bilibili.com/platform/upload-manager/frame',
        'Origin': 'https://member.bilibili.com',
        'Accept': 'application/json, text/plain, */*',
      },
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await resp.text();
      return json({
        error: 'B 站返回非 JSON(可能是 Cookie 失效或反爬)',
        status: resp.status,
        contentType: ct,
        bodyPreview: text.slice(0, 200),
        vercelRegion,
        duration: Date.now() - start,
      }, 502);
    }
    // 先读 text 再 parse,防止 B 站返回带 BOM/前导空白导致 resp.json() 抛 "Unexpected non-whitespace character"
    const text = await resp.text();
    let data: any;
    try {
      data = JSON.parse(text.replace(/^\uFEFF/, '').trimStart());
    } catch (e: any) {
      return json({
        error: 'B 站返回 JSON 解析失败',
        message: e.message || String(e),
        bodyPreview: text.slice(0, 200),
        vercelRegion,
        duration: Date.now() - start,
      }, 502);
    }
    return json({
      seasons: data,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      error: 'Vercel Edge 请求 seasons 失败',
      message: e.message || String(e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
