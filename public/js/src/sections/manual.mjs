// manual.mjs — 手动添加视频 section (migrated from console.html lines 2235-2390)
//
// Public API:
//   initManual() — bind 添加到队列 button, render queue list, load selects,
//                  load existing queue on init.
//
// DOM hooks (preserved from original):
//   #section-manual                          — section container
//   textarea (within section)                — multi-line URL input
//   [data-dom-id="manual-add-btn"]           — 添加到队列 button
//   [data-dom-id="manual-channel-select"]    — 不指定频道 select
//   [data-dom-id="manual-season-select"]     — B 站合集 select
//   #manual-queue-list                        — queue list container
//
// API endpoints (preserved from original):
//   POST   /api/manual-queue            — body {urls, channel_config_id?, season_id?} → {added}
//   GET    /api/manual-queue            → {items:[{title, video_id, status, retry_count}]}
//   DELETE /api/manual-queue/:video_id  → remove item from queue
//   GET    /api/channels                → channels for the 不指定频道 select
//   GET    /api/seasons                 → seasons for the B 站合集 select
//
// Status badges (preserved from original):
//   status === 'retry' → '重试中(N)' / color var(--state-error)
//   else (pending/processing) → '等待中' / color var(--apple-muted-foreground)

import { showToast } from '../components/toast.mjs';
import { showModal } from '../components/modal.mjs';
import { setBtnLoading } from '../components/button.mjs';
import { apiFetch, apiGet, apiPost } from '../api.mjs';
import { escapeHtml } from '../utils.mjs';

export function initManual() {
  const manualSection = document.getElementById('section-manual');
  if (!manualSection) return;

  const textarea = manualSection.querySelector('textarea');
  let addBtn = manualSection.querySelector('[data-dom-id="manual-add-btn"]');
  if (!addBtn) {
    manualSection.querySelectorAll('button').forEach(function (b) {
      if (b.textContent.trim() === '添加到队列') addBtn = b;
    });
  }
  const manualChannelSelect = manualSection.querySelector('[data-dom-id="manual-channel-select"]');
  const manualSeasonSelect = manualSection.querySelector('[data-dom-id="manual-season-select"]');
  const queueList = document.getElementById('manual-queue-list');

  if (textarea && addBtn) {
    addBtn.addEventListener('click', function () {
      const text = textarea.value.trim();
      if (!text) { showToast('请输入视频 URL', 'error'); return; }
      const urls = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      const body = { urls: urls };
      // 包含所选频道 ID(若 select 有值)
      if (manualChannelSelect && manualChannelSelect.value) {
        body.channel_config_id = manualChannelSelect.value;
      }
      // 包含所选合集 ID(若 select 有值)
      if (manualSeasonSelect && manualSeasonSelect.value) {
        body.season_id = manualSeasonSelect.value;
      }
      setBtnLoading(addBtn, true, '添加中…');
      apiPost('/api/manual-queue', body)
        .then(function (d) {
          setBtnLoading(addBtn, false);
          if (d.error) {
            showToast(d.error, 'error');
            return;
          }
          showToast('已添加 ' + d.added + ' 个视频', 'success');
          textarea.value = '';
          loadManualQueue();
        })
        .catch(function (e) {
          setBtnLoading(addBtn, false);
          showToast('添加失败：' + (e.message || e), 'error');
        });
    });
  }

  // 加载「不指定频道」select 的频道选项
  function loadManualChannelOptions() {
    if (!manualChannelSelect) return;
    apiGet('/api/channels')
      .then(function (d) {
        const items = Array.isArray(d) ? d : (d && d.channels) || [];
        // 保留空选项「不指定频道」,清空其余
        const currentVal = manualChannelSelect.value;
        manualChannelSelect.innerHTML = '<option value="">不指定频道</option>';
        items.forEach(function (ch) {
          const opt = document.createElement('option');
          opt.value = ch.id || ch.channel_id;
          opt.textContent = ch.name || ch.channel_id;
          manualChannelSelect.appendChild(opt);
        });
        if (currentVal) manualChannelSelect.value = currentVal;
      })
      .catch(function (e) {
        console.warn('[loadManualChannelOptions]', e);
      });
  }
  loadManualChannelOptions();

  // 加载「B 站合集」select 的合集选项(复用 /api/seasons,与频道卡片一致)
  function loadManualSeasonOptions() {
    if (!manualSeasonSelect) return;
    apiGet('/api/seasons')
      .then(function (d) {
        // 适配多种返回结构:{seasons:[...]}/{list:[...]}/[...]
        let seasons = [];
        let errMsg = '';
        if (d && d.error) {
          seasons = [];
          errMsg = d.error;
        } else if (Array.isArray(d)) seasons = d;
        else if (d.seasons) seasons = d.seasons;
        else if (d.list) seasons = d.list;
        else if (d.items) seasons = d.items;
        let seasonOpts = '<option value="">不指定合集(用频道默认)</option>';
        if (seasons.length === 0) {
          // 区分"未配置凭证" / "API 报错" / "暂无合集"
          if (errMsg) {
            seasonOpts = '<option value="" disabled>' + escapeHtml(errMsg.slice(0, 60)) + '</option>';
          } else {
            seasonOpts = '<option value="" disabled>暂无合集(可在 B 站创作中心创建)</option>';
          }
        } else {
          seasons.forEach(function (s) {
            // B 站创作中心 seasons 返回项为 {season:{id,title,...}, ...},
            // 同时兼容扁平 {id,title}/{season_id,season_title}
            const inner = s.season || s;
            const sid = escapeHtml(String(inner.id || s.id || s.season_id || ''));
            const sname = escapeHtml(inner.title || s.name || s.title || s.season_title || ('合集 ' + sid));
            seasonOpts += '<option value="' + sid + '">' + sname + '</option>';
          });
        }
        const currentVal = manualSeasonSelect.value;
        manualSeasonSelect.innerHTML = seasonOpts;
        if (currentVal) manualSeasonSelect.value = currentVal;
      })
      .catch(function (e) {
        console.warn('[loadManualSeasonOptions]', e);
        if (manualSeasonSelect) {
          manualSeasonSelect.innerHTML = '<option value="" disabled>加载合集失败</option>';
        }
      });
  }
  loadManualSeasonOptions();

  function loadManualQueue() {
    if (!queueList) return;
    apiGet('/api/manual-queue')
      .then(function (d) {
        queueList.innerHTML = '';
        const items = d.items || [];
        if (items.length === 0) {
          queueList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--apple-muted-foreground);font-size:13px">暂无待处理视频</div>';
          return;
        }
        items.forEach(function (item) {
          const div = document.createElement('div');
          div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:8px;background:var(--apple-background);border:1px solid var(--apple-border)';
          const statusText = item.status === 'retry' ? '重试中(' + (item.retry_count || 0) + ')' : '等待中';
          const statusColor = item.status === 'retry' ? 'var(--state-error)' : 'var(--apple-muted-foreground)';
          div.innerHTML = '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:12px">' +
            '<span style="font-size:13px;font-weight:500;color:var(--apple-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(item.title || item.video_id) + '</span>' +
            '<span style="background:var(--apple-secondary);color:' + statusColor + ';padding:2px 8px;border-radius:12px;font-size:11px;white-space:nowrap">' + statusText + '</span>' +
            '</div>' +
            '<button aria-label="删除" style="padding:6px;border-radius:6px;background:transparent;border:none;color:var(--apple-muted-foreground);cursor:pointer;min-width:44px;min-height:44px">' +
            '<span style="font-size:16px">×</span>' +
            '</button>';
          const delBtn = div.querySelector('button');
          delBtn.addEventListener('click', function () {
            showModal({
              title: '确认删除',
              body: '确认从队列删除「' + (item.title || item.video_id) + '」？',
              onOk: function () {
                apiFetch('/api/manual-queue/' + encodeURIComponent(item.video_id), { method: 'DELETE' })
                  .then(function (d) {
                    if (d.error) {
                      showToast(d.error, 'error');
                    } else {
                      showToast('已删除', 'success');
                      loadManualQueue();
                    }
                  })
                  .catch(function (e) { showToast('删除失败：' + (e.message || e), 'error'); });
              }
            });
          });
          queueList.appendChild(div);
        });
      })
      .catch(function (e) { console.warn('[loadManualQueue]', e); });
  }
  loadManualQueue();

  // B 站登录成功后,重新加载合集选项
  document.addEventListener('bili-login-success', function () {
    loadManualSeasonOptions();
  });
}
