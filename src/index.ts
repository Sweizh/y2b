// Cloudflare Worker 入口
// 框架：Hono
// 鉴权：管理接口用 Session Cookie，Pipeline 接口用 Bearer Token

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';
import { getRawConfig } from './kv';
import { getSessionFromRequest } from './auth';
import authRoutes from './routes/auth';
import configRoutes from './routes/config';
import channelRoutes from './routes/channels';
import biliRoutes from './routes/bili';
import youtubeRoutes from './routes/youtube';
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
app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin) => origin || '*',  // 同源
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
]);
const PIPELINE_PREFIX = '/api/pipeline';

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // Pipeline 接口由 pipeline 路由内部校验 Bearer Token，这里跳过
  if (path.startsWith(PIPELINE_PREFIX)) {
    return next();
  }
  // 公开接口跳过
  if (PUBLIC_PATHS.has(path)) {
    return next();
  }
  // 校验 Session
  const sessionId = getSessionFromRequest(c.req.raw);
  const { getSession } = await import('./auth');
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
app.route('/api/youtube', youtubeRoutes);
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
  logEvent('error', 'exception', {
    requestId,
    method: c.req.method,
    path: url.pathname,
    duration: Date.now() - start,
    error: err.message,
    stack: err.stack,
  });
  return c.json({
    error: err.message || 'Internal Server Error',
    requestId,
  }, 500);
});

export default app;
