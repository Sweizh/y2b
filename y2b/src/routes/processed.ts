// 已处理视频路由：GET /api/processed + DELETE /api/processed/:videoId

import { Hono } from 'hono';
import { getProcessed, putProcessed } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 获取已处理视频列表
app.get('/', async (c) => {
  const processed = await getProcessed(c.env.YT2BILI_KV);
  // 按 processed_at 倒序
  const list = Object.values(processed).sort((a, b) => b.processed_at - a.processed_at);
  return c.json({ items: list, total: list.length });
});

// 删除单条已处理记录（用于触发重新处理）
app.delete('/:videoId', async (c) => {
  const videoId = c.req.param('videoId');
  const processed = await getProcessed(c.env.YT2BILI_KV);
  if (!processed[videoId]) {
    return c.json({ error: '记录不存在' }, 404);
  }
  delete processed[videoId];
  await putProcessed(c.env.YT2BILI_KV, processed);
  return c.json({ success: true });
});

export default app;
