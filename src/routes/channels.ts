// 频道管理路由：CRUD /api/channels

import { Hono } from 'hono';
import { getChannels, putChannels, generateId, type Channel } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 允许的字段白名单(防止注入任意字段)
const CHANNEL_FIELDS = ['season_id', 'section_id', 'tid', 'tags', 'copyright', 'subtitle_mode', 'enabled', 'since'] as const;
const SUBTITLE_MODES = ['translated', 'original', 'both', 'none'];

// 从 body 中提取白名单字段并做类型转换
function pickChannelFields(body: any): Partial<Channel> {
  const picked: any = {};
  for (const f of CHANNEL_FIELDS) {
    if (body[f] !== undefined) {
      let v = body[f];
      if (f === 'tid') v = v ? Number(v) : undefined;
      if (f === 'copyright') v = v ? Number(v) : undefined;
      if (f === 'enabled') v = !!v;
      if (f === 'subtitle_mode' && SUBTITLE_MODES.indexOf(v) < 0) continue;  // 非法值忽略
      picked[f] = v;
    }
  }
  return picked;
}

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
    channel_id: String(body.channel_id),
    name: String(body.name),
    ...pickChannelFields(body),
    enabled: body.enabled === undefined ? true : !!body.enabled,
    subtitle_mode: SUBTITLE_MODES.indexOf(body.subtitle_mode) >= 0 ? body.subtitle_mode : 'translated',
    copyright: body.copyright === 1 ? 1 : 2,
    created_at: Date.now(),
  };
  channels.push(newChannel);
  await putChannels(c.env.YT2BILI_KV, channels);
  return c.json(newChannel, 201);
});

// 更新频道(白名单字段,保留 id/channel_id/name/created_at)
app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const channels = await getChannels(c.env.YT2BILI_KV);
  const idx = channels.findIndex(ch => ch.id === id);
  if (idx === -1) {
    return c.json({ error: '频道不存在' }, 404);
  }
  // name 可更新但需校验;其他字段走白名单
  const updates: any = { ...pickChannelFields(body) };
  if (body.name !== undefined) updates.name = String(body.name);
  channels[idx] = { ...channels[idx], ...updates, id };
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
