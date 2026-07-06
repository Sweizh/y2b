// YouTube 代理路由：搜索频道
// 参考 YouTube Data API v3: https://developers.google.com/youtube/v3/docs/search/list

import { Hono } from 'hono';
import { getRawConfig } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// 搜索 YouTube 频道
app.get('/search', async (c) => {
  const q = c.req.query('q');
  if (!q) {
    return c.json({ error: '缺少 q 参数' }, 400);
  }
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.yt_api_key) {
    return c.json({ error: '请先配置 YouTube API Key' }, 400);
  }
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'channel');
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('key', cfg.yt_api_key);
    const resp = await fetch(url.toString());
    const data = await resp.json() as any;
    if (data.error) {
      return c.json({
        error: data.error.message || 'YouTube API 错误',
        raw: data.error,
      }, 502);
    }
    // 获取订阅数（需要 channels.list API）
    const channelIds = (data.items || []).map((item: any) => item.id?.channelId).filter(Boolean);
    let channelStats: Record<string, any> = {};
    if (channelIds.length > 0) {
      const statsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
      statsUrl.searchParams.set('part', 'statistics,snippet');
      statsUrl.searchParams.set('id', channelIds.join(','));
      statsUrl.searchParams.set('key', cfg.yt_api_key);
      const statsResp = await fetch(statsUrl.toString());
      const statsData = await statsResp.json() as any;
      if (statsData.items) {
        for (const item of statsData.items) {
          channelStats[item.id] = item;
        }
      }
    }
    // 整合结果
    const channels = (data.items || []).map((item: any) => {
      const channelId = item.id?.channelId || '';
      const stats = channelStats[channelId];
      const snippet = item.snippet || {};
      return {
        channel_id: channelId,
        name: snippet.title || '',
        description: snippet.description || '',
        avatar: (snippet.thumbnails?.high || snippet.thumbnails?.default)?.url || '',
        subscribers: stats?.statistics?.subscriberCount
          ? formatSubscribers(parseInt(stats.statistics.subscriberCount, 10))
          : '未知',
        raw_subscribers: stats?.statistics?.subscriberCount
          ? parseInt(stats.statistics.subscriberCount, 10)
          : 0,
      };
    });
    return c.json({ channels });
  } catch (e: any) {
    return c.json({ error: '请求 YouTube 失败：' + (e.message || e) }, 502);
  }
});

function formatSubscribers(n: number): string {
  if (n >= 10000) {
    return (n / 10000).toFixed(1) + ' 万 订阅者';
  }
  return n + ' 订阅者';
}

export default app;
