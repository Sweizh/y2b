// 鉴权：session 管理 + bcrypt 密码校验 + pipeline token

import bcrypt from 'bcryptjs';

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 天（秒）
const SESSION_COOKIE = 'y2b_session';

// 内存中的 session 存储（Worker 实例级，重启会丢；生产环境建议改用 KV）
// 由于 Cloudflare Worker 是无状态的，多实例间会话不同步——但同一实例缓存命中率仍较高
// 简化处理：用 KV 存储 session
const SESSION_PREFIX = 'session:';

export async function createSession(kv: KVNamespace): Promise<string> {
  const sessionId = generateToken();
  const session = {
    created_at: Date.now(),
    expires_at: Date.now() + SESSION_TTL * 1000,
  };
  await kv.put(SESSION_PREFIX + sessionId, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });
  return sessionId;
}

export async function getSession(kv: KVNamespace, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const raw = await kv.get(SESSION_PREFIX + sessionId);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    if (session.expires_at && session.expires_at < Date.now()) {
      await kv.delete(SESSION_PREFIX + sessionId);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function destroySession(kv: KVNamespace, sessionId: string): Promise<void> {
  if (sessionId) {
    await kv.delete(SESSION_PREFIX + sessionId);
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

// 从 Cookie 头中解析 session
export function getSessionFromRequest(req: Request): string {
  const cookie = req.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? match[1] : '';
}

export function getSessionCookieHeader(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL}`;
}

export function getClearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function generateToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
