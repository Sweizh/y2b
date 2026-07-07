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
// 使用 KV 的 "init_lock" key 作为简单互斥:先尝试创建(若已存在则说明并发 init 在进行中)
// KV 的 put 不支持 CAS,这里用 "先 get lock 再 put config" 缩短竞态窗口
// lock 有 30s TTL,避免异常退出导致永久死锁
const INIT_LOCK_KEY = 'init_lock';
const INIT_LOCK_TTL = 30;

app.post('/config/init', async (c) => {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const start = Date.now();
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (cfg.initialized) {
    log('init', 'rejected', { requestId, reason: 'already_initialized', duration: Date.now() - start });
    return c.json({ error: '系统已初始化，请直接登录' }, 400);
  }
  // 互斥锁:尝试获取,已存在则拒绝
  const existingLock = await c.env.YT2BILI_KV.get(INIT_LOCK_KEY);
  if (existingLock) {
    log('init', 'rejected', { requestId, reason: 'concurrent_init', duration: Date.now() - start });
    return c.json({ error: '另一个初始化请求正在进行中,请稍后重试' }, 409);
  }
  // 写入 lock(带 TTL),Cloudflare KV 不保证 get 后立刻可见,但能拦截大多数并发
  await c.env.YT2BILI_KV.put(INIT_LOCK_KEY, requestId, { expirationTtl: INIT_LOCK_TTL });
  try {
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
  } finally {
    // 完成后释放 lock(也允许 TTL 自动过期兜底)
    await c.env.YT2BILI_KV.delete(INIT_LOCK_KEY);
  }
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
  const start = Date.now();
  const sessionId = getSessionFromRequest(c.req.raw);
  if (sessionId) {
    await destroySession(c.env.YT2BILI_KV, sessionId);
  }
  c.header('Set-Cookie', getClearSessionCookieHeader());
  log('logout', 'success', { requestId, duration: Date.now() - start });
  return c.json({ success: true });
});

export default app;
