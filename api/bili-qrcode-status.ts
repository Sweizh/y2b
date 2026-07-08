// Vercel Edge Function:代理 B 站二维码扫码状态轮询接口
// 目的:验证 Vercel 出口 IP 能否完成扫码登录全流程
//
// 路由:GET /bili/qrcode-status?qrcode_key=xxx (经 vercel.json rewrite 到 /api/bili-qrcode-status)
// 返回:
//   { status: 'waiting'|'scanned'|'success'|'expired'|'error', message?, ... }
//
// 不使用 Hono:单端点代理函数,原生 Web API 更简单可靠

export const config = { runtime: 'edge' };

const BILI_QRCODE_INFO = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
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
  const url = new URL(req.url);
  const qrcodeKey = url.searchParams.get('qrcode_key');
  if (!qrcodeKey) {
    return json({ status: 'error', message: '缺少 qrcode_key 参数' }, 400);
  }
  try {
    const resp = await fetch(`${BILI_QRCODE_INFO}?qrcode_key=${encodeURIComponent(qrcodeKey)}`, {
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
        vercelRegion,
        duration: Date.now() - start,
      });
    }
    const data = await resp.json() as any;
    // poll 接口返回结构:{"code":0,"data":{"code":86101|86090|86039,...}}
    const dataCode = data?.data?.code;
    if (dataCode === 86101) {
      return json({ status: 'waiting', message: data?.data?.message || '等待扫码', vercelRegion, duration: Date.now() - start });
    }
    if (dataCode === 86090) {
      const crossDomainUrl = data?.data?.url;
      if (!crossDomainUrl) {
        return json({ status: 'scanned', message: '已扫码,请在手机上确认', vercelRegion, duration: Date.now() - start });
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
        vercelRegion,
        duration: Date.now() - start,
      });
    }
    if (dataCode === 86039) {
      return json({ status: 'expired', message: '二维码已过期', vercelRegion, duration: Date.now() - start });
    }
    // 风控或其他错误
    return json({
      status: 'error',
      message: data?.data?.message || `未知状态码 ${dataCode}`,
      bili_code: data?.code,
      bili_data_code: dataCode,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      status: 'error',
      message: 'Vercel Edge 请求 B 站失败: ' + (e.message || e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
