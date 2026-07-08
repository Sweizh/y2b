// channels.mjs — 频道管理 section (migrated from console.html lines 1542-1989)
//
// Public API:
//   initChannels()  → bind channel search / follow / config / save logic
//
// API endpoints used:
//   GET    /api/youtube/search?q=<q>   search YouTube channels
//   GET    /api/channels               list followed channels
//   POST   /api/channels               follow a channel {channel_id,name}
//   PUT    /api/channels/<id>          save channel config (full or {enabled})
//   DELETE /api/channels/<id>          unfollow / remove a channel
//   GET    /api/tids                   static tid table (cached)
//   GET    /api/seasons                bili seasons list (cached)
//
// Preserved selectors:
//   #section-channels, #channels-list,
//   [data-dom-id="channel-search-btn"], [data-dom-id="channels-save-btn"],
//   [data-search-results] (created), .search-results-header, .search-clear-btn,
//   .search-card[data-channel-id], .follow-btn,
//   .channel-card[data-channel-id], [data-del-channel], [data-toggle-channel],
//   [data-enabled], [data-save-channel], [data-field], input[name="copyright-<id>"]

import { showToast } from '../components/toast.mjs';
import { showModal } from '../components/modal.mjs';
import { setBtnLoading } from '../components/button.mjs';
import { apiFetch, apiGet, apiPost } from '../api.mjs';
import { escapeHtml } from '../utils.mjs';

/**
 * Initialize the channels section. No-op if #section-channels is absent.
 */
export function initChannels() {
  var channelsSection = document.getElementById('section-channels');
  if (!channelsSection) return;

  // Note: must target #channel-search-input by id — the first input[type="text"]
  // inside #section-channels is the OAuth Client ID field, not the search box.
  var searchInput = document.getElementById('channel-search-input');
  var searchBtn = channelsSection.querySelector('[data-dom-id="channel-search-btn"]');

  // Cache of followed channel_ids, used to mark search results as "已关注".
  var followedChannelIds = {};
  // Static tid table cache (never fails).
  var cachedTids = null;
  // Bili seasons cache (may fail without bili cookie).
  var cachedSeasons = null;
  var seasonsLoading = false;

  // ---- search binding ----
  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', function () {
      var q = searchInput.value.trim();
      if (!q) {
        showToast('请输入搜索关键词', 'error');
        return;
      }
      showSearchLoading(q);
      setBtnLoading(searchBtn, true, '搜索中…');
      apiGet('/api/youtube/search?q=' + encodeURIComponent(q))
        .then(function (d) {
          setBtnLoading(searchBtn, false);
          if (d.error) {
            showSearchError(d.error);
            return;
          }
          var channels = d.channels || [];
          renderSearchResults(channels, q);
        })
        .catch(function (e) {
          setBtnLoading(searchBtn, false);
          showSearchError('搜索失败：' + (e.message || e));
        });
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchBtn.click();
      }
    });
  }

  // Lazily create / fetch the search-results container, inserted right after
  // the search bar row.
  function getSearchResultsContainer() {
    var existing = channelsSection.querySelector('[data-search-results]');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.setAttribute('data-search-results', '');
    wrap.style.cssText = 'margin-bottom:16px';
    var searchWrap = searchInput.parentElement.parentElement;
    searchWrap.parentNode.insertBefore(wrap, searchWrap.nextSibling);
    return wrap;
  }

  function bindClearBtn(wrap) {
    var clearBtn = wrap.querySelector('.search-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        wrap.remove();
      });
    }
  }

  function showSearchLoading(q) {
    var wrap = getSearchResultsContainer();
    wrap.innerHTML =
      '<div class="search-results-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<span style="font-size:12px;font-weight:600;color:var(--apple-foreground)">搜索「' +
      escapeHtml(q) +
      '」的结果</span>' +
      '<button class="search-clear-btn" aria-label="关闭搜索结果" style="background:none;border:none;font-size:14px;color:var(--apple-muted-foreground);cursor:pointer;padding:2px 6px;line-height:1">×</button>' +
      '</div>' +
      '<div style="background:var(--apple-background);border:1px solid var(--apple-border);border-radius:8px;padding:24px;text-align:center">' +
      '<p style="font-size:13px;color:var(--apple-muted-foreground)">搜索中…</p>' +
      '</div>';
    bindClearBtn(wrap);
  }

  function showSearchError(msg) {
    var wrap = getSearchResultsContainer();
    wrap.innerHTML =
      '<div class="search-results-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<span style="font-size:12px;font-weight:600;color:var(--apple-foreground)">搜索结果</span>' +
      '<button class="search-clear-btn" aria-label="关闭搜索结果" style="background:none;border:none;font-size:14px;color:var(--apple-muted-foreground);cursor:pointer;padding:2px 6px;line-height:1">×</button>' +
      '</div>' +
      '<div style="background:var(--apple-background);border:1px solid var(--apple-border);border-radius:8px;padding:24px;text-align:center">' +
      '<p style="font-size:13px;color:var(--state-error)">' +
      escapeHtml(msg) +
      '</p>' +
      '</div>';
    bindClearBtn(wrap);
  }

  // Render search result cards and wire follow buttons.
  function renderSearchResults(channels, q) {
    var wrap = getSearchResultsContainer();
    var header =
      '<div class="search-results-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<span style="font-size:12px;font-weight:600;color:var(--apple-foreground)">搜索「' +
      escapeHtml(q || '') +
      '」的结果 (' +
      channels.length +
      ')</span>' +
      '<button class="search-clear-btn" aria-label="关闭搜索结果" style="background:none;border:none;font-size:14px;color:var(--apple-muted-foreground);cursor:pointer;padding:2px 6px;line-height:1">×</button>' +
      '</div>';

    if (channels.length === 0) {
      wrap.innerHTML =
        header +
        '<div style="background:var(--apple-background);border:1px solid var(--apple-border);border-radius:8px;padding:24px;text-align:center">' +
        '<p style="font-size:13px;color:var(--apple-muted-foreground)">未找到匹配的频道,试试其他关键词</p>' +
        '</div>';
      bindClearBtn(wrap);
      return;
    }

    var cardsHtml = channels
      .map(function (ch) {
        var isFollowed = !!followedChannelIds[ch.channel_id];
        var followBtnHtml = isFollowed
          ? '<button disabled style="height:32px;padding:0 12px;border-radius:6px;border:none;background:var(--apple-secondary);color:var(--apple-muted-foreground);font-size:12px;font-weight:500;cursor:not-allowed;opacity:0.7">已关注</button>'
          : '<button class="follow-btn" style="height:32px;padding:0 12px;border-radius:6px;border:none;background:var(--brand-500);color:#fff;font-size:12px;font-weight:500;cursor:pointer">关注</button>';
        var avatarHtml = ch.avatar
          ? '<img src="' +
            escapeHtml(ch.avatar) +
            '" style="width:48px;height:48px;border-radius:50%;flex-shrink:0;object-fit:cover" alt=""/>'
          : '<div style="width:48px;height:48px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,var(--brand-100),var(--brand-300))"></div>';
        return (
          '<div class="search-card" data-channel-id="' +
          escapeHtml(ch.channel_id) +
          '" style="background:var(--apple-background);border:1px solid var(--apple-border);border-radius:8px;padding:16px;margin-bottom:8px">' +
          '<div style="display:flex;align-items:flex-start;gap:12px">' +
          avatarHtml +
          '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
          '<a href="https://www.youtube.com/channel/' +
          escapeHtml(ch.channel_id) +
          '" target="_blank" rel="noopener noreferrer" style="font-size:14px;font-weight:600;color:var(--apple-foreground);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          escapeHtml(ch.name) +
          '</a>' +
          followBtnHtml +
          '</div>' +
          '<p style="font-size:12px;color:var(--apple-muted-foreground);margin:4px 0 0">' +
          escapeHtml(ch.subscribers || '') +
          '</p>' +
          '<p style="font-size:12px;color:var(--apple-muted-foreground);margin:4px 0 0;-webkit-line-clamp:2;display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden">' +
          escapeHtml(ch.description || '') +
          '</p>' +
          '</div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
    wrap.innerHTML = header + cardsHtml;

    // Wire up per-card behaviors: avatar onerror, link hover, follow button.
    wrap.querySelectorAll('.search-card').forEach(function (card) {
      var channelId = card.getAttribute('data-channel-id');
      var link = card.querySelector('a');
      var name = link ? link.textContent : '';
      var followBtn = card.querySelector('.follow-btn');
      var avatarImg = card.querySelector('img');

      if (avatarImg) {
        avatarImg.addEventListener('error', function () {
          avatarImg.style.display = 'none';
        });
      }
      if (link) {
        link.addEventListener('mouseover', function () {
          link.style.color = 'var(--brand-500)';
        });
        link.addEventListener('mouseout', function () {
          link.style.color = 'var(--apple-foreground)';
        });
      }
      if (!followBtn) return;

      followBtn.addEventListener('click', function () {
        // 先加载 seasons(ensureSeasons 已有缓存机制)
        ensureSeasons(function (seasons) {
          // 构建 modal 内容
          var seasonOpts = '<option value="">不指定合集</option>';
          seasons.forEach(function (s) {
            var sid = String(s.id || s.season_id || '');
            var sname = s.name || s.title || s.season_title || ('合集 ' + sid);
            seasonOpts += '<option value="' + escapeHtml(sid) + '">' + escapeHtml(sname) + '</option>';
          });
          var smOpts = '<option value="translated">翻译字幕</option>' +
                       '<option value="original">原语言字幕</option>' +
                       '<option value="both">双语字幕</option>' +
                       '<option value="none">不上传字幕</option>';
          showModal({
            title: '关注频道: ' + name,
            bodyHtml:
              '<div style="margin-bottom:12px">' +
              '<label style="display:block;font-size:12px;margin-bottom:4px;color:var(--muted-foreground)">B 站合集(可选)</label>' +
              '<select id="follow-season-select" style="width:100%;height:36px;padding:0 8px;border-radius:6px;background:var(--card);border:1px solid var(--input);color:var(--foreground)">' + seasonOpts + '</select>' +
              '</div>' +
              '<div>' +
              '<label style="display:block;font-size:12px;margin-bottom:4px;color:var(--muted-foreground)">字幕模式</label>' +
              '<select id="follow-subtitle-mode" style="width:100%;height:36px;padding:0 8px;border-radius:6px;background:var(--card);border:1px solid var(--input);color:var(--foreground)">' + smOpts + '</select>' +
              '</div>',
            okText: '关注',
            onOk: function () {
              var seasonSel = document.getElementById('follow-season-select');
              var smSel = document.getElementById('follow-subtitle-mode');
              var payload = { channel_id: channelId, name: name };
              if (seasonSel && seasonSel.value) payload.season_id = seasonSel.value;
              if (smSel && smSel.value) payload.subtitle_mode = smSel.value;
              setBtnLoading(followBtn, true, '添加中…');
              apiPost('/api/channels', payload)
                .then(function (d) {
                  setBtnLoading(followBtn, false);
                  if (d.error) {
                    showToast(d.error, 'error');
                  } else {
                    followBtn.textContent = '已关注';
                    followBtn.style.background = 'var(--secondary)';
                    followBtn.style.color = 'var(--muted-foreground)';
                    followBtn.disabled = true;
                    followBtn.style.cursor = 'not-allowed';
                    followBtn.style.opacity = '0.7';
                    followBtn.classList.remove('follow-btn');
                    followedChannelIds[channelId] = true;
                    showToast('已关注 ' + name, 'success');
                    loadChannels();
                  }
                })
                .catch(function (e) {
                  setBtnLoading(followBtn, false);
                  showToast('关注失败：' + (e.message || e), 'error');
                });
            }
          });
        });
      });
    });

    bindClearBtn(wrap);
  }

  // ---- tid / season caches ----

  // Load the static tid table (never fails).
  function ensureTids(cb) {
    if (cachedTids) {
      cb(cachedTids);
      return;
    }
    apiGet('/api/tids')
      .then(function (d) {
        cachedTids = Array.isArray(d) ? d : [];
        cb(cachedTids);
      })
      .catch(function () {
        cachedTids = [];
        cb([]);
      });
  }

  // Load the bili seasons list (requires bili cookie, may fail).
  function ensureSeasons(cb) {
    if (cachedSeasons !== null) {
      cb(cachedSeasons);
      return;
    }
    if (seasonsLoading) {
      setTimeout(function () {
        ensureSeasons(cb);
      }, 200);
      return;
    }
    seasonsLoading = true;
    apiGet('/api/seasons')
      .then(function (d) {
        if (d && d.error) {
          cachedSeasons = [];
        } else {
          // Adapt multiple shapes: {seasons:[...]}/{list:[...]}/[...]
          var arr = [];
          if (Array.isArray(d)) arr = d;
          else if (d.seasons) arr = d.seasons;
          else if (d.list) arr = d.list;
          else if (d.items) arr = d.items;
          cachedSeasons = arr;
        }
        seasonsLoading = false;
        cb(cachedSeasons);
      })
      .catch(function () {
        cachedSeasons = [];
        seasonsLoading = false;
        cb([]);
      });
  }

  // ---- followed channels list ----

  function loadChannels() {
    var list = document.getElementById('channels-list');
    if (!list) return;
    list.innerHTML =
      '<div class="rounded-lg px-4 py-8 text-center" style="background:var(--apple-background);border:1px solid var(--apple-border)"><p class="text-sm" style="color:var(--apple-muted-foreground)">加载中…</p></div>';
    apiGet('/api/channels')
      .then(function (d) {
        var items = Array.isArray(d) ? d : (d && d.channels) || [];
        followedChannelIds = {};
        items.forEach(function (ch) {
          followedChannelIds[ch.channel_id] = true;
        });
        list.innerHTML = '';
        if (items.length === 0) {
          list.innerHTML =
            '<div class="rounded-lg px-4 py-8 text-center" style="background:var(--apple-background);border:1px solid var(--apple-border)"><p class="text-sm" style="color:var(--apple-muted-foreground)">暂无关注的频道，请使用上方搜索框添加</p></div>';
          return;
        }
        // Load tids + seasons first, then render cards.
        ensureTids(function (tids) {
          ensureSeasons(function (seasons) {
            items.forEach(function (ch) {
              list.appendChild(renderChannelCard(ch, tids, seasons));
            });
            bindChannelCardEvents(list);
          });
        });
      })
      .catch(function (e) {
        console.warn('[loadChannels]', e);
        list.innerHTML =
          '<div class="rounded-lg px-4 py-8 text-center" style="background:var(--apple-background);border:1px solid var(--apple-border)"><p class="text-sm" style="color:var(--state-error)">加载失败</p></div>';
      });
  }

  // Render a single channel config card.
  function renderChannelCard(ch, tids, seasons) {
    var enabled = ch.enabled !== false;
    var toggleBg = enabled ? 'var(--brand-500)' : 'var(--background-400)';
    var toggleKnob = enabled ? 'right:2px' : 'left:2px';
    var cid = escapeHtml(ch.id || ch.channel_id);

    // Season options
    var seasonOpts = '<option value="">不加入合集</option>';
    if (seasons.length === 0) {
      seasonOpts = '<option value="" disabled>暂无合集(可在 B 站创作中心创建)</option>';
    } else {
      seasons.forEach(function (s) {
        var sid = escapeHtml(String(s.id || s.season_id || ''));
        var sname = escapeHtml(s.name || s.title || s.season_title || '合集 ' + sid);
        var sel = String(ch.season_id) === String(s.id || s.season_id) ? ' selected' : '';
        seasonOpts += '<option value="' + sid + '"' + sel + '>' + sname + '</option>';
      });
    }

    // Tid options (only meaningful tids, tid<=130)
    var tidOpts = '<option value="">默认(知识--科技科普)</option>';
    tids
      .filter(function (t) {
        return t.tid <= 130;
      })
      .forEach(function (t) {
        var sel = ch.tid === t.tid ? ' selected' : '';
        tidOpts += '<option value="' + t.tid + '"' + sel + '>' + escapeHtml(t.name) + '</option>';
      });

    // Subtitle mode
    var sm = {
      translated: '翻译字幕',
      original: '原语言字幕',
      both: '双语字幕',
      none: '不上传字幕',
    };
    var smOpts = '';
    Object.keys(sm).forEach(function (k) {
      var sel = (ch.subtitle_mode || 'translated') === k ? ' selected' : '';
      smOpts += '<option value="' + k + '"' + sel + '>' + sm[k] + '</option>';
    });

    // Copyright / 投稿类型
    var isSelf = ch.copyright === 1;
    var copyrightHtml =
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--apple-foreground)">' +
      '<input type="radio" name="copyright-' +
      cid +
      '" value="1" ' +
      (isSelf ? 'checked' : '') +
      ' style="accent-color:var(--brand-500)"> 自制</label>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--apple-foreground)">' +
      '<input type="radio" name="copyright-' +
      cid +
      '" value="2" ' +
      (!isSelf ? 'checked' : '') +
      ' style="accent-color:var(--brand-500)"> 转载</label>';

    var card = document.createElement('div');
    card.className = 'channel-card';
    card.setAttribute('data-channel-id', cid);
    card.style.cssText =
      'background:var(--apple-background);border:1px solid var(--apple-border);border-radius:8px;padding:16px;margin-bottom:8px';
    card.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">' +
      '<div style="width:48px;height:48px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,var(--brand-100),var(--brand-300))"></div>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<a href="https://www.youtube.com/channel/' +
      escapeHtml(ch.channel_id) +
      '" target="_blank" rel="noopener noreferrer" style="font-size:14px;font-weight:600;color:var(--apple-foreground);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      escapeHtml(ch.name || ch.channel_id) +
      '</a>' +
      '<button data-del-channel="' +
      cid +
      '" style="height:32px;padding:0 12px;border-radius:6px;border:1px solid var(--apple-border);background:transparent;color:var(--state-error);font-size:12px;font-weight:500;cursor:pointer;flex-shrink:0">删除</button>' +
      '</div>' +
      '<p style="font-size:12px;color:var(--apple-muted-foreground);margin:4px 0 0;font-family:monospace">' +
      escapeHtml(ch.channel_id || '') +
      '</p>' +
      '</div>' +
      '</div>' +
      '<div class="channel-config-grid" style="gap:12px;padding-top:12px;border-top:1px solid var(--apple-border)">' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
      '<label for="ch-season_id-' +
      cid +
      '" style="font-size:12px;color:var(--apple-muted-foreground)">B站合集</label>' +
      '<select id="ch-season_id-' +
      cid +
      '" data-field="season_id" style="height:32px;padding:0 8px;border-radius:6px;font-size:12px;background:var(--apple-card);border:1px solid var(--apple-input);color:var(--apple-foreground)">' +
      seasonOpts +
      '</select>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
      '<label for="ch-tid-' +
      cid +
      '" style="font-size:12px;color:var(--apple-muted-foreground)">投稿分区</label>' +
      '<select id="ch-tid-' +
      cid +
      '" data-field="tid" style="height:32px;padding:0 8px;border-radius:6px;font-size:12px;background:var(--apple-card);border:1px solid var(--apple-input);color:var(--apple-foreground)">' +
      tidOpts +
      '</select>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
      '<label for="ch-tags-' +
      cid +
      '" style="font-size:12px;color:var(--apple-muted-foreground)">默认标签</label>' +
      '<input type="text" id="ch-tags-' +
      cid +
      '" data-field="tags" value="' +
      escapeHtml(ch.tags || '') +
      '" placeholder="逗号分隔" style="height:32px;padding:0 8px;border-radius:6px;font-size:12px;background:var(--apple-card);border:1px solid var(--apple-input);color:var(--apple-foreground)"/>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
      '<label style="font-size:12px;color:var(--apple-muted-foreground)">投稿类型</label>' +
      '<div style="display:flex;align-items:center;gap:16px;height:32px">' +
      copyrightHtml +
      '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
      '<label for="ch-subtitle_mode-' +
      cid +
      '" style="font-size:12px;color:var(--apple-muted-foreground)">字幕模式</label>' +
      '<select id="ch-subtitle_mode-' +
      cid +
      '" data-field="subtitle_mode" style="height:32px;padding:0 8px;border-radius:6px;font-size:12px;background:var(--apple-card);border:1px solid var(--apple-input);color:var(--apple-foreground)">' +
      smOpts +
      '</select>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
      '<label id="ch-toggle-label-' +
      cid +
      '" style="font-size:12px;color:var(--apple-muted-foreground)">启用自动投稿</label>' +
      '<div data-toggle-channel="' +
      cid +
      '" data-enabled="' +
      (enabled ? '1' : '0') +
      '" role="switch" tabindex="0" aria-checked="' +
      (enabled ? 'true' : 'false') +
      '" aria-labelledby="ch-toggle-label-' +
      cid +
      '" style="width:40px;height:20px;border-radius:9999px;background:' +
      toggleBg +
      ';cursor:pointer;position:relative;transition:background .18s">' +
      '<div style="position:absolute;top:2px;' +
      toggleKnob +
      ';width:16px;height:16px;border-radius:9999px;background:var(--background-50);transition:left .18s,right .18s"></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--apple-border)">' +
      '<button data-save-channel="' +
      cid +
      '" style="height:32px;padding:0 16px;border-radius:6px;border:none;background:var(--brand-500);color:#fff;font-size:12px;font-weight:500;cursor:pointer">保存配置</button>' +
      '</div>';

    // Inline handlers (onmouseover/onmouseout on the name link) → addEventListener.
    var link = card.querySelector('a');
    if (link) {
      link.addEventListener('mouseover', function () {
        link.style.color = 'var(--brand-500)';
      });
      link.addEventListener('mouseout', function () {
        link.style.color = 'var(--apple-foreground)';
      });
    }

    return card;
  }

  // Save a single channel card config. Resolves to the response body (with
  // .error on failure so callers can branch).
  function saveChannelCard(card) {
    var btn = card.querySelector('[data-save-channel]');
    var id = btn ? btn.getAttribute('data-save-channel') : '';
    var payload = {};
    card.querySelectorAll('[data-field]').forEach(function (el) {
      var f = el.getAttribute('data-field');
      var v = el.value;
      if (f === 'tid') {
        v = v ? parseInt(v, 10) : undefined;
      }
      payload[f] = v;
    });
    // 投稿类型 (radio)
    var radio = card.querySelector('input[name="copyright-' + id + '"]:checked');
    if (radio) payload.copyright = parseInt(radio.value, 10);
    if (btn) setBtnLoading(btn, true, '保存中…');
    return apiFetch('/api/channels/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (d) {
        if (btn) setBtnLoading(btn, false);
        return d;
      })
      .catch(function (e) {
        if (btn) setBtnLoading(btn, false);
        return { error: e.message || e };
      });
  }

  // Bind delete / enable-toggle / save events on rendered channel cards.
  function bindChannelCardEvents(list) {
    // Delete
    list.querySelectorAll('[data-del-channel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-del-channel');
        showModal({
          title: '确认删除频道',
          body: '删除后该频道的自动投稿将停止。确认删除?',
          okText: '删除',
          onOk: function () {
            apiFetch('/api/channels/' + encodeURIComponent(id), { method: 'DELETE' })
              .then(function (d) {
                if (d.error) {
                  showToast(d.error, 'error');
                } else {
                  showToast('已删除', 'success');
                  loadChannels();
                }
              })
              .catch(function (e) {
                showToast('删除失败:' + (e.message || e), 'error');
              });
          },
        });
      });
    });

    // Enable toggle
    list.querySelectorAll('[data-toggle-channel]').forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        var id = toggle.getAttribute('data-toggle-channel');
        var knob = toggle.querySelector('div');
        var nowOn = toggle.getAttribute('data-enabled') === '1';
        var newVal = !nowOn;
        apiFetch('/api/channels/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: newVal }),
        })
          .then(function (d) {
            if (d.error) {
              showToast(d.error, 'error');
              return;
            }
            toggle.setAttribute('data-enabled', newVal ? '1' : '0');
            toggle.setAttribute('aria-checked', newVal ? 'true' : 'false');
            toggle.style.background = newVal ? 'var(--brand-500)' : 'var(--background-400)';
            knob.style.left = newVal ? '' : '2px';
            knob.style.right = newVal ? '2px' : '';
            showToast(newVal ? '已启用' : '已停用', 'success');
          })
          .catch(function (e) {
            showToast('操作失败:' + (e.message || e), 'error');
          });
      });
      toggle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          toggle.click();
        }
      });
    });

    // Save config
    list.querySelectorAll('[data-save-channel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.channel-card');
        if (!card) return;
        saveChannelCard(card).then(function (d) {
          if (d.error) showToast(d.error, 'error');
          else showToast('配置已保存', 'success');
        });
      });
    });
  }

  // Initial load.
  loadChannels();

  // Batch "保存频道配置" button: save every card.
  var saveChannelBtn = channelsSection.querySelector('[data-dom-id="channels-save-btn"]');
  if (!saveChannelBtn) {
    channelsSection.querySelectorAll('button').forEach(function (b) {
      if (b.textContent.trim() === '保存频道配置') saveChannelBtn = b;
    });
  }
  if (saveChannelBtn) {
    saveChannelBtn.addEventListener('click', function () {
      var cards = channelsSection.querySelectorAll('.channel-card');
      if (cards.length === 0) {
        showToast('暂无频道可保存', 'info');
        return;
      }
      setBtnLoading(saveChannelBtn, true, '批量保存中…');
      var promises = [];
      cards.forEach(function (card) {
        promises.push(saveChannelCard(card));
      });
      Promise.all(promises).then(function (results) {
        setBtnLoading(saveChannelBtn, false);
        var ok = 0,
          fail = 0;
        results.forEach(function (d) {
          if (d && d.error) fail++;
          else ok++;
        });
        if (fail === 0) {
          showToast('批量保存完成,成功 ' + ok + ' 个', 'success');
        } else {
          showToast('批量保存:成功 ' + ok + ' 个,失败 ' + fail + ' 个', 'error');
        }
      });
    });
  }

  // B 站登录成功后,清除合集缓存并重新加载频道列表(让合集下拉刷新)
  document.addEventListener('bili-login-success', function () {
    cachedSeasons = null;     // 清缓存,强制下次 ensureSeasons 重新拉取
    seasonsLoading = false;
    loadChannels();           // 重新渲染频道卡片(会触发 ensureSeasons)
  });

  // 主动预加载合集缓存(B 站已登录时立即可用,供关注弹窗/频道卡片使用)
  ensureSeasons(function () {});
}
