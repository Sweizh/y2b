// Vercel Edge Function:代理 B 站创作中心合集视频列表接口
// 复用 bili-seasons.ts 的极简结构(已验证可工作)
//
// B 站创作中心没有按 season_id 直接取视频列表的接口,正确流程是两步:
//   1. GET /x2/creative/web/seasons  取合集列表,从中提取 sections.sections[].id
//   2. GET /x2/creative/web/season/section?id={section_id}  取该小节的视频列表
// 本函数在 Vercel Edge 内完成两步,对调用方只暴露 season_id。

export const config = { runtime: 'edge' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    },
  });
}

// 先读 text 再 parse,防止 B 站返回带 BOM/前导空白导致 resp.json() 抛异常
async function fetchBiliJson(url: string, cookie: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      'Cookie': cookie,
      'User-Agent': UA,
      'Referer': 'https://member.bilibili.com/platform/upload-manager/frame',
      'Origin': 'https://member.bilibili.com',
      'Accept': 'application/json, text/plain, */*',
    },
  });
  const ct = resp.headers.get('content-type') || '';
  const text = await resp.text();
  if (!ct.includes('application/json')) {
    throw new Error(`B 站返回非 JSON (HTTP ${resp.status}, ct=${ct}): ${text.slice(0, 150)}`);
  }
  return JSON.parse(text.replace(/^\uFEFF/, '').trimStart());
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS' } });
  }
  const start = Date.now();
  const vercelRegion = req.headers.get('x-vercel-id') || 'unknown';
  try {
    const body = await req.json() as { sessdata?: string; bili_jct?: string; buvid3?: string; season_id?: string };
    const sessdata = body?.sessdata || '';
    const biliJct = body?.bili_jct || '';
    const buvid3 = body?.buvid3 || '';
    const seasonId = body?.season_id || '';
    if (!sessdata || !biliJct) {
      return json({ error: '缺少 sessdata 或 bili_jct', vercelRegion, duration: Date.now() - start }, 400);
    }
    if (!seasonId) {
      return json({ error: '缺少 season_id', vercelRegion, duration: Date.now() - start }, 400);
    }
    const cookie = `SESSDATA=${sessdata}; bili_jct=${biliJct}; buvid3=${buvid3}`;

    // 第 1 步:取合集列表,找到匹配 season_id 的小节 ID 列表
    const seasonsResp = await fetchBiliJson(
      'https://member.bilibili.com/x2/creative/web/seasons?pn=1&ps=30',
      cookie,
    );
    if (seasonsResp.code !== 0) {
      return json({ error: seasonsResp.message || '获取合集列表失败', raw: seasonsResp, vercelRegion, duration: Date.now() - start }, 502);
    }
    const allSeasons = (seasonsResp.data && seasonsResp.data.seasons) || [];
    const matched = allSeasons.find(function (s: any) {
      var inner = s.season || s;
      return String(inner.id || s.id) === String(seasonId);
    });
    if (!matched) {
      return json({ error: '未找到该合集 (season_id=' + seasonId + ')', vercelRegion, duration: Date.now() - start }, 404);
    }
    // 提取小节 ID 列表(B 站合集分小节,视频挂在小节下)
    var sectionIds: string[] = [];
    var sectionsRoot = matched.sections || (matched.season && matched.season.sections);
    if (sectionsRoot && Array.isArray(sectionsRoot.sections)) {
      sectionIds = sectionsRoot.sections.map(function (sec: any) { return String(sec.id); }).filter(Boolean);
    }
    if (sectionIds.length === 0) {
      // 没有小节,返回 part_episodes(可能为空或部分)
      var pe = matched.part_episodes || (matched.season && matched.season.part_episodes) || [];
      return json({ episodes: pe, vercelRegion, duration: Date.now() - start, source: 'part_episodes' });
    }

    // 第 2 步:并发取每个小节的视频列表
    const sectionResults = await Promise.all(sectionIds.map(function (sid: string) {
      return fetchBiliJson(
        'https://member.bilibili.com/x2/creative/web/season/section?id=' + encodeURIComponent(sid),
        cookie,
      ).catch(function (e: any) {
        return { __error: e.message || String(e), sectionId: sid };
      });
    }));
    var allEpisodes: any[] = [];
    var errors: string[] = [];
    sectionResults.forEach(function (sr: any) {
      if (sr.__error) { errors.push(sr.__error); return; }
      if (sr.code !== 0) { errors.push(sr.message || ('section code=' + sr.code)); return; }
      var eps = (sr.data && sr.data.episodes) || (sr.data && sr.data.section && sr.data.section.episodes) || [];
      if (Array.isArray(eps)) allEpisodes = allEpisodes.concat(eps);
    });
    return json({
      episodes: allEpisodes,
      sectionCount: sectionIds.length,
      errors: errors.length ? errors : undefined,
      vercelRegion,
      duration: Date.now() - start,
    });
  } catch (e: any) {
    return json({
      error: 'Vercel Edge 请求 season episodes 失败',
      message: e.message || String(e),
      vercelRegion,
      duration: Date.now() - start,
    }, 500);
  }
}
