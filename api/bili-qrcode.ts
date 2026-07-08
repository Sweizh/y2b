// Vercel Edge Function:代理 B 站二维码生成接口
// 目的:验证 Vercel 出口 IP 能否绕过 B 站对 Cloudflare Worker IP 的风控
// 逻辑从 src/routes/bili_login.ts L44-75 抽取,去掉 KV/env 依赖
//
// 路由:GET /bili/qrcode (经 vercel.json rewrite 到 /api/bili-qrcode)
// 返回:{ qrcode_url, qrcode_key, expires_at } 或 { error, bili_code, bili_message, status }

import { handle } from 'hono/vercel';
import { Hono } from 'hono';

export const config = { runtime: 'edge' };

const app = new Hono();

const BILI_QRCODE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// B 站 passport 端点请求头:只带 UA,不带 Referer/Origin/Cookie
// (实测:带这些头会被 B 站风控 -412,与 Cloudflare Worker 上的规避策略一致)
const BILI_PASSPORT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
};

app.get('/', async (c) => {
  const start = Date.now();
  const vercelRegion = c.req.header('x-vercel-id') || 'unknown';
  try {
    const resp = await fetch(BILI_QRCODE_URL, {
      headers: BILI_PASSPORT_HEADERS,
      redirect: 'manual',
    });
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const body = await resp.text();
      return c.json({
        error: `B 站返回非 JSON`,
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
      return c.json({
        error: 'B 站返回错误码',
        bili_code: data.code,
        bili_message: data.message || '',
        raw: data,
        vercelRegion,
        duration: Date.now() - start,
      }, 502);
    }
    // 成功:返回二维码 URL + key + 过期时间
    return c.json({
      qrcode_url: data.data?.url || '',
      qrcode_key: data.data?.qrcode_key || '',
      expires_at: Math.floor(Date.now() / 1000) + 180,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return c.json({
      error: 'Vercel Edge 请求 B 站失败',
      message: e.message || String(e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
});

export default handle(app);
