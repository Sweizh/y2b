// status.mjs — 运行状态 section (migrated from console.html lines 1991-2234)
//
// Public API:
//   initStatus() — bind 立即执行 trigger, load & poll status / processed-videos
//                  tables, update stats cards + cookie hint, wire failure-notify
//                  config. Polling interval preserved at 30s (same as original).
//
// API endpoints (preserved verbatim):
//   GET    /api/status             — stats + recent_records + cookie/system status
//   POST   /api/status/trigger     — trigger pipeline run
//   GET    /api/processed          — processed videos list
//   DELETE /api/processed/:id       — remove a processed video (re-processable next run)
//   PUT    /api/config             — save notify_webhook config
//
// Preserved selectors / data-dom-id:
//   #section-status, [data-dom-id="trigger-btn"], .grid.grid-cols-3 > div,
//   [data-cookie-hint], #status-records-tbody, #processed-tbody,
//   #notify-enabled, #notify-webhook-url, #notify-save-btn,
//   notifySwitch.parentElement.querySelector('div.relative'),
//   .processed-del-btn[data-video-id]
//
// Deviation note:
//   formatTime(ms) from utils.mjs is NOT used for the timestamps here. The
//   original renders an explicit "YYYY-MM-DD HH:MM" string (no seconds), while
//   formatTime returns a locale string (with seconds) for epoch-ms inputs and
//   '' for ISO strings. Adopting it would change the visible date format and
//   risk empty cells for ISO-string payloads — a regression during a refactor.
//   The original formatting is preserved verbatim in the local fmtDateTime().

import { showToast } from '../components/toast.mjs';
import { setBtnLoading } from '../components/button.mjs';
import { showModal } from '../components/modal.mjs';
import { apiGet, apiPost, apiFetch } from '../api.mjs';
import { escapeHtml } from '../utils.mjs';

/**
 * Format a date value as "YYYY-MM-DD HH:MM" (no seconds).
 * Faithful to the original inline formatting (console.html lines 2034, 2096, 2130).
 * @param {*} val  value accepted by new Date() (ISO string or epoch ms)
 * @returns {string}
 */
function fmtDateTime(val) {
  const dt = new Date(val);
  return dt.getFullYear() + '-' +
    String(dt.getMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getDate()).padStart(2, '0') + ' ' +
    String(dt.getHours()).padStart(2, '0') + ':' +
    String(dt.getMinutes()).padStart(2, '0');
}

/**
 * Initialize the 运行状态 section. No-op if #section-status is absent.
 */
export function initStatus() {
  const statusSection = document.getElementById('section-status');
  if (!statusSection) return;

  // ===== 加载状态 =====
  function loadStatus() {
    apiGet('/api/status')
      .then(function (d) {
        // 更新统计卡片
        const stats = statusSection.querySelectorAll('.grid.grid-cols-3 > div');
        if (stats.length >= 3) {
          // 上次运行
          const v1 = stats[0].querySelectorAll('p')[1];
          if (v1) {
            if (d.last_run_at) {
              v1.textContent = fmtDateTime(d.last_run_at);
            } else {
              v1.textContent = '--';
            }
          }
          // 累计处理
          const v2 = stats[1].querySelectorAll('p')[1];
          if (v2) {
            v2.textContent = (d.total_processed !== undefined && d.total_processed !== null)
              ? (d.total_processed + ' 个视频')
              : '--';
          }
          // 系统状态
          const v3 = stats[2].querySelector('span');
          if (v3) {
            if (d.system_status) {
              const ok = d.system_status === 'normal';
              v3.textContent = ok ? '正常运行' : (d.system_status === 'degraded' ? '降级运行' : '异常');
              v3.style.background = ok ? 'var(--state-success-surface)' : 'var(--state-error-surface)';
              v3.style.color = ok ? 'var(--state-success)' : 'var(--state-error)';
              // 显示 Runner 上报的失败摘要(若有),便于管理员快速定位
              if (d.error_summary) {
                v3.title = '失败摘要：' + d.error_summary;
              } else {
                v3.title = '';
              }
            } else {
              v3.textContent = '--';
              v3.style.background = 'var(--apple-secondary)';
              v3.style.color = 'var(--apple-muted-foreground)';
              v3.title = '';
            }
          }
          // Cookie 状态:显示在统计卡片下方
          const cookieHint = statusSection.querySelector('[data-cookie-hint]');
          if (cookieHint) {
            if (d.cookie_status === 'expired') {
              cookieHint.textContent = 'B 站 Cookie 已失效,请重新登录';
              cookieHint.style.color = 'var(--state-error)';
              cookieHint.style.display = '';
            } else if (d.cookie_status === 'expiring') {
              cookieHint.textContent = 'B 站 Cookie 即将过期,请尽快重登';
              cookieHint.style.color = 'var(--state-warning,#d97706)';
              cookieHint.style.display = '';
            } else {
              cookieHint.style.display = 'none';
            }
          }
        }
        // 更新处理记录表
        const tbody = document.getElementById('status-records-tbody');
        if (tbody) {
          const records = d.recent_records || [];
          tbody.innerHTML = '';
          if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-xs" style="color:var(--apple-muted-foreground)">暂无处理记录</td></tr>';
          } else {
            records.forEach(function (r) {
              const tr = document.createElement('tr');
              tr.style.cssText = 'border-top:1px solid var(--apple-border)';
              const statusBadge = r.status === 'success'
                ? '<span style="background:var(--state-success-surface);color:var(--state-success);padding:2px 8px;border-radius:12px;font-size:12px">成功</span>'
                : '<span style="background:var(--state-error-surface);color:var(--state-error);padding:2px 8px;border-radius:12px;font-size:12px">失败' + (r.stage ? ' (' + escapeHtml(r.stage) + ')' : '') + '</span>';
              const timeStr = fmtDateTime(r.processed_at);
              tr.innerHTML =
                '<td style="padding:12px 16px;font-size:12px;font-weight:500;color:var(--apple-foreground)">' + escapeHtml(r.channel || '') + '</td>' +
                '<td style="padding:12px 16px;font-size:12px;color:var(--apple-foreground)">' + escapeHtml(r.video_title || '') + '</td>' +
                '<td style="padding:12px 16px">' + statusBadge + '</td>' +
                '<td style="padding:12px 16px;font-size:12px;font-family:monospace;color:var(--apple-muted-foreground);white-space:nowrap">' + timeStr + '</td>' +
                '<td style="padding:12px 16px;font-size:12px;color:var(--apple-muted-foreground)">' + escapeHtml(r.message || '--') + '</td>';
              tbody.appendChild(tr);
            });
          }
        }
      })
      .catch(function (e) { console.warn('[loadStatus]', e); });
  }

  // ===== 立即执行 =====
  let execBtn = statusSection.querySelector('[data-dom-id="trigger-btn"]');
  if (!execBtn) {
    statusSection.querySelectorAll('button').forEach(function (b) {
      if (b.textContent.trim() === '立即执行') execBtn = b;
    });
  }
  if (execBtn) {
    execBtn.addEventListener('click', function () {
      setBtnLoading(execBtn, true, '触发中…');
      apiPost('/api/status/trigger')
        .then(function (d) {
          setBtnLoading(execBtn, false);
          if (d.error) {
            showToast(d.error, 'error');
          } else {
            showToast(d.message || '已触发', 'success');
            // 延迟刷新状态
            setTimeout(loadStatus, 5000);
          }
        })
        .catch(function (e) {
          setBtnLoading(execBtn, false);
          showToast('触发失败：' + (e.message || e), 'error');
        });
    });
  }

  loadStatus();
  // 自动刷新
  setInterval(loadStatus, 30000);

  // ===== 已处理视频列表 =====
  function loadProcessed() {
    const tbody = document.getElementById('processed-tbody');
    if (!tbody) return;
    apiGet('/api/processed')
      .then(function (d) {
        const items = d.items || [];
        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-xs" style="color:var(--apple-muted-foreground)">暂无已处理视频</td></tr>';
          return;
        }
        tbody.innerHTML = '';
        items.forEach(function (item) {
          const tr = document.createElement('tr');
          tr.style.cssText = 'border-top:1px solid var(--apple-border)';
          const timeStr = fmtDateTime(item.processed_at || 0);
          const statusBadge = item.status === 'success'
            ? '<span style="background:var(--state-success-surface);color:var(--state-success);padding:2px 8px;border-radius:12px;font-size:11px">成功</span>'
            : '<span style="background:var(--state-error-surface);color:var(--state-error);padding:2px 8px;border-radius:12px;font-size:11px">失败' + (item.stage ? ' (' + escapeHtml(item.stage) + ')' : '') + '</span>';
          tr.innerHTML =
            '<td class="px-4 py-3 text-xs truncate" style="color:var(--apple-foreground);max-width:200px">' + escapeHtml(item.title || item.video_id) + '</td>' +
            '<td class="px-4 py-3 text-xs font-mono whitespace-nowrap" style="color:var(--apple-muted-foreground)">' + escapeHtml(item.bvid || '--') + '</td>' +
            '<td class="px-4 py-3 text-xs truncate" style="color:var(--apple-foreground);max-width:140px">' + escapeHtml(item.channel || '--') + '</td>' +
            '<td class="px-4 py-3">' + statusBadge + '</td>' +
            '<td class="px-4 py-3 text-xs font-mono whitespace-nowrap" style="color:var(--apple-muted-foreground)">' + timeStr + '</td>' +
            '<td class="px-4 py-3 text-right"><button class="processed-del-btn" data-video-id="' + escapeHtml(item.video_id) + '" aria-label="删除" style="padding:6px 10px;border-radius:6px;background:transparent;border:1px solid var(--apple-border);color:var(--state-error);cursor:pointer;font-size:11px;min-height:32px">删除</button></td>';
          tbody.appendChild(tr);
        });
        // 绑定删除事件(事件委托)
        tbody.onclick = function (e) {
          const btn = e.target.closest('.processed-del-btn');
          if (!btn) return;
          const videoId = btn.dataset.videoId;
          const row = btn.closest('tr');
          showModal({
            title: '确认删除',
            body: '删除后该视频可在下次流水线运行时重新处理。确认删除?',
            okText: '删除',
            onOk: function () {
              apiFetch('/api/processed/' + encodeURIComponent(videoId), { method: 'DELETE' })
                .then(function (d) {
                  if (d.error) {
                    showToast(d.error, 'error');
                  } else {
                    showToast('已删除,该视频可在下次运行时重新处理', 'success');
                    if (row) row.parentNode.removeChild(row);
                  }
                })
                .catch(function (e) { showToast('删除失败:' + (e.message || e), 'error'); });
            }
          });
        };
      })
      .catch(function (e) {
        console.warn('[loadProcessed]', e);
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-xs" style="color:var(--apple-muted-foreground)">加载失败</td></tr>';
      });
  }

  loadProcessed();
  setInterval(loadProcessed, 30000);

  // ===== 失败通知配置 =====
  const notifySwitch = document.getElementById('notify-enabled');
  const notifyUrlInput = document.getElementById('notify-webhook-url');
  const notifySaveBtn = document.getElementById('notify-save-btn');
  const notifySwitchWrap = notifySwitch ? notifySwitch.parentElement.querySelector('div.relative') : null;

  function setNotifySwitchUI(on) {
    if (!notifySwitchWrap) return;
    const knob = notifySwitchWrap.querySelector('div.absolute');
    notifySwitchWrap.style.background = on ? 'var(--brand-500)' : 'var(--background-400)';
    knob.classList.remove('left-0.5', 'right-0.5');
    knob.classList.add(on ? 'right-0.5' : 'left-0.5');
    if (notifyUrlInput) notifyUrlInput.disabled = !on;
    if (notifySaveBtn) notifySaveBtn.disabled = !on;
  }

  if (notifySwitch) {
    notifySwitch.addEventListener('change', function () {
      setNotifySwitchUI(notifySwitch.checked);
    });
    // 整个开关 wrap 可点
    if (notifySwitchWrap) {
      notifySwitchWrap.addEventListener('click', function (e) {
        e.preventDefault();
        notifySwitch.checked = !notifySwitch.checked;
        setNotifySwitchUI(notifySwitch.checked);
      });
    }
  }

  // 保存按钮
  if (notifySaveBtn) {
    notifySaveBtn.addEventListener('click', function () {
      const url = notifySwitch && notifySwitch.checked ? (notifyUrlInput.value.trim()) : '';
      if (notifySwitch && notifySwitch.checked && !url) {
        showToast('请输入 Webhook URL', 'error');
        return;
      }
      setBtnLoading(notifySaveBtn, true, '保存中…');
      apiPost('/api/config', { notify_webhook: url }, { method: 'PUT' })
        .then(function (d) {
          setBtnLoading(notifySaveBtn, false);
          if (d.error) showToast(d.error, 'error');
          else showToast('失败通知配置已保存', 'success');
        })
        .catch(function (e) {
          setBtnLoading(notifySaveBtn, false);
          showToast('保存失败:' + (e.message || e), 'error');
        });
    });
  }
}
