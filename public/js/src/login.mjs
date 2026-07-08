// login.mjs — Entry point bundled by esbuild → public/js/dist/login.js
//
// Migrated from login.html inline <script> (lines 417-664). Wires up:
//   1. theme (earliest, avoids FOUC)
//   2. toast container
//   3. mode detection (init vs login) via /api/init-status
//   4. applyMode() — toggle UI between init/login
//   5. password show/hide toggle
//   6. submit() — POST to /api/config/init or /api/login
//   7. Enter key submit
//   8. forgot password modal (custom overlay)

import { initTheme } from './theme.mjs';
import { showToast, ensureToastContainer } from './components/toast.mjs';
import { setBtnLoading } from './components/button.mjs';

// 1. 主题(最早,避免 FOUC)
initTheme();

// 2. Toast 容器
ensureToastContainer();

// 3. DOM 引用
let mode = 'init';
const submitBtn = document.querySelector('[data-dom-id="login-submit"]');
const passwordInput = document.querySelectorAll('input[type="password"]')[0];
const confirmInput = document.querySelectorAll('input[type="password"]')[1];
const confirmGroup = confirmInput ? confirmInput.closest('div') : null;
const titleEl = document.querySelector('h2');
const descEl = document.querySelector('h2 + p');
const forgotWrap = document.querySelector('[data-dom-id="forgot-wrap"]');
const footerNote = document.querySelector('p.text-center.text-xs.mt-6');

// applyMode():在 init / login 之间切换 UI
function applyMode() {
  if (mode === 'login') {
    submitBtn.textContent = '登录';
    if (titleEl) titleEl.textContent = '登录';
    if (descEl) descEl.textContent = '请输入管理密码以进入控制台';
    if (confirmGroup) confirmGroup.style.display = 'none';
    if (forgotWrap) forgotWrap.style.display = '';
    if (footerNote) footerNote.textContent = '登录后可在控制台右上角切换主题';
    if (passwordInput) passwordInput.setAttribute('placeholder', '输入管理密码');
  } else {
    submitBtn.textContent = '初始化';
    if (titleEl) titleEl.textContent = '设置管理密码';
    if (descEl) descEl.textContent = '首次使用，请设置一个安全的管理密码';
    if (confirmGroup) confirmGroup.style.display = '';
    if (forgotWrap) forgotWrap.style.display = 'none';
    if (footerNote) footerNote.textContent = '初始化完成后，密码将用于保护管理后台访问';
    if (passwordInput) passwordInput.setAttribute('placeholder', '输入管理密码');
  }
}

function showForm() {
  const loading = document.getElementById('login-loading');
  const card = document.getElementById('login-card');
  if (loading) loading.style.display = 'none';
  if (card) card.style.display = '';
}

// 4. 模式判断:先尝试后端 init-status,失败则按 URL 参数兜底。
//    注意:此处用原生 fetch 而非 apiGet —— init-status 是公共端点,
//    出错时应回退到 URL 参数,而不是被 apiSafeJson 重定向到登录页。
fetch('/api/init-status', { credentials: 'include' })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    mode = data.initialized ? 'login' : 'init';
    applyMode();
    showForm();
  })
  .catch(function () {
    // 后端不可用时按 URL 参数兜底
    const urlMode = new URLSearchParams(location.search).get('mode');
    if (urlMode === 'login') mode = 'login';
    applyMode();
    showForm();
  });

// 5. 密码显示切换
document.querySelectorAll('.clear[aria-label="显示密码"]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const input = btn.parentElement.querySelector('input');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = '<i data-lucide="eye-off" style="width:16px;height:16px;"></i>';
      btn.setAttribute('aria-label', '隐藏密码');
    } else {
      input.type = 'password';
      btn.innerHTML = '<i data-lucide="eye" style="width:16px;height:16px;"></i>';
      btn.setAttribute('aria-label', '显示密码');
    }
    if (window.lucide) { try { window.lucide.createIcons(); } catch (e) {} }
  });
});

// 6. 提交逻辑
function submit() {
  const p = passwordInput.value;
  if (!p) { showToast('请输入密码', 'error'); passwordInput.focus(); return; }
  if (mode === 'init') {
    if (p.length < 8) { showToast('密码至少 8 位', 'error'); passwordInput.focus(); return; }
    if (confirmInput && p !== confirmInput.value) { showToast('两次输入的密码不一致', 'error'); confirmInput.focus(); return; }
  }
  setBtnLoading(submitBtn, true, mode === 'init' ? '初始化中…' : '登录中…');
  const url = mode === 'init' ? '/api/config/init' : '/api/login';
  // 登录端点不会返回 401(出错时返回 200 + body.error),用原生 fetch 即可,
  // 也避免 apiSafeJson 的 401→login.html 重定向副作用。
  fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: p }),
  })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      setBtnLoading(submitBtn, false);
      if (!res.ok) {
        showToast(res.data.error || '操作失败', 'error');
        return;
      }
      if (mode === 'init') {
        showToast('初始化成功，正在进入控制台…', 'success');
        // 初始化时返回 pipeline_token，提示用户保存
        if (res.data.pipeline_token) {
          setTimeout(function () {
            alert('初始化成功！\n\n请保存以下 pipeline_token 到 GitHub Secrets (PIPELINE_TOKEN):\n' + res.data.pipeline_token + '\n\n（也可稍后在控制台查看）');
            location.href = 'console.html';
          }, 300);
        } else {
          setTimeout(function () { location.href = 'console.html'; }, 800);
        }
      } else {
        showToast('登录成功，正在进入控制台…', 'success');
        setTimeout(function () { location.href = 'console.html'; }, 800);
      }
    })
    .catch(function (e) {
      setBtnLoading(submitBtn, false);
      showToast('网络错误：' + (e.message || e), 'error');
    });
}

submitBtn.addEventListener('click', function (e) { e.preventDefault(); submit(); });

// 7. Enter 提交
[passwordInput, confirmInput].forEach(function (inp) {
  if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
});

// 8. 忘记密码:内联提示密码重置方式(自定义 overlay,非简单确认框)
const forgotBtn = document.querySelector('[data-dom-id="forgot-password-btn"]');
if (forgotBtn) {
  forgotBtn.addEventListener('click', function () {
    // 创建内联 modal 提示密码重置方式
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--apple-background,#fff);border-radius:16px;padding:24px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.2);';
    const title = document.createElement('h3');
    title.textContent = '重置管理密码';
    title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 12px 0;color:var(--apple-foreground,#000);';
    const msg = document.createElement('p');
    msg.textContent = '密码不可在线重置。请管理员执行以下步骤:';
    msg.style.cssText = 'font-size:13px;color:var(--apple-muted-foreground,#666);margin:0 0 12px 0;line-height:1.5;';
    const steps = document.createElement('ol');
    steps.style.cssText = 'font-size:13px;color:var(--apple-foreground,#000);margin:0 0 16px 0;padding-left:20px;line-height:1.7;';
    steps.innerHTML = '<li>登录 Cloudflare Dashboard</li><li>进入 Workers & Pages → 选择本 Worker</li><li>切换到 KV 标签页</li><li>选择 YT2BILI_KV 命名空间</li><li>删除 <code style="background:var(--apple-secondary,#eee);padding:2px 6px;border-radius:4px;font-family:monospace;">config</code> 键</li><li>访问 /login.html 重新初始化</li>';
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制文本';
    copyBtn.type = 'button';
    copyBtn.style.cssText = 'font-size:13px;padding:8px 16px;border-radius:8px;border:1px solid var(--apple-border,#ddd);background:var(--apple-secondary,#f5f5f5);color:var(--apple-foreground,#000);cursor:pointer;';
    copyBtn.onclick = function () {
      const txt = '密码不可在线重置。请管理员执行以下步骤:\n1. 登录 Cloudflare Dashboard\n2. 进入 Workers & Pages → 选择本 Worker\n3. 切换到 KV 标签页\n4. 选择 YT2BILI_KV 命名空间\n5. 删除 config 键\n6. 访问 /login.html 重新初始化';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          copyBtn.textContent = '已复制';
          setTimeout(function () { copyBtn.textContent = '复制文本'; }, 2000);
        }).catch(function () {
          copyBtn.textContent = '复制失败';
          setTimeout(function () { copyBtn.textContent = '复制文本'; }, 2000);
        });
      } else {
        // Fallback: textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); copyBtn.textContent = '已复制'; setTimeout(function () { copyBtn.textContent = '复制文本'; }, 2000); } catch (e) {}
        document.body.removeChild(ta);
      }
    };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.type = 'button';
    closeBtn.style.cssText = 'font-size:13px;padding:8px 16px;border-radius:8px;border:none;background:var(--brand-600,#3b82f6);color:#fff;cursor:pointer;';
    closeBtn.onclick = function () {
      document.body.removeChild(overlay);
    };
    btnRow.appendChild(copyBtn);
    btnRow.appendChild(closeBtn);
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(steps);
    card.appendChild(btnRow);
    overlay.appendChild(card);
    // 点击遮罩外区域关闭
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });
    document.body.appendChild(overlay);
  });
}

// 9. Lucide 图标渲染
window.lucide?.createIcons();
