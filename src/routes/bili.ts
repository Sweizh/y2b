// B 站相关代理路由：合集列表 / 分区列表 / Cookie 测试
// 参考 https://sessionhu.github.io/bilibili-API-collect/
//
// 注意:Cloudflare Worker 出口 IP 被 B 站反爬(返回 HTML 登录页而非 JSON),
// 所以 /seasons 和 /test/bili 都走 Vercel Edge Function 代理(与 bili_login.ts 同一方案)。

import { Hono } from 'hono';
import { getRawConfig } from '../kv';

const app = new Hono<{ Bindings: Env }>();

// Vercel Edge 代理(绕过 CF Worker IP 对 B 站的反爬)
const VERCEL_BILI_PROXY = 'https://y2b-six.vercel.app';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 静态投稿分区表（B 站分区变动少，内置以减少 API 调用）
// 来源：bilibili-API-collect/docs/video/archive_channel.md
const STATIC_TIDS: Array<{ tid: number; name: string; parent?: number }> = [
  { tid: 1, name: '生活 -- 日常' },
  { tid: 2, name: '生活 -- 搞笑' },
  { tid: 3, name: '生活 -- 美食圈' },
  { tid: 4, name: '生活 -- 动物圈' },
  { tid: 5, name: '生活 -- 游戏' },
  { tid: 21, name: '生活 -- 趣味' },
  { tid: 22, name: '生活 -- 科技' },
  { tid: 122, name: '知识 -- 科技科普' },
  { tid: 121, name: '知识 -- 科学科普' },
  { tid: 124, name: '知识 -- 资讯' },
  { tid: 125, name: '知识 -- 人文历史' },
  { tid: 126, name: '知识 -- 社科人文' },
  { tid: 127, name: '知识 -- 野生技术协会' },
  { tid: 128, name: '知识 -- 设计创意' },
  { tid: 129, name: '知识 -- 影视杂谈' },
  { tid: 130, name: '知识 -- 影视剪辑' },
  { tid: 131, name: '知识 -- 短视频' },
  { tid: 132, name: '知识 -- 卡点' },
  { tid: 133, name: '知识 -- 影视仿妆' },
  { tid: 134, name: '知识 -- 影视配音' },
  { tid: 188, name: '科技 -- 科普' },
  { tid: 95, name: '数码 -- 手机平板' },
  { tid: 189, name: '数码 -- 电脑装机' },
  { tid: 190, name: '数码 -- 摄影摄像' },
  { tid: 191, name: '数码 -- 影音智能' },
  { tid: 192, name: '数码 -- 智能家居' },
  { tid: 193, name: '数码 -- 其他' },
  { tid: 207, name: '资讯 -- 热点' },
  { tid: 208, name: '资讯 -- 综合资讯' },
  { tid: 251, name: '资讯 -- 国际' },
  { tid: 252, name: '资讯 -- 国内' },
  { tid: 253, name: '资讯 -- 社会' },
  { tid: 254, name: '资讯 -- 多事之秋' },
  { tid: 257, name: '广告 -- 广告' },
  { tid: 258, name: '广告 -- 商业推广' },
  { tid: 259, name: '广告 -- 公益' },
  { tid: 27, name: '综合 -- 综合' },
  { tid: 28, name: '综合 -- 影视' },
  { tid: 29, name: '综合 -- 影视相关' },
  { tid: 30, name: '综合 -- 影视杂谈' },
  { tid: 31, name: '综合 -- 翻唱' },
  { tid: 32, name: '综合 -- 翻奏' },
  { tid: 33, name: '综合 -- 序章' },
  { tid: 36, name: '综合 -- 知识技术' },
  { tid: 37, name: '综合 -- 人物' },
  { tid: 38, name: '综合 -- 资料' },
  { tid: 39, name: '综合 -- 鬼畜' },
  { tid: 47, name: '综合 -- 论坛账号' },
  { tid: 48, name: '综合 -- 论坛字幕' },
  { tid: 49, name: '综合 -- 论坛活动' },
];

// 通过 Vercel Edge 代理调 B 站 seasons API,绕过 CF Worker IP 反爬
async function fetchSeasonsViaVercel(cfg: any): Promise<any> {
  const resp = await fetch(`${VERCEL_BILI_PROXY}/bili/seasons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      sessdata: cfg.bili_sessdata,
      bili_jct: cfg.bili_jct,
      buvid3: cfg.bili_buvid3 || '',
    }),
  });
  const data = await resp.json() as any;
  if (data.error) {
    // 完整透传 Vercel Edge 返回的诊断字段:error + message + cause + bodyPreview + status + contentType
    const parts = [data.error];
    if (data.message) parts.push(`原因: ${data.message}`);
    if (data.cause) parts.push(`首次: ${data.cause}`);
    if (data.status) parts.push(`HTTP ${data.status}`);
    if (data.contentType) parts.push(`content-type: ${data.contentType}`);
    if (data.bodyPreview) parts.push(`预览: ${String(data.bodyPreview).slice(0, 120)}`);
    throw new Error(parts.join(' | '));
  }
  return data.seasons;
}

// 通过 Vercel Edge 代理调 B 站 nav API,绕过 CF Worker IP 反爬
async function fetchNavViaVercel(cfg: any): Promise<any> {
  const resp = await fetch(`${VERCEL_BILI_PROXY}/bili/nav`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      sessdata: cfg.bili_sessdata,
      bili_jct: cfg.bili_jct || '',
      buvid3: cfg.bili_buvid3 || '',
    }),
  });
  const data = await resp.json() as any;
  if (data.error) {
    const parts = [data.error];
    if (data.message) parts.push(`原因: ${data.message}`);
    if (data.bodyPreview) parts.push(`预览: ${String(data.bodyPreview).slice(0, 120)}`);
    throw new Error(parts.join(' | '));
  }
  return data.nav;
}

// 代理拉取 B 站合集列表
// 参考 bilibili-API-collect: https://member.bilibili.com/x2/creative/web/seasons
app.get('/seasons', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.bili_sessdata || !cfg.bili_jct) {
    return c.json({ error: '请先配置 B 站凭证' }, 400);
  }
  try {
    const data = await fetchSeasonsViaVercel(cfg);
    if (data.code !== 0) {
      return c.json({ error: data.message || '获取合集列表失败', raw: data }, 502);
    }
    return c.json(data.data);
  } catch (e: any) {
    return c.json({ error: '请求 B 站失败：' + (e.message || e) }, 502);
  }
});

// 获取投稿分区列表（静态表，避免外部 API 调用）
app.get('/tids', async (c) => {
  return c.json(STATIC_TIDS);
});

// 测试 B 站 Cookie 有效性
// 参考 bilibili-API-collect: https://api.bilibili.com/x/web-interface/nav
// 通过 Vercel Edge 代理绕过 CF Worker IP 对 B 站的反爬
app.post('/test/bili', async (c) => {
  const cfg = await getRawConfig(c.env.YT2BILI_KV, c.env.ENCRYPTION_KEY || '');
  if (!cfg.bili_sessdata) {
    return c.json({ success: false, message: '请先配置 B 站 SESSDATA' }, 400);
  }
  try {
    const data = await fetchNavViaVercel(cfg);
    if (data.code !== 0) {
      return c.json({
        success: false,
        message: data.message || 'Cookie 无效',
        raw_code: data.code,
      });
    }
    const uname = data.data?.uname || '未知';
    const isLogin = data.data?.isLogin === true;
    return c.json({
      success: isLogin,
      message: isLogin ? `B 站 Cookie 有效，登录账号：${uname}` : 'Cookie 无效（未登录）',
    });
  } catch (e: any) {
    return c.json({ success: false, message: '请求 B 站失败：' + (e.message || e) }, 502);
  }
});

export default app;
