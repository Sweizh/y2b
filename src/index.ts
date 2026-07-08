// Cloudflare Worker 入口
// 框架：Hono
// 鉴权：管理接口用 Session Cookie，Pipeline 接口用 Bearer Token

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';
import { getRawConfig } from './kv';
import { getSessionFromRequest, getSession } from './auth';
import authRoutes from './routes/auth';
import configRoutes from './routes/config';
import channelRoutes from './routes/channels';
import biliRoutes from './routes/bili';
import biliLoginRoutes from './routes/bili_login';
import youtubeRoutes from './routes/youtube';
import youtubeOAuthRoutes from './routes/youtube_oauth';
import statusRoutes from './routes/status';
import processedRoutes from './routes/processed';
import manualRoutes from './routes/manual';
import testRoutes from './routes/tests';
import pipelineRoutes from './routes/pipeline';

// 静态资源 manifest:文件名 → 哈希文件名映射
// 例: { "index.html": "index.375bd5c05f.html" }
const assetManifest = JSON.parse(manifestJSON);

type AppVars = {
  requestId: string;
  requestStart: number;
};
const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

// 结构化日志辅助
function logEvent(event: string, status: string, extra: Record<string, any> = {}) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    status,
    ...extra,
  }));
}

// 暴露给路由模块使用
app.use('*', async (c, next) => {
  // 生成 requestId 注入到 c.var,便于路由内取用
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const start = Date.now();
  c.set('requestId', requestId);
  c.set('requestStart', start);
  await next();
  // 请求结束输出访问日志(只对 /api/ 路径)
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/')) {
    logEvent('request', c.res.status < 400 ? 'ok' : 'error', {
      requestId,
      method: c.req.method,
      path: url.pathname,
      status: c.res.status,
      duration: Date.now() - start,
    });
  }
});

// 全局中间件
// SEC-06: 显式配置 CSP,阻断 XSS 外泄数据到外部域(connect-src 'self')、防点击劫持(frame-ancestors 'none')
// 注:scriptSrc 暂保留 'unsafe-inline'(console.html 有大量内联事件处理器,后续逐步收敛为 nonce)
// 即便允许内联脚本,connect-src 'self' 仍能阻断注入的 fetch 外泄凭证
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],  // unpkg: Lucide 图标库
    styleSrc: ["'self'", "'unsafe-inline'"],  // Tailwind 内联样式
    imgSrc: ["'self'", 'data:', 'https:'],     // YouTube 头像等外部图
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],                     // 关键:阻断 XSS 向外部域外泄
    frameAncestors: ["'none'"],                 // 防点击劫持
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
}));
// CORS:仅在显式配置 ALLOWED_ORIGINS 时启用跨域,且使用白名单
// 默认行为:同源(不返回 ACAO 头),浏览器自动允许同源请求
// 配置示例:ALLOWED_ORIGINS="https://y2b.sweizh.top,https://yt2bili.xxx.workers.dev"
app.use('*', cors({
  origin: (origin, c) => {
    const allowed = (c.env as any).ALLOWED_ORIGINS;
    if (!allowed) return null;  // 不返回 ACAO,等同禁用跨域
    const list = allowed.split(',').map((s: string) => s.trim());
    return list.indexOf(origin) >= 0 ? origin : null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
}));

// 健康检查
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// 鉴权中间件：除白名单路径外都需要登录
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/login',
  '/api/logout',
  '/api/init-status',
  '/api/config/init',
  // SEC-02: /start 改为需要登录(弹窗由管理员同源打开,Strict Cookie 会发送)
  // /callback 仍公开(Google 重定向跨站导航,Strict Cookie 不发送),用 state 绑定 session 校验
  '/api/youtube/oauth/callback',
]);
const PIPELINE_PREFIX = '/api/pipeline';
const PIPELINE_PUBLIC_PATHS = [
  // Pipeline 路由下的子路径,允许 Pipeline Token 访问(由 pipeline 路由内部校验)
];

app.use('/api/*', async (c, next) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  // Pipeline 接口由 pipeline 路由内部校验 Bearer Token，这里跳过
  if (path.startsWith(PIPELINE_PREFIX)) {
    return next();
  }
  // 公开接口跳过
  if (PUBLIC_PATHS.has(path)) {
    return next();
  }
  // SEC-05: CSRF 纵深防御 — 状态变更方法校验 Origin/Referer 同源
  // SameSite=Strict 是主防线,此处为第二道防线(CORS 配错/老旧浏览器场景)
  const method = c.req.method.toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const originHdr = c.req.header('Origin') || c.req.header('Referer') || '';
    let isAllowed = false;
    if (!originHdr) {
      // 无 Origin/Referer:非浏览器请求或同源表单,放行(依赖 SameSite Cookie 兜底)
      isAllowed = true;
    } else {
      try {
        const u = new URL(originHdr);
        isAllowed = u.host === url.host;
        // 或在 ALLOWED_ORIGINS 白名单中
        if (!isAllowed) {
          const allowed = (c.env as any).ALLOWED_ORIGINS;
          if (allowed) {
            const list = allowed.split(',').map((s: string) => s.trim());
            isAllowed = list.indexOf(u.origin) >= 0;
          }
        }
      } catch {
        isAllowed = false;
      }
    }
    if (!isAllowed) {
      logEvent('csrf', 'denied', { method, path, origin: originHdr.slice(0, 100) });
      return c.json({ error: '跨站请求被拒绝', code: 'CSRF_DENIED' }, 403);
    }
  }
  // 校验 Session
  const sessionId = getSessionFromRequest(c.req.raw);
  const ok = await getSession(c.env.YT2BILI_KV, sessionId);
  if (!ok) {
    return c.json({ error: '未登录', code: 'UNAUTHORIZED' }, 401);
  }
  await next();
});

// API 路由挂载
app.route('/api', authRoutes);
app.route('/api/config', configRoutes);
app.route('/api/channels', channelRoutes);
app.route('/api', biliRoutes);          // /api/seasons /api/tids /api/test/bili
app.route('/api/bili/login', biliLoginRoutes);  // /api/bili/login/qrcode /api/bili/login/qrcode/status /api/bili/login/logout
app.route('/api/youtube', youtubeRoutes);
app.route('/api/youtube/oauth', youtubeOAuthRoutes);  // /api/youtube/oauth/start /callback /refresh
app.route('/api/status', statusRoutes);
app.route('/api/processed', processedRoutes);
app.route('/api/manual-queue', manualRoutes);
app.route('/api/test', testRoutes);     // /api/test/asr /api/test/translate /api/test/github
app.route('/api/pipeline', pipelineRoutes);

// 静态资源服务（前端 HTML）
// 用 @cloudflare/kv-asset-handler 的 getAssetFromKV 读取
// 它会通过 manifest 自动映射哈希文件名（如 index.html → index.375bd5c05f.html）
async function serveStatic(c: any, path: string) {
  try {
    // 构造请求 URL,让 getAssetFromKV 根据 path 查找资源
    const url = new URL(c.req.url);
    url.pathname = path === '/' ? '/index.html' : path;
    const modifiedRequest = new Request(url.toString(), c.req.raw);
    return await getAssetFromKV(
      {
        request: modifiedRequest,
        waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
      },
      {
        ASSET_NAMESPACE: c.env.__STATIC_CONTENT,
        ASSET_MANIFEST: assetManifest,
      }
    );
  } catch (e) {
    return c.notFound();
  }
}

app.get('/', (c) => serveStatic(c, '/'));
app.get('/index.html', (c) => serveStatic(c, '/index.html'));
app.get('/login.html', (c) => serveStatic(c, '/login.html'));
app.get('/console.html', (c) => serveStatic(c, '/console.html'));
// 静态构建产物:CSS / JS bundle
app.get('/css/*', (c) => serveStatic(c, new URL(c.req.url).pathname));
app.get('/js/*', (c) => serveStatic(c, new URL(c.req.url).pathname));

// 404 兜底
app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  // 非_api 路径返回 404 页面,避免重定向循环
  return c.json({ error: 'Not Found', path }, 404);
});

// 全局错误处理
app.onError((err, c) => {
  const requestId = c.get('requestId') || crypto.randomUUID();
  const start = c.get('requestStart') || Date.now();
  const url = new URL(c.req.url);
  // 详细错误写入日志(含 stack),但仅向客户端返回 requestId,不泄露内部细节
  logEvent('error', 'exception', {
    requestId,
    method: c.req.method,
    path: url.pathname,
    duration: Date.now() - start,
    error: err.message,
    stack: err.stack,
  });
  return c.json({
    error: 'Internal Server Error',
    requestId,
  }, 500);
});

export default app;
