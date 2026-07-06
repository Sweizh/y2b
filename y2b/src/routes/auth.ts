// 鉴权路由：登录 + 初始化

import { Hono } from 'hono';
import { getRawConfig, putConfig, generateToken } from '../kv';
import {
  createSession, destroySession, hashPassword, verifyPassword,
  getSessionFromRequest, getSessionCookieHeader, getClearSessionCookieHeader,
} from '../auth';

const app = new Hono<{ Bindings: Env }>();

// 检查是否已初始化
app.get('/init-status', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  return c.json({ initialized: !!cfg.initialized });
});

// 首次初始化：设置管理密码
app.post('/config/init', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (cfg.initialized) {
    return c.json({ error: '系统已初始化，请直接登录' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const password = body.password;
  if (!password || typeof password !== 'string' || password.length < 8) {
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
  // 创建 session
  const sessionId = await createSession(c.env.YT2BILI_KV);
  c.header('Set-Cookie', getSessionCookieHeader(sessionId));
  return c.json({
    success: true,
    pipeline_token: pipelineToken,  // 仅初始化时返回一次
    message: '初始化成功',
  });
});

// 登录
app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = body.password;
  if (!password) {
    return c.json({ error: '请输入密码' }, 400);
  }
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.initialized) {
    return c.json({ error: '系统未初始化' }, 400);
  }
  const ok = await verifyPassword(password, cfg.admin_password || '');
  if (!ok) {
    return c.json({ error: '密码错误' }, 401);
  }
  const sessionId = await createSession(c.env.YT2BILI_KV);
  c.header('Set-Cookie', getSessionCookieHeader(sessionId));
  return c.json({ success: true });
});

// 登出
app.post('/logout', async (c) => {
  const sessionId = getSessionFromRequest(c.req.raw);
  if (sessionId) {
    await destroySession(c.env.YT2BILI_KV, sessionId);
  }
  c.header('Set-Cookie', getClearSessionCookieHeader());
  return c.json({ success: true });
});

export default app;
