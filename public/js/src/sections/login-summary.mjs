// login-summary.mjs — 登录与 API 配置汇总入口
//
// Public API:
//   initLoginSummary() → wire up #section-login-summary: bind the "配置" jump
//                        buttons (YouTube / B 站 / AI) and pull /api/config to
//                        refresh the three status labels (configured=green,
//                        unconfigured=muted).
//
// 视图切换:switchView 是 console.mjs 的局部函数(未挂 window),所以这里通过
// 点击顶部导航对应的按钮(.top-nav-item[data-view-target])来触发视图切换。
// 对于 "ai" 跳转,先切到 general 视图,再滚动到 #section-ai-services。

import { apiFetch } from '../api.mjs';

function setStatus(elId, configured, label) {
  var el = document.getElementById(elId);
  if (!el) return;
  el.textContent = label;
  el.style.color = configured ? 'var(--success, #16a34a)' : 'var(--muted-foreground)';
}

function jumpToView(viewName) {
  // 通过点击顶部导航按钮触发 switchView(switchView 是 console.mjs 局部函数)
  var btn = document.querySelector('.top-nav-item[data-view-target="' + viewName + '"]');
  if (btn) btn.click();
}

export function initLoginSummary() {
  var section = document.getElementById('section-login-summary');
  if (!section) return;

  // 跳转按钮
  section.querySelectorAll('[data-summary-jump]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-summary-jump');
      if (target === 'ai') {
        // 跳到 general 视图后滚动到 AI 服务 section
        jumpToView('general');
        setTimeout(function () {
          var ai = document.getElementById('section-ai-services');
          if (ai) ai.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        jumpToView(target);
      }
    });
  });

  // 拉取配置刷新状态
  apiFetch('/api/config').then(function (cfg) {
    // YouTube:有 access_token 或 refresh_token 或 api_key 算已授权
    var ytOk = !!(cfg.yt_access_token || cfg.yt_refresh_token || cfg.yt_api_key);
    setStatus('summary-yt-status', ytOk, ytOk ? (cfg.yt_user_name || cfg.yt_user_email || '已授权') : '未授权');

    // B 站:有 sessdata 算已登录
    var biliOk = !!(cfg.bili_sessdata);
    setStatus('summary-bili-status', biliOk, biliOk ? (cfg.bili_uname || '已登录') : '未登录');

    // AI 服务:asr_api 和 translate_api 都配置了算完整
    var asrOk = !!(cfg.asr_api && cfg.asr_key);
    var transOk = !!(cfg.translate_api && cfg.translate_key);
    var aiLabel = asrOk && transOk ? '已配置' : (asrOk || transOk ? '部分配置' : '未配置');
    setStatus('summary-ai-status', asrOk && transOk, aiLabel);
  }).catch(function () {
    setStatus('summary-yt-status', false, '加载失败');
    setStatus('summary-bili-status', false, '加载失败');
    setStatus('summary-ai-status', false, '加载失败');
  });
}
