// Vercel Edge Function:代理 B 站创作中心合集视频列表接口
// 复用 bili-seasons.ts 的极简结构(已验证可工作)

export const config = { runtime: 'edge' };

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
  // 临时诊断:直接 echo 回请求体,不调 B 站,验证 Edge Function 是否部署成功
  try {
    const body = await req.json();
    return json({ echo: true, received: body, ts: Date.now() });
  } catch (e: any) {
    return json({ echo: true, error: e.message || String(e), ts: Date.now() });
  }
}
