// Pipeline 路由（供 GitHub Actions Runner 调用）
// 鉴权：Authorization: Bearer <pipeline_token>

import { Hono } from 'hono';
import {
  getRawConfig, putConfig, getChannels, getManualQueue, putManualQueue,
  getProcessed, putProcessed, getStatus, putStatus,
  type ProcessedItem, type StatusRecord,
} from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 鉴权中间件
app.use('*', async (c, next) => {
  const auth = c.req.header('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) {
    return c.json({ error: '缺少 Authorization Bearer Token' }, 401);
  }
  const token = m[1];
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.pipeline_token) {
    return c.json({ error: 'pipeline_token 未配置' }, 500);
  }
  if (token !== cfg.pipeline_token) {
    return c.json({ error: 'Pipeline Token 无效' }, 401);
  }
  await next();
});

// 拉取全部配置 + 频道 + 去重表 + 手动队列
app.get('/config', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  const channels = await getChannels(c.env.YT2BILI_KV);
  const manualQueue = await getManualQueue(c.env.YT2BILI_KV);
  const processed = await getProcessed(c.env.YT2BILI_KV);
  // 删除 admin_password 和 pipeline_token（敏感）
  const safeConfig = { ...cfg };
  delete safeConfig.admin_password;
  delete safeConfig.pipeline_token;
  return c.json({
    config: safeConfig,
    channels,
    manual_queue: manualQueue,
    processed,
  });
});

// 回写处理结果（批量），同时清理 manual_queue 中已处理项
app.post('/processed', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const results: any[] = body.results || [];
  if (!Array.isArray(results)) {
    return c.json({ error: 'results 必须为数组' }, 400);
  }
  const [processed, manualQueue, status] = await Promise.all([
    getProcessed(c.env.YT2BILI_KV),
    getManualQueue(c.env.YT2BILI_KV),
    getStatus(c.env.YT2BILI_KV),
  ]);
  const now = Date.now();
  // 处理结果映射到 manual_queue 清理
  const processedIds = new Set<string>();
  const cleanedManualQueue = [...manualQueue];

  for (const r of results) {
    if (!r.video_id) continue;
    const item: ProcessedItem = {
      video_id: r.video_id,
      bvid: r.bvid || '',
      title: r.title || '',
      channel: r.channel || '',
      channel_id: r.channel_id || '',
      status: r.status === 'success' ? 'success' : 'failed',
      stage: r.stage || '',
      message: r.message || '',
      processed_at: now,
    };
    processed[r.video_id] = item;
    processedIds.add(r.video_id);
    // 处理 manual_queue 清理逻辑
    if (r.status === 'success') {
      // 从 manual_queue 移除
      const idx = cleanedManualQueue.findIndex(q => q.video_id === r.video_id);
      if (idx >= 0) cleanedManualQueue.splice(idx, 1);
    } else if (r.retryable === true) {
      // 可重试，保留在队列
      const idx = cleanedManualQueue.findIndex(q => q.video_id === r.video_id);
      if (idx >= 0) {
        cleanedManualQueue[idx].status = 'retry';
        cleanedManualQueue[idx].retry_count = (cleanedManualQueue[idx].retry_count || 0) + 1;
        cleanedManualQueue[idx].last_error = r.message || '';
        // 超过 3 次移除
        if (cleanedManualQueue[idx].retry_count! > 3) {
          cleanedManualQueue.splice(idx, 1);
        }
      }
    } else {
      // 不可重试的失败，从 manual_queue 移除
      const idx = cleanedManualQueue.findIndex(q => q.video_id === r.video_id);
      if (idx >= 0) cleanedManualQueue.splice(idx, 1);
    }
  }
  // 更新状态记录
  const newRecords = results.map(r => ({
    channel: r.channel || '',
    video_title: r.title || '',
    status: r.status === 'success' ? 'success' as const : 'failed' as const,
    stage: r.stage || '',
    message: r.message || '',
    processed_at: now,
  }));
  status.recent_records = [...newRecords, ...(status.recent_records || [])].slice(0, 100);
  status.last_run_at = now;
  status.total_processed = (status.total_processed || 0) + results.filter(r => r.status === 'success').length;
  // Cookie 状态
  const hasCookieError = results.some(r =>
    r.message && r.message.includes('Cookie')
  );
  if (hasCookieError) {
    status.cookie_status = 'expired';
    status.system_status = 'degraded';
  } else {
    status.cookie_status = 'ok';
    status.system_status = 'normal';
  }
  await Promise.all([
    putProcessed(c.env.YT2BILI_KV, processed),
    putManualQueue(c.env.YT2BILI_KV, cleanedManualQueue),
    putStatus(c.env.YT2BILI_KV, status),
  ]);
  return c.json({
    success: true,
    processed_count: results.length,
    cleaned_manual_count: manualQueue.length - cleanedManualQueue.length,
  });
});

// 回写运行状态
app.post('/status', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const existing = await getStatus(c.env.YT2BILI_KV);
  const updated: StatusRecord = {
    ...existing,
    ...body,
    last_run_at: body.last_run_at || Date.now(),
  };
  await putStatus(c.env.YT2BILI_KV, updated);
  return c.json({ success: true });
});

// 回写刷新后的 Cookie（ac_time_value 续期）
app.post('/cookies', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  const merged: any = { ...cfg };
  // 只允许更新 B 站凭证字段
  if (body.bili_sessdata) merged.bili_sessdata = body.bili_sessdata;
  if (body.bili_jct) merged.bili_jct = body.bili_jct;
  if (body.bili_buvid3) merged.bili_buvid3 = body.bili_buvid3;
  if (body.ac_time_value) merged.ac_time_value = body.ac_time_value;
  await putConfig(c.env.YT2BILI_KV, merged, c.env.ENCRYPTION_KEY || '');
  return c.json({ success: true });
});

export default app;
