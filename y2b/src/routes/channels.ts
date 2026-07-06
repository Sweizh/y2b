// 频道管理路由：CRUD /api/channels

import { Hono } from 'hono';
import { getChannels, putChannels, generateId, type Channel } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 获取频道列表
app.get('/', async (c) => {
  const channels = await getChannels(c.env.YT2BILI_KV);
  return c.json(channels);
});

// 添加频道
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.channel_id || !body.name) {
    return c.json({ error: '缺少 channel_id 或 name' }, 400);
  }
  const channels = await getChannels(c.env.YT2BILI_KV);
  // 检查重复
  if (channels.some(ch => ch.channel_id === body.channel_id)) {
    return c.json({ error: '该频道已存在' }, 400);
  }
  const newChannel: Channel = {
    id: generateId(),
    channel_id: body.channel_id,
    name: body.name,
    season_id: body.season_id,
    section_id: body.section_id,
    tid: body.tid,
    tags: body.tags,
    copyright: body.copyright ?? 2,
    subtitle_mode: body.subtitle_mode ?? 'translated',
    enabled: body.enabled ?? true,
    created_at: Date.now(),
  };
  channels.push(newChannel);
  await putChannels(c.env.YT2BILI_KV, channels);
  return c.json(newChannel, 201);
});

// 更新频道
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const channels = await getChannels(c.env.YT2BILI_KV);
  const idx = channels.findIndex(ch => ch.id === id);
  if (idx === -1) {
    return c.json({ error: '频道不存在' }, 404);
  }
  channels[idx] = { ...channels[idx], ...body, id };
  await putChannels(c.env.YT2BILI_KV, channels);
  return c.json(channels[idx]);
});

// 删除频道
app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const channels = await getChannels(c.env.YT2BILI_KV);
  const idx = channels.findIndex(ch => ch.id === id);
  if (idx === -1) {
    return c.json({ error: '频道不存在' }, 404);
  }
  channels.splice(idx, 1);
  await putChannels(c.env.YT2BILI_KV, channels);
  return c.json({ success: true });
});

export default app;
