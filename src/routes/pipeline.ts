// Pipeline 路由（供 GitHub Actions Runner 调用）
// 鉴权：Authorization: Bearer <pipeline_token>

import { Hono } from 'hono';
import {
  getRawConfig, putConfig, getChannels, getManualQueue, putManualQueue,
  getProcessed, putProcessed, getStatus, putStatus,
  type ProcessedItem, type StatusRecord,
} from '../kv';

const app = new Hono<{ Bindings: Env }>();

function log(event: string, status: string, extra: Record<string, any> = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, status, ...extra }));
}

// 鉴权中间件
app.use('*', async (c, next) => {
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const start = Date.now();
  const auth = c.req.header('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) {
    log('pipeline_auth', 'failed', { requestId, reason: 'no_bearer', path: new URL(c.req.url).pathname });
    return c.json({ error: '缺少 Authorization Bearer Token' }, 401);
  }
  const token = m[1];
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.pipeline_token) {
    log('pipeline_auth', 'failed', { requestId, reason: 'no_token_configured' });
    return c.json({ error: 'pipeline_token 未配置' }, 500);
  }
  // 常量时间比较,防止时序攻击
  if (!timingSafeEqual(token, cfg.pipeline_token)) {
    log('pipeline_auth', 'failed', { requestId, reason: 'invalid_token' });
    return c.json({ error: 'Pipeline Token 无效' }, 401);
  }
  c.header('x-request-id', requestId);
  log('pipeline_auth', 'success', { requestId, path: new URL(c.req.url).pathname, duration: Date.now() - start });
  await next();
});

// 常量时间字符串比较
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // 长度不同仍要做相同工作量比较,避免通过长度差异泄露信息
    const max = Math.max(a.length, b.length);
    let diff = 1;
    for (let i = 0; i < max; i++) {
      const av = a.charCodeAt(i % a.length);
      const bv = b.charCodeAt(i % b.length);
      diff |= av ^ bv;
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// 拉取全部配置 + 频道 + 去重表 + 手动队列
app.get('/config', async (c) => {
  const start = Date.now();
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  const channels = await getChannels(c.env.YT2BILI_KV);
  const manualQueue = await getManualQueue(c.env.YT2BILI_KV);
  const processed = await getProcessed(c.env.YT2BILI_KV);
  log('pipeline_pull', 'success', {
    requestId: c.req.header('x-request-id'),
    channels: channels.length,
    manualQueue: manualQueue.length,
    processed: Object.keys(processed).length,
    duration: Date.now() - start,
  });
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
      // 视频上传成功但字幕/合集失败:记录错误原因,供后续补传决策
      // 注意:status 仍为 success(视频已上线),这些是非致命错误
      subtitle_error: typeof r.subtitle_error === 'string' ? r.subtitle_error.slice(0, 500) : undefined,
      season_error: typeof r.season_error === 'string' ? r.season_error.slice(0, 500) : undefined,
    };
    processed[r.video_id] = item;
    // 处理 manual_queue 清理逻辑
    if (r.status === 'success') {
      // 成功:从 manual_queue 移除
      const idx = cleanedManualQueue.findIndex(q => q.video_id === r.video_id);
      if (idx >= 0) cleanedManualQueue.splice(idx, 1);
    } else if (r.retryable === true) {
      // 可重试:retry_count + 1,>=3 次移除(注释与实现一致:第 3 次失败即移除)
      const idx = cleanedManualQueue.findIndex(q => q.video_id === r.video_id);
      if (idx >= 0) {
        cleanedManualQueue[idx].status = 'retry';
        cleanedManualQueue[idx].retry_count = (cleanedManualQueue[idx].retry_count || 0) + 1;
        cleanedManualQueue[idx].last_error = r.message || '';
        cleanedManualQueue[idx].last_error_at = now;  // 冷却:下次拉取时 Worker 据此跳过近期失败项
        // retry_count >= 3 移除(避免无限重试累积)
        if ((cleanedManualQueue[idx].retry_count || 0) >= 3) {
          cleanedManualQueue.splice(idx, 1);
        }
      }
    } else {
      // 不可重试的失败,从 manual_queue 移除
      const idx = cleanedManualQueue.findIndex(q => q.video_id === r.video_id);
      if (idx >= 0) cleanedManualQueue.splice(idx, 1);
    }
  }
  // 更新状态记录
  // 对于"视频上传成功但字幕/合集失败"的情况,把非致命错误拼到 message 中展示
  const newRecords = results.map(r => {
    let msg = r.message || '';
    if (r.status === 'success') {
      const parts: string[] = [];
      if (r.subtitle_error) parts.push('字幕失败: ' + r.subtitle_error);
      if (r.season_error) parts.push('合集失败: ' + r.season_error);
      if (parts.length) msg = (msg ? msg + ' | ' : '') + parts.join(' | ');
    }
    return {
      channel: r.channel || '',
      video_title: r.title || '',
      status: r.status === 'success' ? 'success' as const : 'failed' as const,
      stage: r.stage || '',
      message: msg,
      processed_at: now,
    };
  });
  status.recent_records = [...newRecords, ...(status.recent_records || [])].slice(0, 100);
  status.last_run_at = now;
  status.total_processed = (status.total_processed || 0) + results.filter(r => r.status === 'success').length;
  // Cookie 状态:匹配 B 站常见的 Cookie/登录失效错误特征(中文 + 错误码 + 英文)
  // 原 "Cookie" 字符串匹配太窄,B 站 API 报错多为 "账号未登录" / "-101" 等
  const cookieErrorPatterns = [
    'cookie', 'sessdata', '未登录', '账号未登录', '登录失效', '登录已失效',
    'credential', 'csrf', '鉴权', '权限不足', '-101', '-111',
  ];
  const hasCookieError = results.some(r => {
    const msg = (r.message || '').toLowerCase();
    return cookieErrorPatterns.some(p => msg.includes(p));
  });
  if (hasCookieError) {
    status.cookie_status = 'expired';
    status.system_status = 'degraded';
  } else {
    // 不覆盖 'expiring'(由 Runner 通过 /status 主动上报)
    if (status.cookie_status !== 'expiring') {
      status.cookie_status = 'ok';
    }
    status.system_status = results.some(r => r.status !== 'success') ? 'degraded' : 'normal';
  }
  // 顺序写入:先 processed(最重要,防重复处理),再 manual_queue,最后 status
  // 避免 Promise.all 中部分失败导致状态不一致
  await putProcessed(c.env.YT2BILI_KV, processed);
  await putManualQueue(c.env.YT2BILI_KV, cleanedManualQueue);
  await putStatus(c.env.YT2BILI_KV, status);
  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.length - successCount;
  log('pipeline_writeback', 'success', {
    requestId: c.req.header('x-request-id'),
    total: results.length,
    success: successCount,
    failed: failCount,
    cleaned_manual: manualQueue.length - cleanedManualQueue.length,
  });
  return c.json({
    success: true,
    processed_count: results.length,
    cleaned_manual_count: manualQueue.length - cleanedManualQueue.length,
  });
});

// 回写运行状态(白名单字段,防止 Runner 篡改 total_processed 等)
app.post('/status', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const existing = await getStatus(c.env.YT2BILI_KV);
  // 只允许 Runner 更新这些字段;total_processed 由 /processed 累加,不接受 Runner 覆盖
  // error_summary:Runner 上报的失败概述(如 "全部 3 个视频失败"),供控制台展示
  const allowedFields = ['system_status', 'cookie_status', 'last_run_at', 'error_summary'];
  const updated: StatusRecord = { ...existing };
  for (const f of allowedFields) {
    if (body[f] === undefined) continue;
    if (f === 'error_summary') {
      // error_summary 限长 500,防止 Runner 写入超大内容
      (updated as any)[f] = typeof body[f] === 'string' ? body[f].slice(0, 500) : '';
      continue;
    }
    if (f === 'cookie_status') {
      // 严重度合并:不降级 'expired' 为 'expiring'/'ok'
      // 'expired'(上传报错)> 'expiring'(ac_time 即将到期)> 'ok' > 'unknown'
      const incoming = body[f];
      const current = updated.cookie_status;
      const severity: Record<string, number> = { unknown: 0, ok: 1, expiring: 2, expired: 3 };
      const incSev = severity[incoming] ?? 0;
      const curSev = severity[current || 'unknown'] ?? 0;
      // 只在传入更严重或相等时更新(避免 Runner 末尾的 'expiring' 覆盖 /processed 的 'expired')
      if (incSev >= curSev) {
        updated.cookie_status = incoming;
      }
      continue;
    }
    (updated as any)[f] = body[f];
  }
  updated.last_run_at = body.last_run_at || Date.now();
  await putStatus(c.env.YT2BILI_KV, updated);
  return c.json({ success: true });
});

// 回写刷新后的 Cookie(ac_time_value 续期)
// 支持清空:body 中字段为 null 时清空该凭证;undefined 不传时不更新
app.post('/cookies', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  const merged: any = { ...cfg };
  const cookieFields = ['bili_sessdata', 'bili_jct', 'bili_buvid3', 'ac_time_value'];
  for (const f of cookieFields) {
    if (body[f] === null) {
      merged[f] = '';  // 显式清空
    } else if (body[f] !== undefined) {
      merged[f] = body[f];
    }
    // undefined: 不更新
  }
  await putConfig(c.env.YT2BILI_KV, merged, c.env.ENCRYPTION_KEY || '');
  return c.json({ success: true });
});

export default app;
