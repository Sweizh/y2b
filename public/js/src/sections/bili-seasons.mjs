// bili-seasons.mjs — B 站合集列表与视频列表展示
import { apiFetch } from '../api.mjs';
import { showToast } from '../components/toast.mjs';

var loaded = false;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function loadSeasons() {
  return apiFetch('/api/seasons').then(function (d) {
    if (d && d.error) throw new Error(d.error);
    var arr = [];
    if (Array.isArray(d)) arr = d;
    else if (d && d.seasons) arr = d.seasons;
    else if (d && d.list) arr = d.list;
    else if (d && d.items) arr = d.items;
    return arr;
  });
}

function loadEpisodes(seasonId) {
  return apiFetch('/api/seasons/' + encodeURIComponent(seasonId) + '/episodes').then(function (d) {
    if (d && d.error) throw new Error(d.error);
    // B 站返回 {episodes:[...] 或 episodes 字段,适配多种结构
    var arr = [];
    if (Array.isArray(d)) arr = d;
    else if (d && d.episodes) arr = d.episodes;
    else if (d && d.list) arr = d.list;
    else if (d && d.items) arr = d.items;
    return arr;
  });
}

function renderSeasonCard(season) {
  var inner = season.season || season;
  var sid = escapeHtml(String(inner.id || season.id || season.season_id || ''));
  var sname = escapeHtml(inner.title || season.name || season.title || season.season_title || '合集 ' + sid);
  var count = season.count || season.ep_count || (season.episodes && season.episodes.length) || 0;

  var card = document.createElement('div');
  card.className = 'bili-season-card';
  card.setAttribute('data-season-id', sid);
  card.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden';

  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px;cursor:pointer';
  header.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px">' +
    '<span style="font-size:10px;transition:transform .15s" data-arrow>▸</span>' +
    '<span style="font-size:14px;font-weight:500">' + sname + '</span>' +
    (count ? '<span class="tag tag-muted" style="font-size:10px">' + count + ' 个视频</span>' : '') +
    '</div>' +
    '<span style="font-size:11px;color:var(--muted-foreground)">ID: ' + sid + '</span>';

  var body = document.createElement('div');
  body.style.cssText = 'display:none;padding:0 12px 12px;border-top:1px solid var(--border)';

  card.appendChild(header);
  card.appendChild(body);

  var loaded = false;
  header.addEventListener('click', function () {
    var isOpen = body.style.display !== 'none';
    if (isOpen) {
      body.style.display = 'none';
      header.querySelector('[data-arrow]').style.transform = 'rotate(0deg)';
      return;
    }
    body.style.display = 'block';
    header.querySelector('[data-arrow]').style.transform = 'rotate(90deg)';
    if (!loaded) {
      body.innerHTML = '<p style="font-size:12px;color:var(--muted-foreground);padding:8px 0">加载中...</p>';
      loadEpisodes(sid).then(function (eps) {
        loaded = true;
        renderEpisodes(body, eps);
      }).catch(function (e) {
        body.innerHTML = '<p style="font-size:12px;color:var(--destructive);padding:8px 0">加载失败: ' + escapeHtml(String(e.message || e).slice(0, 100)) + '</p>';
      });
    }
  });

  return card;
}

function renderEpisodes(container, episodes) {
  if (!episodes || episodes.length === 0) {
    container.innerHTML = '<p style="font-size:12px;color:var(--muted-foreground);padding:8px 0">该合集暂无视频</p>';
    return;
  }
  var html = '<div style="display:flex;flex-direction:column;gap:8px;padding-top:8px">';
  episodes.forEach(function (ep) {
    var inner = ep.episode || ep.arc || ep;
    var title = escapeHtml(inner.title || ep.title || '未知');
    var bvid = escapeHtml(String(inner.bvid || ep.bvid || ''));
    var cover = inner.cover || ep.cover || ep.pic || '';
    var pubdate = inner.pubdate || ep.pubdate || inner.ctime || ep.ctime || 0;
    var pubStr = pubdate ? new Date(pubdate * 1000).toLocaleDateString('zh-CN') : '';
    html +=
      '<div style="display:flex;gap:8px;padding:8px;border-radius:6px;background:var(--muted)">' +
      (cover ? '<img src="' + escapeHtml(cover) + '" style="width:80px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0" loading="lazy"/>' : '') +
      '<div style="flex:1;min-width:0">' +
      '<p style="font-size:12px;font-weight:500;margin:0 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + title + '</p>' +
      '<p style="font-size:11px;color:var(--muted-foreground);margin:0">' + pubStr + (bvid ? ' · ' + bvid : '') + '</p>' +
      '</div>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

export function initBiliSeasons() {
  var section = document.getElementById('section-bili-seasons');
  if (!section) return;
  var listEl = document.getElementById('bili-seasons-list');
  if (!listEl) return;

  function refresh() {
    listEl.innerHTML = '<p class="text-xs" style="color:var(--muted-foreground)">加载中...</p>';
    loadSeasons().then(function (seasons) {
      if (seasons.length === 0) {
        listEl.innerHTML = '<p class="text-xs" style="color:var(--muted-foreground)">暂无合集(可在 B 站创作中心创建)</p>';
        return;
      }
      listEl.innerHTML = '';
      seasons.forEach(function (s) {
        listEl.appendChild(renderSeasonCard(s));
      });
    }).catch(function (e) {
      listEl.innerHTML = '<p class="text-xs" style="color:var(--destructive)">加载失败: ' + escapeHtml(String(e.message || e).slice(0, 100)) + '</p>';
    });
  }

  var refreshBtn = document.querySelector('[data-dom-id="bili-seasons-refresh"]');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refresh);
  }

  refresh();
}
