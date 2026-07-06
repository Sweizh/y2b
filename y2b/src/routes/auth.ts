// 鉴权路由：登录 + 初始化

import { Hono } from 'hono';
import { getRawConfig, putConfig, generateToken } from '../kv';
import {
  createSession, destroySession, hashPassword, verifyPassword,
  getSessionFromRequest, getSessionCookieHeader, getClearSessionCookieHeader,
} from '../auth';

function log(event: string, status: string, extra: Record<string, any> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, status, ...extra }));
}

const app = new Hono<{ Bindings: Env }>();

// 检查是否已初始化
app.get('/init-status', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  return c.json({ initialized: !!cfg.initialized });
});

// 首次初始化：设置管理密码
app.post('/config/init', async (c) => {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const start = Date.now();
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (cfg.initialized) {
    log('init', 'rejected', { requestId, reason: 'already_initialized', duration: Date.now() - start });
    return c.json({ error: '系统已初始化，请直接登录' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const password = body.password;
  if (!password || typeof password !== 'string' || password.length < 8) {
    log('init', 'rejected', { requestId, reason: 'weak_password', duration: Date.now() - start });
    return c.json({ error: '密码至少 8 位' }, 400);
  }
  const hashed = await hashPassword(password);
  const pipelineToken = generateToken();
  await putConfig(c.env.YT2BILI_KV, {
    ...cfg,
    admin_password: hashed,
    pipeline_token: pipelineToken,
    initialized: true,
  }, c.env.ENCRYPTION_KEY || '');
  const sessionId = await createSession(c.env.YT2BILI_KV);
  c.header('Set-Cookie', getSessionCookieHeader(sessionId));
  log('init', 'success', { requestId, duration: Date.now() - start });
  return c.json({
    success: true,
    pipeline_token: pipelineToken,  // 仅初始化时返回一次
    message: '初始化成功',
  });
});

// 登录
app.post('/login', async (c) => {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const start = Date.now();
  const body = await c.req.json().catch(() => ({}));
  const password = body.password;
  if (!password) {
    log('login', 'rejected', { requestId, reason: 'no_password', duration: Date.now() - start });
    return c.json({ error: '请输入密码' }, 400);
  }
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.initialized) {
    log('login', 'rejected', { requestId, reason: 'not_initialized', duration: Date.now() - start });
    return c.json({ error: '系统未初始化' }, 400);
  }
  const ok = await verifyPassword(password, cfg.admin_password || '');
  if (!ok) {
    log('login', 'failed', { requestId, reason: 'wrong_password', duration: Date.now() - start });
    return c.json({ error: '密码错误' }, 401);
  }
  const sessionId = await createSession(c.env.YT2BILI_KV);
  c.header('Set-Cookie', getSessionCookieHeader(sessionId));
  log('login', 'success', { requestId, duration: Date.now() - start });
  return c.json({ success: true });
});

// 登出
app.post('/logout', async (c) => {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const sessionId = getSessionFromRequest(c.req.raw);
  if (sessionId) {
    await destroySession(c.env.YT2BILI_KV, sessionId);
  }
  c.header('Set-Cookie', getClearSessionCookieHeader());
  log('logout', 'success', { requestId });
  return c.json({ success: true });
});

export default app;
