// 配置路由：GET/PUT /api/config

import { Hono } from 'hono';
import { getRawConfig, putConfig, maskConfig } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 获取配置（脱敏）
app.get('/', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  return c.json(maskConfig(cfg));
});

// 更新配置
app.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const existing = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');

  // 前端可能传脱敏字段（含 ****），表示用户未修改该字段，保留原值
  const merged: any = { ...existing };
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' && v.includes('****')) {
      // 保留原值
      continue;
    }
    merged[k] = v;
  }

  // admin_password 不通过此接口修改
  delete merged.admin_password;
  delete merged.pipeline_token;
  delete merged.initialized;

  await putConfig(c.env.YT2BILI_KV, merged, c.env.ENCRYPTION_KEY || '');
  return c.json({ success: true });
});

// 获取 pipeline_token（用于复制到 GitHub Secrets）
app.get('/pipeline-token', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.pipeline_token) {
    return c.json({ error: '未生成' }, 404);
  }
  return c.json({ pipeline_token: cfg.pipeline_token });
});

// 重置 pipeline_token
app.post('/pipeline-token/reset', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  const newToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await putConfig(c.env.YT2BILI_KV, { ...cfg, pipeline_token: newToken }, c.env.ENCRYPTION_KEY || '');
  return c.json({ pipeline_token: newToken });
});

export default app;
