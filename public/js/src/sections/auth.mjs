// auth.mjs — 鉴权与登录(section module, migrated from console.html)
//
// Migrated source ranges:
//   Auth check (/api/init-status → /api/config probe)   (lines 1113-1133)
//   Logout button → showModal confirm → POST /api/logout  (lines 1205-1225)
//   openBiliQrcodeLogin()  — QR modal + countdown + poll   (lines 2398-2510)
//   openBiliPopupLogin()   — popup + cookie-paste modal    (lines 2511-2641)
//   openYtOAuthLogin()     — window.open + postMessage     (lines 2642-2670)
//   openChangePasswordModal() — old/new password modal     (lines 2671-2748)
//   Button bindings (bili/yt/change-pwd + OAuth config)    (lines 2749-2776)
//
// Public API:
//   initAuth()                 → run auth check + bind all auth/login buttons.
//   openBiliQrcodeLogin()      → QR-code login flow (exported for reuse; not
//                                bound to a button in the original — only
//                                called recursively by its own refresh button).
//   openBiliPopupLogin()       → popup + cookie-paste login flow.
//   openYtOAuthLogin()         → YouTube OAuth popup flow.
//   openChangePasswordModal()  → change admin password modal.
//
// Preserved contracts (CRITICAL):
//   - data-dom-id selectors: logout-btn, bili-qrcode-login, yt-oauth-login,
//     change-password-btn, yt-oauth-config-toggle, yt-oauth-config-wrap.
//     NOTE: the task brief listed "bili-qrcode-btn / bili-cookie-btn /
//     yt-oauth-btn" but those IDs do NOT exist in console.html. The real
//     bindings (verified by grep of console.html lines 510-600 & 2750-2771)
//     are preserved here verbatim:
//       [data-dom-id="bili-qrcode-login"]  → openBiliPopupLogin
//       [data-dom-id="yt-oauth-login"]     → openYtOAuthLogin
//       [data-dom-id="change-password-btn"] → openChangePasswordModal
//   - API paths: /api/init-status, /api/config, /api/logout,
//     /api/bili/login/qrcode, /api/bili/login/qrcode/status,
//     /api/bili/login/cookie, /api/youtube/oauth/start,
//     /api/auth/change-password (verified against src/routes/auth.ts:131
//     app.post('/auth/change-password'); the brief's "/api/change-password"
//     was a shorthand — the actual frontend + backend path is /api/auth/*).
//   - OAuth postMessage receiver: only accepts same-origin messages whose
//     data.type === 'yt-oauth-result' (SEC-03). Preserved exactly.
//   - QR polling interval 2000ms; countdown 1000ms. Preserved exactly.
//   - window.open popup behavior preserved.
//   - Complex modals (QR / cookie / change-password) keep their original
//     hand-built overlay+dialog code (same CSS vars as modal.mjs) because
//     showModal only supports simple title/body/ok/cancel confirms. The
//     logout confirm — a simple confirm — uses showModal().
//
// Migration note on loadConfigToForm():
//   The original openBiliQrcodeLogin / openBiliPopupLogin / openYtOAuthLogin
//   each called the global loadConfigToForm() after success to refresh the
//   form (credential field values + login-status echoes). That god-function
//   was split across credentials.mjs / ai-services.mjs in tasks 2-3, and only
//   a cached loadConfig() is exported now. To preserve the user-VISIBLE
//   behavior (the login-status echoes flipping to "已登录" right after a
//   successful B站/YouTube login) without modifying the already-finished
//   section modules, this module ships a focused refreshConfigDisplay()
//   helper that does a fresh GET /api/config and updates the three status
//   echoes (admin-password-status / bili-login-status / yt-login-status)
//   with the exact original logic (console.html lines 1254-1287).

import { apiFetch, apiPost } from '../api.mjs';
import { showToast } from '../components/toast.mjs';
import { setBtnLoading } from '../components/button.mjs';
import { showModal } from '../components/modal.mjs';

/**
 * Fresh-fetch /api/config and refresh the three auth-relevant login-status
 * echoes inside #section-credentials. Faithful to console.html lines
 * 1254-1287. No-op (swallowed) on failure so a refresh error never blocks
 * the post-login toast.
 * @returns {Promise<void>}
 */
function refreshConfigDisplay() {
  return apiFetch('/api/config')
    .then(function (cfg) {
      var credSection = document.getElementById('section-credentials');
      if (!credSection) return;
      var pwdStatus = credSection.querySelector('[data-dom-id="admin-password-status"]');
      if (pwdStatus) {
        if (cfg.initialized) {
          pwdStatus.textContent = '已设置';
          pwdStatus.style.color = 'var(--state-success)';
        } else {
          pwdStatus.textContent = '未设置';
          pwdStatus.style.color = 'var(--apple-muted-foreground)';
        }
      }
      var biliStatus = credSection.querySelector('[data-dom-id="bili-login-status"]');
      if (biliStatus) {
        if (cfg.bili_login_at && cfg.bili_login_at > 0) {
          var biliDt = new Date(cfg.bili_login_at);
          var biliTs = biliDt.getFullYear() + '-' + String(biliDt.getMonth() + 1).padStart(2, '0') + '-' + String(biliDt.getDate()).padStart(2, '0') + ' ' + String(biliDt.getHours()).padStart(2, '0') + ':' + String(biliDt.getMinutes()).padStart(2, '0');
          biliStatus.textContent = '已登录(账号: ' + (cfg.bili_uname || '(未知)') + ', 时间: ' + biliTs + ')';
          biliStatus.style.color = 'var(--state-success)';
        } else {
          biliStatus.textContent = '未登录';
          biliStatus.style.color = 'var(--apple-muted-foreground)';
        }
      }
      var ytStatus = credSection.querySelector('[data-dom-id="yt-login-status"]');
      if (ytStatus) {
        if (cfg.yt_user_email) {
          ytStatus.textContent = '已登录(email: ' + cfg.yt_user_email + ')';
          ytStatus.style.color = 'var(--state-success)';
        } else {
          ytStatus.textContent = '未登录';
          ytStatus.style.color = 'var(--apple-muted-foreground)';
        }
      }
    })
    .catch(function () { /* ignore — echoes left as-is */ });
}

/**
 * B 站扫码登录. Fetches a QR code, shows a modal with the QR image + a
 * countdown + a refresh button, and polls /api/bili/login/qrcode/status
 * every 2000ms until success/expired.
 * Faithful to console.html lines 2398-2510.
 */
export function openBiliQrcodeLogin() {
  var pollTimer = null;
  var countdownTimer = null;
  var qrcodeKey = null;
  // 1. 获取二维码
  apiFetch('/api/bili/login/qrcode')
    .then(function (d) {
      if (d.error) { showToast(d.error, 'error'); return; }
      qrcodeKey = d.qrcode_key;
      var expiresAt = d.expires_at;
      // 2. 弹出 modal 显示二维码 + 倒计时 + 刷新按钮
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;animation:modal-fade .18s ease';
      var dialog = document.createElement('div');
      dialog.style.cssText = 'background:var(--apple-card);color:var(--apple-card-foreground);border-radius:16px;padding:24px;max-width:360px;width:100%;box-shadow:var(--shadow-2xl);text-align:center';
      var title = document.createElement('h3');
      title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 12px';
      title.textContent = '扫码登录 B 站';
      var img = document.createElement('img');
      img.src = d.qrcode_url;
      img.style.cssText = 'width:220px;height:220px;border-radius:8px;border:1px solid var(--apple-border);display:block;margin:0 auto';
      var statusP = document.createElement('p');
      statusP.style.cssText = 'font-size:13px;margin:12px 0 4px;color:var(--apple-muted-foreground)';
      statusP.textContent = '请使用 B 站 App 扫描二维码';
      var countdownP = document.createElement('p');
      countdownP.style.cssText = 'font-size:12px;margin:4px 0;color:var(--apple-muted-foreground);font-family:var(--font-mono)';
      var refreshBtn = document.createElement('button');
      refreshBtn.textContent = '刷新二维码';
      refreshBtn.style.cssText = 'height:36px;padding:0 16px;border-radius:8px;border:1px solid var(--apple-border);background:transparent;color:var(--apple-foreground);cursor:pointer;font-size:13px;display:none';
      var closeBtn = document.createElement('button');
      closeBtn.textContent = '关闭';
      closeBtn.style.cssText = 'height:36px;padding:0 16px;border-radius:8px;border:none;background:var(--brand-500);color:var(--background-50);cursor:pointer;font-size:13px;margin-left:8px';
      var btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:12px';
      btnRow.appendChild(refreshBtn);
      btnRow.appendChild(closeBtn);
      dialog.appendChild(title);
      dialog.appendChild(img);
      dialog.appendChild(statusP);
      dialog.appendChild(countdownP);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      function cleanup() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      function updateCountdown() {
        var now = Math.floor(Date.now() / 1000);
        var remaining = expiresAt - now;
        if (remaining <= 0) {
          countdownP.textContent = '二维码已过期';
          statusP.textContent = '二维码已过期,请刷新';
          statusP.style.color = 'var(--state-error)';
          refreshBtn.style.display = '';
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        } else {
          var mm = Math.floor(remaining / 60);
          var ss = remaining % 60;
          countdownP.textContent = '剩余 ' + mm + ':' + String(ss).padStart(2, '0');
        }
      }
      updateCountdown();
      countdownTimer = setInterval(updateCountdown, 1000);
      function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(function () {
          apiFetch('/api/bili/login/qrcode/status?qrcode_key=' + encodeURIComponent(qrcodeKey))
            .then(function (st) {
              if (st.status === 'success') {
                cleanup();
                showToast('登录成功,账号: ' + (st.uname || '(未知)'), 'success');
                // 刷新表单字段(B站 4 字段填充脱敏值)
                refreshConfigDisplay();
                // 自动调 /api/seasons 缓存合集列表(获取后丢弃,触发后端缓存)
                apiFetch('/api/seasons').then(function () { /* discard */ }).catch(function () {});
                // 调 /api/test/bili 验证凭证
                apiFetch('/api/test/bili', { method: 'POST' })
                  .then(function (t) { if (t && t.success) showToast('B 站凭证验证: ' + (t.message || '有效'), 'success'); })
                  .catch(function () {});
              } else if (st.status === 'expired') {
                statusP.textContent = '二维码已过期,请刷新';
                statusP.style.color = 'var(--state-error)';
                countdownP.textContent = '二维码已过期';
                refreshBtn.style.display = '';
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
              } else if (st.status === 'scanned') {
                statusP.textContent = '已扫码,请在手机上确认';
                statusP.style.color = 'var(--brand-500)';
              } else if (st.status === 'waiting') {
                statusP.textContent = '请使用 B 站 App 扫描二维码';
              }
            })
            .catch(function () {});
        }, 2000);
      }
      startPolling();
      closeBtn.onclick = cleanup;
      overlay.onclick = function (e) { if (e.target === overlay) cleanup(); };
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', esc); } }, { once: true });
      refreshBtn.onclick = function () { cleanup(); openBiliQrcodeLogin(); };
    })
    .catch(function (e) {
      showToast('获取二维码失败:' + (e.message || e), 'error');
    });
}

/**
 * B 站弹窗登录(用户侧浏览器登录 + 从 Network 面板复制 cookie 回传)。
 * 备选方案:扫码登录修复后优先用扫码;此弹窗登录作为备选。
 * 为什么不从 Console 复制 document.cookie: SESSDATA 是 HttpOnly,
 *   document.cookie 读不到 SESSDATA,只能拿到 bili_jct 等非 HttpOnly 字段。
 * 改用从 Network 面板复制请求头 cookie:请求头会包含完整 cookie(含 HttpOnly)。
 * Faithful to console.html lines 2511-2641.
 */
export function openBiliPopupLogin() {
  var popup = window.open('https://passport.bilibili.com/login', 'bili-login-popup', 'width=1024,height=700');
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;animation:modal-fade .18s ease';
  var dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--apple-card);color:var(--apple-card-foreground);border-radius:16px;padding:24px;max-width:520px;width:100%;box-shadow:var(--shadow-2xl);max-height:90vh;overflow-y:auto';
  var title = document.createElement('h3');
  title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 12px';
  title.textContent = '弹窗登录 B 站';
  var steps = document.createElement('ol');
  steps.style.cssText = 'font-size:13px;line-height:1.7;margin:0 0 12px;padding-left:20px;color:var(--apple-foreground)';
  steps.innerHTML = '<li>在弹出的窗口中正常登录 B 站(账号密码/扫码均可)</li>' +
    '<li>登录成功后,在 B 站任意页面按 <kbd>F12</kbd> 打开开发者工具</li>' +
    '<li>切到 <kbd>Network</kbd>(网络)标签,刷新页面(F5)</li>' +
    '<li>点击列表中任意一个请求(如 <code>nav</code>、<code>index.html</code>)</li>' +
    '<li>在右侧 <kbd>Headers</kbd> → <kbd>Request Headers</kbd> 中找到 <code>cookie:</code> 行,右键复制值</li>' +
    '<li>回到本窗口,在下方输入框粘贴(<kbd>Ctrl/Cmd+V</kbd>),点「保存 Cookie」</li>';
  var warn = document.createElement('div');
  warn.style.cssText = 'background:var(--apple-muted);border-left:3px solid var(--state-warning);padding:8px 12px;margin:0 0 12px;font-size:12px;color:var(--apple-foreground);border-radius:4px;line-height:1.5';
  warn.innerHTML = '<b>注意:</b> 不要从 Console 执行 <code>document.cookie</code> 复制! B 站的 <code>SESSDATA</code> 是 <b>HttpOnly</b>,JS 读不到,只能从 Network 面板的请求头复制完整 cookie。';
  var reopenBtn = document.createElement('button');
  reopenBtn.textContent = '重开登录窗';
  reopenBtn.style.cssText = 'height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--apple-border);background:transparent;color:var(--apple-foreground);cursor:pointer;font-size:12px;margin-bottom:12px';
  reopenBtn.onclick = function () {
    try { popup.close(); } catch (e) {}
    popup = window.open('https://passport.bilibili.com/login', 'bili-login-popup', 'width=1024,height=700');
    showToast('已重新打开 B 站登录页', 'info');
  };
  // cookie 粘贴输入框
  var pasteLabel = document.createElement('label');
  pasteLabel.textContent = '在此粘贴从 Network 面板复制的 cookie 字符串:';
  pasteLabel.style.cssText = 'display:block;font-size:13px;font-weight:500;margin-bottom:4px;color:var(--apple-foreground)';
  var pasteBox = document.createElement('textarea');
  pasteBox.placeholder = '粘贴此处(形如 SESSDATA=xxx,%2C...; bili_jct=xxx; buvid3=xxx; ...)';
  pasteBox.style.cssText = 'width:100%;height:100px;font-family:var(--font-mono);font-size:11px;padding:8px;border-radius:8px;border:1px solid var(--apple-border);background:var(--background-50);color:var(--apple-foreground);resize:vertical;margin-bottom:8px';
  pasteBox.onclick = function () { pasteBox.select(); };
  var statusP = document.createElement('p');
  statusP.style.cssText = 'font-size:13px;margin:8px 0 4px;min-height:18px;color:var(--apple-muted-foreground)';
  var saveBtn = document.createElement('button');
  saveBtn.textContent = '保存 Cookie';
  saveBtn.style.cssText = 'height:36px;padding:0 16px;border-radius:8px;border:none;background:var(--brand-500);color:var(--background-50);cursor:pointer;font-size:13px;margin-right:8px';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '取消';
  closeBtn.style.cssText = 'height:36px;padding:0 16px;border-radius:8px;border:1px solid var(--apple-border);background:transparent;color:var(--apple-foreground);cursor:pointer;font-size:13px';
  var actionRow = document.createElement('div');
  actionRow.style.cssText = 'display:flex;gap:8px;margin-top:8px';
  actionRow.appendChild(saveBtn);
  actionRow.appendChild(closeBtn);
  var tip = document.createElement('p');
  tip.style.cssText = 'font-size:11px;margin:12px 0 0;color:var(--apple-muted-foreground);line-height:1.5';
  tip.innerHTML = '提示: B 站封禁了 Worker 服务器 IP,只能由你的浏览器登录后复制 cookie 回传。cookie 仅含 SESSDATA/bili_jct/buvid3,加密存储于 KV。<br>移动端浏览器若无法打开 F12,可用 via 浏览器或 PC 模式访问。';
  dialog.appendChild(title);
  dialog.appendChild(steps);
  dialog.appendChild(warn);
  dialog.appendChild(reopenBtn);
  dialog.appendChild(pasteLabel);
  dialog.appendChild(pasteBox);
  dialog.appendChild(statusP);
  dialog.appendChild(actionRow);
  dialog.appendChild(tip);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  function cleanup() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  function saveCookie() {
    var cookieStr = pasteBox.value.trim();
    if (!cookieStr) {
      statusP.textContent = '请先粘贴 cookie 字符串';
      statusP.style.color = 'var(--state-error)';
      return;
    }
    if (cookieStr.indexOf('SESSDATA=') < 0) {
      statusP.textContent = 'cookie 中缺少 SESSDATA。请确认从 Network 面板的请求头复制(非 Console 的 document.cookie)';
      statusP.style.color = 'var(--state-error)';
      return;
    }
    if (cookieStr.indexOf('bili_jct=') < 0) {
      statusP.textContent = 'cookie 中缺少 bili_jct,请确认已登录 B 站';
      statusP.style.color = 'var(--state-error)';
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';
    statusP.textContent = '正在保存...';
    statusP.style.color = 'var(--brand-500)';
    apiPost('/api/bili/login/cookie', { cookie: cookieStr })
      .then(function (r) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存 Cookie';
        if (r.success) {
          cleanup();
          try { popup.close(); } catch (err) {}
          showToast(r.message || ('B 站登录成功:' + (r.uname || '')), 'success');
          refreshConfigDisplay();
          // 调 /api/test/bili 进一步验证
          apiFetch('/api/test/bili', { method: 'POST' })
            .then(function (t) { if (t && t.success) showToast('B 站凭证验证: ' + (t.message || '有效'), 'success'); else if (t) showToast('凭证验证: ' + (t.message || '未通过'), 'warning'); })
            .catch(function () {});
        } else {
          statusP.textContent = r.error || '保存失败';
          statusP.style.color = 'var(--state-error)';
        }
      })
      .catch(function (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存 Cookie';
        statusP.textContent = '保存失败:' + (e.message || e);
        statusP.style.color = 'var(--state-error)';
      });
  }
  saveBtn.onclick = saveCookie;
  closeBtn.onclick = cleanup;
  overlay.onclick = function (e) { if (e.target === overlay) cleanup(); };
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', esc); } }, { once: true });
  setTimeout(function () { pasteBox.focus(); }, 100);
}

/**
 * YouTube OAuth 登录. Opens /api/youtube/oauth/start in a popup and listens
 * for a same-origin postMessage of type 'yt-oauth-result'.
 * Faithful to console.html lines 2642-2670.
 */
export function openYtOAuthLogin() {
  var popup = window.open('/api/youtube/oauth/start', 'yt-oauth', 'width=600,height=700');
  if (!popup) {
    showToast('弹窗被浏览器拦截,请允许弹窗后重试', 'error');
    return;
  }
  function handler(e) {
    // SEC-03: 仅接受同源消息,防止任意页面伪造 OAuth 结果触发 UI 混淆/配置重载
    if (e.origin !== window.location.origin) return;
    if (!e.data || e.data.type !== 'yt-oauth-result') return;
    window.removeEventListener('message', handler);
    if (e.data.success) {
      if (e.data.partial) {
        // Cookie 铸造失败,OAuth 本身成功
        showToast('YouTube OAuth 成功但 Cookie 铸造失败,如需下载会员视频请手动补 yt_cookies', 'error');
      } else {
        showToast('YouTube 登录成功: ' + (e.data.email || ''), 'success');
      }
      // 刷新表单(yt_cookies 脱敏值 + yt_user_email)
      refreshConfigDisplay();
    } else {
      showToast(e.data.error || 'YouTube 登录失败', 'error');
    }
    try { popup.close(); } catch (err) {}
  }
  window.addEventListener('message', handler);
}

/**
 * 修改管理密码 modal. Old/new/confirm password fields, POST
 * /api/auth/change-password.
 * Faithful to console.html lines 2671-2748.
 */
export function openChangePasswordModal() {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;animation:modal-fade .18s ease';
  var dialog = document.createElement('div');
  dialog.style.cssText = 'background:var(--apple-card);color:var(--apple-card-foreground);border-radius:16px;padding:24px;max-width:360px;width:100%;box-shadow:var(--shadow-2xl)';
  var title = document.createElement('h3');
  title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 16px';
  title.textContent = '修改管理密码';
  function makeField(labelText, placeholder) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px';
    var lbl = document.createElement('label');
    lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--apple-muted-foreground)';
    lbl.textContent = labelText;
    var inp = document.createElement('input');
    inp.type = 'password';
    inp.placeholder = placeholder || '';
    inp.style.cssText = 'width:100%;height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--apple-input);background:var(--apple-background);color:var(--apple-foreground);font-size:14px;box-sizing:border-box';
    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    return { wrap: wrap, input: inp };
  }
  var oldPwd = makeField('旧密码', '输入当前密码');
  var newPwd = makeField('新密码', '至少 8 位新密码');
  var confirmPwd = makeField('确认新密码', '再次输入新密码');
  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px';
  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'height:36px;padding:0 16px;border-radius:8px;border:1px solid var(--apple-border);background:transparent;color:var(--apple-foreground);cursor:pointer;font-size:13px';
  var submitBtn = document.createElement('button');
  submitBtn.textContent = '提交';
  submitBtn.style.cssText = 'height:36px;padding:0 16px;border-radius:8px;border:none;background:var(--brand-500);color:var(--background-50);cursor:pointer;font-size:13px;font-weight:500';
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  dialog.appendChild(title);
  dialog.appendChild(oldPwd.wrap);
  dialog.appendChild(newPwd.wrap);
  dialog.appendChild(confirmPwd.wrap);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
  cancelBtn.onclick = close;
  overlay.onclick = function (e) { if (e.target === overlay) close(); };
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } }, { once: true });
  submitBtn.onclick = function () {
    var op = oldPwd.input.value;
    var np = newPwd.input.value;
    var cp = confirmPwd.input.value;
    if (!op) { showToast('请输入旧密码', 'error'); return; }
    if (!np || np.length < 8) { showToast('新密码至少 8 位', 'error'); return; }
    if (np !== cp) { showToast('两次输入的新密码不一致', 'error'); return; }
    setBtnLoading(submitBtn, true, '提交中…');
    apiPost('/api/auth/change-password', { old_password: op, new_password: np })
      .then(function (d) {
        setBtnLoading(submitBtn, false);
        if (d.error) {
          showToast(d.error, 'error');
        } else {
          showToast('密码已修改', 'success');
          close();
        }
      })
      .catch(function (e) {
        setBtnLoading(submitBtn, false);
        showToast('修改失败:' + (e.message || e), 'error');
      });
  };
}

/**
 * Initialize auth: run the auth check (async, non-blocking) and bind all
 * auth/login buttons. Safe to call before other sections init.
 *
 * Auth flow (console.html lines 1113-1133):
 *   1. GET /api/init-status — if not initialized → login.html
 *   2. probe GET /api/config — 401 (handled by apiSafeJson) → login.html
 *   3. backend unavailable → swallow (dev mode shows static page)
 */
/**
 * 格式化"距过期还剩多久":返回相对描述(如"约 28 天" / "约 6 小时" / "已过期")
 * @param {number} expiresAt  过期时间戳(ms)
 * @returns {string}
 */
function formatExpiresIn(expiresAt) {
  if (!expiresAt || expiresAt <= 0) return '';
  var remainMs = expiresAt - Date.now();
  if (remainMs <= 0) return '已过期';
  var days = Math.floor(remainMs / 86400000);
  var hours = Math.floor((remainMs % 86400000) / 3600000);
  if (days > 0) return '剩余约 ' + days + ' 天' + (hours > 0 ? ' ' + hours + ' 小时' : '');
  if (hours > 0) return '剩余约 ' + hours + ' 小时';
  var mins = Math.floor(remainMs / 60000);
  if (mins > 0) return '剩余约 ' + mins + ' 分钟';
  return '即将过期';
}

/**
 * 检测 B 站登录态:调用 POST /api/bili/login/check,根据返回更新 status 文案和颜色
 * 流程:
 *   1. 按钮进入 loading(文案「检测中…」)
 *   2. 调后端 /check,后端用 KV 中已存的 SESSDATA 调 B 站 nav 接口
 *   3. 根据返回结果展示:
 *      - ok && valid  → 绿色「✓ 有效(账号: xxx, 剩余约 N 天)」
 *      - ok && !valid → 红色「✕ 已失效(请重新扫码登录)」
 *      - !ok          → 黄色「⚠ 检测失败:{message}」
 */
export function detectBiliLogin() {
  var btn = document.querySelector('[data-dom-id="bili-check-btn"]');
  var statusEl = document.querySelector('[data-dom-id="bili-login-status"]');
  if (!btn || !statusEl) return;
  if (btn.disabled) return;  // 防止重复点击

  setBtnLoading(btn, true, '检测中…');
  statusEl.textContent = '正在检测…';
  statusEl.style.color = 'var(--apple-muted-foreground)';

  apiPost('/api/bili/login/check', {})
    .then(function (d) {
      if (d.ok && d.valid) {
        var text = '✓ 有效(账号: ' + (d.uname || '(未知)') + ')';
        var expireDesc = formatExpiresIn(d.expires_at);
        if (expireDesc && expireDesc !== '已过期') text += ', ' + expireDesc;
        else if (expireDesc === '已过期') text += '(cookie 显示已过期但仍可用)';
        statusEl.textContent = text;
        statusEl.style.color = 'var(--state-success)';
        showToast('B 站登录态有效', 'success');
      } else if (d.ok && !d.valid) {
        statusEl.textContent = '✕ 已失效(' + (d.message || '请重新扫码登录') + ')';
        statusEl.style.color = 'var(--state-error)';
        showToast(d.message || 'B 站登录已失效,请重新登录', 'error');
      } else {
        statusEl.textContent = '⚠ 检测失败:' + (d.message || '未知错误');
        statusEl.style.color = 'var(--apple-muted-foreground)';
        showToast('检测失败:' + (d.message || '未知错误'), 'error');
      }
    })
    .catch(function (e) {
      statusEl.textContent = '⚠ 检测请求失败:' + (e && e.message ? e.message : e);
      statusEl.style.color = 'var(--apple-muted-foreground)';
      showToast('检测请求失败', 'error');
    })
    .finally(function () {
      setBtnLoading(btn, false);
    });
}

/**
 * 检测 YouTube OAuth 登录态:调用 POST /api/youtube/oauth/check
 * 后端会调 refreshYouTubeAccessToken,如果 refresh_token 失效会返回 valid=false
 * 流程同 detectBiliLogin
 */
export function detectYouTubeOAuth() {
  var btn = document.querySelector('[data-dom-id="yt-check-btn"]');
  var statusEl = document.querySelector('[data-dom-id="yt-login-status"]');
  if (!btn || !statusEl) return;
  if (btn.disabled) return;

  setBtnLoading(btn, true, '检测中…');
  statusEl.textContent = '正在检测…';
  statusEl.style.color = 'var(--apple-muted-foreground)';

  apiPost('/api/youtube/oauth/check', {})
    .then(function (d) {
      if (d.ok && d.valid) {
        var text = '✓ 有效(账号: ' + (d.email || '(未知)') + ')';
        var expireDesc = formatExpiresIn(d.expires_at);
        if (expireDesc && expireDesc !== '已过期') text += ', ' + expireDesc;
        statusEl.textContent = text;
        statusEl.style.color = 'var(--state-success)';
        showToast('YouTube OAuth 登录态有效' + (d.refreshed ? '(已自动刷新)' : ''), 'success');
      } else if (d.ok && !d.valid) {
        statusEl.textContent = '✕ 已失效(' + (d.message || '请重新 OAuth 登录') + ')';
        statusEl.style.color = 'var(--state-error)';
        showToast(d.message || 'YouTube OAuth 登录已失效,请重新登录', 'error');
      } else {
        statusEl.textContent = '⚠ 检测失败:' + (d.message || '未知错误');
        statusEl.style.color = 'var(--apple-muted-foreground)';
        showToast('检测失败:' + (d.message || '未知错误'), 'error');
      }
    })
    .catch(function (e) {
      statusEl.textContent = '⚠ 检测请求失败:' + (e && e.message ? e.message : e);
      statusEl.style.color = 'var(--apple-muted-foreground)';
      showToast('检测请求失败', 'error');
    })
    .finally(function () {
      setBtnLoading(btn, false);
    });
}

export function initAuth() {
  // ===== 鉴权检查 =====
  // 1. 系统未初始化 -> 跳 login
  // 2. 系统已初始化 -> 探测登录态(任意受保护接口 401 即跳登录)
  apiFetch('/api/init-status')
    .then(function (d) {
      if (!d.initialized) {
        location.href = 'login.html';
        return;
      }
      // 探测登录态:GET /api/config 受保护,401 跳登录
      apiFetch('/api/config')
        .then(function () { /* 已登录,继续 */ })
        .catch(function () {
          location.href = 'login.html';
        });
    })
    .catch(function () {
      // 后端不可用时仍然显示静态页面（开发模式）
    });

  // ===== 退出登录 =====
  var logoutBtn = document.querySelector('[data-dom-id="logout-btn"]');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      showModal({
        title: '退出登录',
        body: '确认退出当前账号？',
        onOk: function () {
          // logout 响应体不是 JSON,用原生 fetch(不经过 apiSafeJson)
          fetch('/api/logout', { method: 'POST', credentials: 'include' })
            .then(function () {
              localStorage.removeItem('y2b-initialized');
              location.href = 'login.html';
            })
            .catch(function () {
              location.href = 'login.html';
            });
        }
      });
    });
  }

  // ===== 绑定 OAuth/QR/修改密码 按钮事件 =====
  // 实际 data-dom-id 与绑定关系(console.html lines 2750-2771):
  //   bili-qrcode-login  → openBiliPopupLogin (按钮文案「弹窗登录 B 站」)
  //   yt-oauth-login     → openYtOAuthLogin
  //   change-password-btn → openChangePasswordModal
  var biliQrBtn = document.querySelector('[data-dom-id="bili-qrcode-login"]');
  if (biliQrBtn) biliQrBtn.addEventListener('click', openBiliPopupLogin);
  var ytOAuthBtn = document.querySelector('[data-dom-id="yt-oauth-login"]');
  if (ytOAuthBtn) ytOAuthBtn.addEventListener('click', openYtOAuthLogin);
  // 检测按钮:bili-check-btn / yt-check-btn
  var biliCheckBtn = document.querySelector('[data-dom-id="bili-check-btn"]');
  if (biliCheckBtn) biliCheckBtn.addEventListener('click', detectBiliLogin);
  var ytCheckBtn = document.querySelector('[data-dom-id="yt-check-btn"]');
  if (ytCheckBtn) ytCheckBtn.addEventListener('click', detectYouTubeOAuth);
  var changePwdBtn = document.querySelector('[data-dom-id="change-password-btn"]');
  if (changePwdBtn) changePwdBtn.addEventListener('click', openChangePasswordModal);

  // OAuth 配置展开/收起
  var ytOAuthToggle = document.querySelector('[data-dom-id="yt-oauth-config-toggle"]');
  var ytOAuthWrap = document.querySelector('[data-dom-id="yt-oauth-config-wrap"]');
  if (ytOAuthToggle && ytOAuthWrap) {
    ytOAuthToggle.addEventListener('click', function () {
      var isOpen = ytOAuthWrap.style.display !== 'none';
      if (isOpen) {
        ytOAuthWrap.style.display = 'none';
        ytOAuthToggle.textContent = 'OAuth 配置 ▾';
      } else {
        ytOAuthWrap.style.display = '';
        ytOAuthToggle.textContent = 'OAuth 配置 ▴';
      }
    });
  }
}
