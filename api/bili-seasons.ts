// Vercel Edge Function:代理 B 站创作中心 seasons 接口(合集列表)
// 目的:绕过 Cloudflare Worker IP 对 member.bilibili.com 的反爬(返回 HTML 登录页)
// 与 bili-nav.ts 同一模式:接收凭证,透传 B 站 API 响应
//
// 路由:POST /bili/seasons
//   body: { sessdata, bili_jct?, buvid3? }
// 返回:{ seasons: <B站原始JSON>, vercelRegion, duration } 或 { error, ... }

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// B 站创作中心 seasons 列表接口,两个域名都尝试(member.bilibili.com 主,api.bilibili.com 兜底)
const BILI_SEASONS_URLS = [
  'https://member.bilibili.com/x2/creative/web/seasons',
  'https://api.bilibili.com/x2/creative/web/seasons',
];
const FETCH_TIMEOUT_MS = 12000;

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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 安全解析 JSON:先读 text,strip BOM/前导空白,再 JSON.parse
// B 站某些接口返回带 BOM(\uFEFF)的 JSON,或 HTML 错误页但 content-type 谎称 JSON,
// 直接 resp.json() 会抛 "Unexpected non-whitespace character in JSON"
function safeParseJson(text: string): { ok: true; data: any } | { ok: false; error: string; preview: string } {
  const cleaned = text.replace(/^\uFEFF/, '').trimStart();
  if (!cleaned) {
    return { ok: false, error: '空响应 body', preview: '' };
  }
  try {
    return { ok: true, data: JSON.parse(cleaned) };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e), preview: cleaned.slice(0, 200) };
  }
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
    const headers = {
      'Cookie': cookie,
      'User-Agent': UA,
      'Referer': 'https://member.bilibili.com/platform/upload-manager/frame',
      'Origin': 'https://member.bilibili.com',
      'Accept': 'application/json, text/plain, */*',
    };

    // 依次尝试两个 URL,首个返回合法 JSON 的即用
    let lastError: any = null;
    for (const url of BILI_SEASONS_URLS) {
      let resp: Response;
      try {
        resp = await fetchWithTimeout(url, { headers }, FETCH_TIMEOUT_MS);
      } catch (e: any) {
        lastError = { stage: 'fetch', message: e.message || String(e), url };
        continue;
      }
      const ct = resp.headers.get('content-type') || '';
      const text = await resp.text();
      const parsed = safeParseJson(text);
      if (parsed.ok) {
        return json({
          seasons: parsed.data,
          vercelRegion,
          duration: Date.now() - start,
          sourceUrl: url,
        });
      }
      // JSON 解析失败:记录诊断,尝试下一个 URL
      const parseErr = parsed as { ok: false; error: string; preview: string };
      lastError = {
        stage: 'parse',
        message: parseErr.error,
        preview: parseErr.preview,
        status: resp.status,
        contentType: ct,
        url,
      };
    }
    // 所有 URL 都失败
    return json({
      error: 'Vercel Edge 请求 seasons 失败',
      message: lastError?.message || '所有 URL 均失败',
      ...(lastError?.preview ? { bodyPreview: lastError.preview } : {}),
      ...(lastError?.status ? { status: lastError.status } : {}),
      ...(lastError?.contentType ? { contentType: lastError.contentType } : {}),
      ...(lastError?.url ? { failedUrl: lastError.url } : {}),
      vercelRegion,
      duration: Date.now() - start,
    }, 502);
  } catch (e: any) {
    return json({
      error: 'Vercel Edge 请求 seasons 失败',
      message: e.message || String(e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
