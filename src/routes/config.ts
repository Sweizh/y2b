// 配置路由：GET/PUT /api/config

import { Hono } from 'hono';
import { getRawConfig, putConfig, maskConfig } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 获取配置（脱敏）
app.get('/', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  return c.json(maskConfig(cfg));
});

// 更新配置(白名单字段,防止注入任意字段)
app.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const existing = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');

  // 允许更新的字段白名单(admin_password/pipeline_token/initialized 不在此列)
  // yt_access_token/refresh_token 等通过 OAuth 流程自动写入,不在此列
  const ALLOWED_FIELDS = [
    'bili_sessdata', 'bili_jct', 'bili_buvid3', 'ac_time_value',
    'yt_api_key', 'yt_cookies',
    'yt_client_id', 'yt_client_secret', 'yt_redirect_uri',  // OAuth 客户端配置(管理员手动填)
    'gh_token', 'gh_repo',
    'asr_api', 'asr_key', 'translate_api', 'translate_key',
    'notify_webhook',
    'title_template',  // 标题翻译模板(非敏感文本,不脱敏不加密)
  ];
  const merged: any = { ...existing };
  for (const f of ALLOWED_FIELDS) {
    if (body[f] === undefined) continue;
    const v = body[f];
    // 前端可能传脱敏字段(含 ****),表示用户未修改该字段,保留原值
    if (typeof v === 'string' && v.includes('****')) continue;
    // 显式传 null/空串表示清空
    merged[f] = v === null ? '' : String(v);
  }

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
