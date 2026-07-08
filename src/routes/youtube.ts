// YouTube 代理路由：搜索频道
// 参考 YouTube Data API v3: https://developers.google.com/youtube/v3/docs/search/list

import { Hono } from 'hono';
import { getRawConfig } from '../kv';
import { refreshYouTubeAccessToken } from './youtube_oauth';

const app = new Hono<{ Bindings: Env }>();

// 搜索 YouTube 频道
// 优先用 OAuth access_token(Bearer 头),其次用 yt_api_key(query 参数)
app.get('/search', async (c) => {
  const q = c.req.query('q');
  if (!q) {
    return c.json({ error: '缺少 q 参数' }, 400);
  }
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');

  // 选择鉴权方式:OAuth 优先,API Key 降级
  // OAuth 模式:检查 token 是否过期,过期则尝试用 refresh_token 静默刷新
  let useOAuth = false;
  let accessToken = '';
  if (cfg.yt_access_token && cfg.yt_refresh_token) {
    // token 是否过期
    const now = Date.now();
    if (cfg.yt_token_expires_at && cfg.yt_token_expires_at > now + 5 * 60 * 1000) {
      useOAuth = true;
      accessToken = cfg.yt_access_token;
    } else {
      // 过期但已配置 OAuth,尝试用 refresh_token 静默刷新(避免用户先点"检测")
      const requestId = c.req.header('x-request-id') || crypto.randomUUID();
      const r = await refreshYouTubeAccessToken(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '', requestId);
      if (r.ok && r.access_token) {
        useOAuth = true;
        accessToken = r.access_token;
      } else {
        // 刷新失败(refresh_token 失效或网络异常),返回友好错误
        return c.json({ error: 'YouTube 登录已过期,请重新 OAuth 登录' }, 401);
      }
    }
  }
  if (!useOAuth && !cfg.yt_api_key) {
    return c.json({ error: '请先配置 YouTube API Key 或完成 OAuth 登录' }, 400);
  }

  const headers: Record<string, string> = {};
  if (useOAuth) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'channel');
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', '10');
    if (!useOAuth) {
      url.searchParams.set('key', cfg.yt_api_key!);
    }
    const resp = await fetch(url.toString(), { headers });
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
      if (!useOAuth) {
        statsUrl.searchParams.set('key', cfg.yt_api_key!);
      }
      const statsResp = await fetch(statsUrl.toString(), { headers });
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
    // fetch 抛错时 e.message 可能含完整 URL(含 ?key=<API_KEY>),
    // 不能直接返回客户端,否则 API Key 泄露
    const msg = String(e && (e.message || e)) || 'unknown';
    const safe = msg.includes('key=') ? '请求 YouTube 失败(URL 含敏感参数,已隐藏详情)' : '请求 YouTube 失败：' + msg;
    console.error('[youtube] search failed:', msg);
    return c.json({ error: safe }, 502);
  }
});

function formatSubscribers(n: number): string {
  if (n >= 10000) {
    return (n / 10000).toFixed(1) + ' 万 订阅者';
  }
  return n + ' 订阅者';
}

export default app;
