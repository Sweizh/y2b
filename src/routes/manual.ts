// 手动视频队列路由：GET / POST / DELETE /api/manual-queue

import { Hono } from 'hono';
import { getManualQueue, putManualQueue, type ManualQueueItem } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 获取手动队列
app.get('/', async (c) => {
  const queue = await getManualQueue(c.env.YT2BILI_KV);
  return c.json({ items: queue });
});

// 添加视频到手动队列
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const urls: string[] = body.urls || [];
  const channelConfigId = body.channel_config_id;
  const seasonId = body.season_id;
  const sectionId = body.section_id;
  if (!Array.isArray(urls) || urls.length === 0) {
    return c.json({ error: '请输入视频 URL' }, 400);
  }
  const queue = await getManualQueue(c.env.YT2BILI_KV);
  const existingIds = new Set(queue.map(q => q.video_id));
  const newItems: ManualQueueItem[] = [];
  for (const url of urls) {
    const videoId = extractVideoId(url);
    if (!videoId) continue;
    if (existingIds.has(videoId)) continue;
    newItems.push({
      video_id: videoId,
      url: normalizeUrl(videoId),
      title: videoId,
      channel_config_id: channelConfigId,
      season_id: body.season_id || '',
      section_id: body.section_id || '',
      added_at: Date.now(),
      status: 'pending',
      retry_count: 0,
    });
    existingIds.add(videoId);
  }
  if (newItems.length === 0) {
    return c.json({ error: '所有视频已在队列中' }, 400);
  }
  await putManualQueue(c.env.YT2BILI_KV, [...queue, ...newItems]);
  return c.json({ items: newItems, added: newItems.length });
});

// 从手动队列删除
app.delete('/:videoId', async (c) => {
  const videoId = c.req.param('videoId');
  const queue = await getManualQueue(c.env.YT2BILI_KV);
  const idx = queue.findIndex(q => q.video_id === videoId);
  if (idx === -1) {
    return c.json({ error: '记录不存在' }, 404);
  }
  queue.splice(idx, 1);
  await putManualQueue(c.env.YT2BILI_KV, queue);
  return c.json({ success: true });
});

// 从 URL 提取 YouTube video ID
function extractVideoId(input: string): string | null {
  if (!input) return null;
  const s = input.trim();
  // 纯 11 位视频 ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  // 完整 URL / 短链接
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('?')[0];
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      // /embed/xxx /short/xxx
      const m = u.pathname.match(/\/(embed|shorts|v)\/([a-zA-Z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {}
  return null;
}

function normalizeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export default app;
