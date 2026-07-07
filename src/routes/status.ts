// 运行状态路由：GET /api/status + POST /api/trigger

import { Hono } from 'hono';
import { getRawConfig, getStatus, getProcessed } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 获取运行状态
app.get('/', async (c) => {
  const [status, processed, cfg] = await Promise.all([
    getStatus(c.env.YT2BILI_KV),
    getProcessed(c.env.YT2BILI_KV),
    getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || ''),
  ]);
  // 拼装最近处理记录（从 processed 表）
  const recentRecords = Object.values(processed)
    .sort((a, b) => b.processed_at - a.processed_at)
    .slice(0, 20)
    .map(p => ({
      channel: p.channel || '',
      video_title: p.title || '',
      status: p.status,
      stage: p.stage,
      message: p.message,
      processed_at: p.processed_at,
    }));
  return c.json({
    last_run_at: status.last_run_at,
    total_processed: status.total_processed || Object.keys(processed).length,
    system_status: status.system_status || 'normal',
    cookie_status: status.cookie_status || 'unknown',
    error_summary: status.error_summary || '',
    recent_records: recentRecords,
    pipeline_token_configured: !!cfg.pipeline_token,
    gh_repo: cfg.gh_repo || '',
  });
});

// 触发 GitHub Actions
// 参考 GitHub REST API: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
app.post('/trigger', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.gh_token || !cfg.gh_repo) {
    return c.json({ error: '请先配置 GitHub Token 和仓库' }, 400);
  }
  const [owner, repo] = cfg.gh_repo.split('/');
  if (!owner || !repo) {
    return c.json({ error: 'GitHub 仓库格式不正确，应为 owner/repo' }, 400);
  }
  const requestId = c.req.header('x-request-id') || crypto.randomUUID();
  const start = Date.now();
  try {
    // 触发 workflow_dispatch 事件
    const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.gh_token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yt2bili-worker',
      },
      body: JSON.stringify({
        event_type: 'pipeline_dispatch',
      }),
    });
    if (resp.status === 204) {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'trigger', status: 'success', requestId, repo: cfg.gh_repo, duration: Date.now() - start }));
      return c.json({ success: true, message: '已触发流水线，请稍后刷新查看结果' });
    }
    const text = await resp.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch {}
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'trigger', status: 'github_error', requestId, httpStatus: resp.status, duration: Date.now() - start }));
    return c.json({
      error: data?.message || `GitHub API 返回 ${resp.status}`,
      raw: data,
    }, 502);
  } catch (e: any) {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'trigger', status: 'exception', requestId, error: e.message, duration: Date.now() - start }));
    return c.json({ error: '触发失败：' + (e.message || e) }, 502);
  }
});

export default app;
