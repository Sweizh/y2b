// Cloudflare Worker 入口
// 框架：Hono
// 鉴权：管理接口用 Session Cookie，Pipeline 接口用 Bearer Token

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
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

const app = new Hono<{ Bindings: Env }>();

// 全局中间件
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin) => origin || '*',  // 同源
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
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
// 通过 [site] 配置从 __STATIC_CONTENT KV 读取
async function serveStatic(c: any, path: string, contentType: string) {
  const key = path === '/' ? 'index.html' : path.replace(/^\//, '');
  // 兼容 [site] bucket 中带或不带前缀斜杠
  const value = await c.env.__STATIC_CONTENT.get(key, 'arrayBuffer');
  if (!value) {
    return c.notFound();
  }
  return new Response(value, {
    headers: {
      'Content-Type': contentType + '; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

app.get('/', (c) => serveStatic(c, '/', 'text/html'));
app.get('/index.html', (c) => serveStatic(c, 'index.html', 'text/html'));
// 中文字符串 URL 编码后的路径
app.get('/登录.html', (c) => serveStatic(c, '登录.html', 'text/html'));
app.get('/控制台.html', (c) => serveStatic(c, '控制台.html', 'text/html'));

// 404 兜底
app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  // 非 API 路径尝试重定向到首页
  return c.redirect('/');
});

// 全局错误处理
app.onError((err, c) => {
  console.error('[error]', err);
  return c.json({
    error: err.message || 'Internal Server Error',
  }, 500);
});

export default app;
