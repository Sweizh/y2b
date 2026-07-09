// Vercel Edge Function:代理 B 站创作中心合集视频列表接口
// 复用 bili-seasons.ts 的极简结构(已验证可工作)

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    const body = await req.json() as { sessdata?: string; bili_jct?: string; buvid3?: string; season_id?: string };
    const sessdata = body?.sessdata || '';
    const biliJct = body?.bili_jct || '';
    const buvid3 = body?.buvid3 || '';
    const seasonId = body?.season_id || '';
    if (!sessdata || !biliJct) {
      return json({ error: '缺少 sessdata 或 bili_jct', vercelRegion, duration: Date.now() - start }, 400);
    }
    if (!seasonId) {
      return json({ error: '缺少 season_id', vercelRegion, duration: Date.now() - start }, 400);
    }
    const cookie = `SESSDATA=${sessdata}; bili_jct=${biliJct}; buvid3=${buvid3}`;
    const url = `https://member.bilibili.com/x2/creative/web/season/episodes?season_id=${seasonId}&pn=1&ps=30`;
    const resp = await fetch(url, {
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
      episodes: data,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      error: 'Vercel Edge 请求 season episodes 失败',
      message: e.message || String(e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
