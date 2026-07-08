// console.mjs — Entry point bundled by esbuild → public/js/dist/console.js
//
// Wires up the console page in dependency order:
//   1. theme (earliest, avoids FOUC)
//   2. toast container
//   3. auth check (async, non-blocking; also binds auth/login buttons)
//   4. top-nav view switching (4 views: bili / youtube / general / status)
//   5. Ctrl+K command palette
//   6. mobile hamburger menu
//   7. status view tab switching
//   8. each section's init

import { initTheme, bindThemeToggle } from './theme.mjs';
import { initAuth } from './sections/auth.mjs';
import { initCredentials } from './sections/credentials.mjs';
import { initAiServices } from './sections/ai-services.mjs';
import { initChannels } from './sections/channels.mjs';
import { initStatus } from './sections/status.mjs';
import { initManual } from './sections/manual.mjs';
import { ensureToastContainer } from './components/toast.mjs';

// 1. 主题(最早,避免 FOUC)
initTheme();
bindThemeToggle();

// 2. Toast 容器
ensureToastContainer();

// 3. 鉴权检查(异步,不阻塞后续绑定)
initAuth();

// ═══════════════════════════════════════════════════════════════
// 4. 视图切换
// ═══════════════════════════════════════════════════════════════

const VIEW_NAMES = ['bili', 'youtube', 'general', 'status'];

function getViewButtons() {
  return Array.from(document.querySelectorAll('.top-nav-item[data-view-target]'));
}

function getViews() {
  return Array.from(document.querySelectorAll('.view'));
}

function closeMobileMenu() {
  const items = document.querySelector('.top-nav-items');
  const overlay = document.getElementById('sidebar-overlay');
  if (items) items.setAttribute('data-open', 'false');
  if (overlay) overlay.classList.add('hidden');
}

function switchView(name) {
  if (!VIEW_NAMES.includes(name)) name = 'bili';

  getViews().forEach(function (v) {
    v.setAttribute('data-active', v.getAttribute('data-view') === name ? 'true' : 'false');
  });
  getViewButtons().forEach(function (b) {
    b.setAttribute('data-active', b.getAttribute('data-view-target') === name ? 'true' : 'false');
  });

  // 更新 URL hash 便于深链
  try {
    history.replaceState(null, '', '#' + name);
  } catch (e) { /* 某些环境可能限制 replaceState,忽略 */ }

  // 移动端选择后收起菜单
  closeMobileMenu();

  // 滚动到顶部
  window.scrollTo(0, 0);
}

// 绑定顶部导航按钮
getViewButtons().forEach(function (btn) {
  btn.addEventListener('click', function () {
    switchView(btn.getAttribute('data-view-target'));
  });
});

// 页面加载:读 hash 切换视图,默认 bili
(function initViewFromHash() {
  const hash = (location.hash || '').replace(/^#/, '');
  switchView(VIEW_NAMES.includes(hash) ? hash : 'bili');
})();

// hash 变化时也跟随(支持浏览器前进/后退)
window.addEventListener('hashchange', function () {
  const hash = (location.hash || '').replace(/^#/, '');
  if (VIEW_NAMES.includes(hash)) switchView(hash);
});

// ═══════════════════════════════════════════════════════════════
// 5. Ctrl+K Command Palette
// ═══════════════════════════════════════════════════════════════

const COMMANDS = [
  { label: '跳转:B 站',     keywords: '跳转 bili b站 站', action: function () { switchView('bili'); } },
  { label: '跳转:YouTube',  keywords: '跳转 youtube yt', action: function () { switchView('youtube'); } },
  { label: '跳转:通用',     keywords: '跳转 general 通用', action: function () { switchView('general'); } },
  { label: '跳转:运行状态', keywords: '跳转 status 运行状态', action: function () { switchView('status'); } },
  {
    label: '立即执行',
    keywords: '执行 触发 trigger pipeline 流水线',
    action: function () {
      const btn = document.querySelector('[data-dom-id="trigger-btn"]');
      if (btn) btn.click();
    }
  },
  {
    label: '扫码登录 B 站',
    keywords: '扫码 登录 bili qrcode 二维码',
    action: function () {
      const btn = document.querySelector('[data-dom-id="bili-qrcode-login"]');
      if (btn) btn.click();
    }
  },
  {
    label: '切换主题',
    keywords: '主题 切换 theme dark light 暗 亮',
    action: function () {
      const btn = document.querySelector('[data-dom-id="theme-toggle-btn"]');
      if (btn) btn.click();
    }
  }
];

const cmdkEl = document.getElementById('command-palette');
const cmdkInput = document.getElementById('cmdk-input');
const cmdkList = document.getElementById('cmdk-list');
const cmdkTrigger = document.getElementById('cmdk-trigger');
let cmdkSelected = 0;
let cmdkFiltered = COMMANDS.slice();

function openCmdk() {
  if (!cmdkEl) return;
  cmdkEl.style.display = 'flex';
  cmdkSelected = 0;
  if (cmdkInput) {
    cmdkInput.value = '';
    // 延迟 focus 确保 display 生效
    setTimeout(function () { cmdkInput.focus(); }, 0);
  }
  renderCmdkList('');
}

function closeCmdk() {
  if (!cmdkEl) return;
  cmdkEl.style.display = 'none';
  if (cmdkInput) cmdkInput.value = '';
  if (cmdkList) cmdkList.innerHTML = '';
  cmdkSelected = 0;
  cmdkFiltered = COMMANDS.slice();
}

function renderCmdkList(query) {
  if (!cmdkList) return;
  const q = (query || '').trim().toLowerCase();
  cmdkFiltered = COMMANDS.filter(function (c) {
    if (!q) return true;
    return (c.label + ' ' + (c.keywords || '')).toLowerCase().indexOf(q) !== -1;
  });
  if (cmdkSelected >= cmdkFiltered.length) cmdkSelected = 0;
  if (cmdkFiltered.length === 0) {
    cmdkList.innerHTML = '<div class="command-palette-item" style="color:var(--muted-foreground);cursor:default">无匹配命令</div>';
    return;
  }
  cmdkList.innerHTML = '';
  cmdkFiltered.forEach(function (c, i) {
    const item = document.createElement('div');
    item.className = 'command-palette-item';
    item.setAttribute('data-selected', i === cmdkSelected ? 'true' : 'false');
    item.textContent = c.label;
    item.addEventListener('click', function () {
      c.action();
      closeCmdk();
    });
    item.addEventListener('mouseenter', function () {
      cmdkSelected = i;
      Array.prototype.forEach.call(cmdkList.children, function (node, idx) {
        node.setAttribute('data-selected', idx === cmdkSelected ? 'true' : 'false');
      });
    });
    cmdkList.appendChild(item);
  });
}

function cmdkMoveSelected(delta) {
  if (cmdkFiltered.length === 0) return;
  let n = cmdkSelected + delta;
  if (n < 0) n = cmdkFiltered.length - 1;
  if (n >= cmdkFiltered.length) n = 0;
  cmdkSelected = n;
  Array.prototype.forEach.call(cmdkList.children, function (node, i) {
    node.setAttribute('data-selected', i === cmdkSelected ? 'true' : 'false');
  });
  // 滚动到可视区
  const active = cmdkList.children[cmdkSelected];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

function cmdkExecuteSelected() {
  const c = cmdkFiltered[cmdkSelected];
  if (!c) return;
  c.action();
  closeCmdk();
}

if (cmdkTrigger) {
  cmdkTrigger.addEventListener('click', openCmdk);
}

if (cmdkInput) {
  cmdkInput.addEventListener('input', function (e) {
    cmdkSelected = 0;
    renderCmdkList(e.target.value);
  });
  cmdkInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cmdkMoveSelected(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cmdkMoveSelected(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      cmdkExecuteSelected();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCmdk();
    }
  });
}

// 全局快捷键:Ctrl+K / Cmd+K 打开;Esc 关闭
document.addEventListener('keydown', function (e) {
  const isCmdk = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
  if (isCmdk) {
    e.preventDefault();
    if (cmdkEl && cmdkEl.style.display !== 'none') {
      closeCmdk();
    } else {
      openCmdk();
    }
    return;
  }
  if (e.key === 'Escape' && cmdkEl && cmdkEl.style.display !== 'none') {
    closeCmdk();
  }
});

// 点击遮罩区域关闭
if (cmdkEl) {
  cmdkEl.addEventListener('click', function (e) {
    if (e.target === cmdkEl) closeCmdk();
  });
}

// ═══════════════════════════════════════════════════════════════
// 6. 移动端 hamburger 菜单
// ═══════════════════════════════════════════════════════════════

const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const topNavItems = document.querySelector('.top-nav-items');

function toggleMobileMenu() {
  if (!topNavItems) return;
  const open = topNavItems.getAttribute('data-open') === 'true';
  topNavItems.setAttribute('data-open', open ? 'false' : 'true');
  if (sidebarOverlay) sidebarOverlay.classList.toggle('hidden', open);
}

if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', toggleMobileMenu);
}
if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeMobileMenu);
}

// ═══════════════════════════════════════════════════════════════
// 7. 运行状态视图 tab 切换
//    HTML 用 data-tab-target (按钮) + data-tab-panel (内容容器)
//    status.mjs 未实现 tab 切换,在此补齐
// ═══════════════════════════════════════════════════════════════

Array.prototype.forEach.call(
  document.querySelectorAll('.tab-trigger[data-tab-target]'),
  function (trigger) {
    trigger.addEventListener('click', function () {
      const target = trigger.getAttribute('data-tab-target');
      const tabList = trigger.closest('.tab-list') || document;
      const panelRoot = trigger.closest('.view') || document;

      // 切换所有同组 trigger 的 data-state
      Array.prototype.forEach.call(
        tabList.querySelectorAll('.tab-trigger[data-tab-target]'),
        function (t) {
          t.setAttribute('data-state', t === trigger ? 'active' : 'inactive');
        }
      );

      // 切换对应 panel 的显示
      Array.prototype.forEach.call(
        panelRoot.querySelectorAll('[data-tab-panel]'),
        function (panel) {
          if (panel.getAttribute('data-tab-panel') === target) {
            panel.style.display = '';
          } else {
            panel.style.display = 'none';
          }
        }
      );
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// 8. 各 section 初始化
// ═══════════════════════════════════════════════════════════════
initCredentials();
initAiServices();
initChannels();
initStatus();
initManual();
