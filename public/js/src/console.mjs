// console.mjs — Entry point bundled by esbuild → public/js/dist/console.js
//
// Wires up the console page in dependency order:
//   1. theme (earliest, avoids FOUC)
//   2. toast container
//   3. auth check (async, non-blocking; also binds auth/login buttons)
//   4. sidebar section navigation (IntersectionObserver + smooth scroll)
//   5. mobile sidebar toggle
//   6. each section's init

import { initTheme, bindThemeToggle } from './theme.mjs';
import { initSectionNav } from './components/section-nav.mjs';
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

// 4. 侧边栏导航
const sidebar = document.querySelector('aside');
const navLinks = sidebar ? Array.from(sidebar.querySelectorAll('nav a')) : [];
const sections = navLinks.map(a => {
  const href = a.getAttribute('href') || '';
  const id = href.replace('#', '');
  return document.getElementById(id);
}).filter(Boolean);

if (sidebar && navLinks.length > 0 && sections.length > 0) {
  initSectionNav({ sidebar, sections, links: navLinks });
}

// 5. 移动端侧边栏
const menuBtn = document.getElementById('mobile-menu-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
if (menuBtn && sidebar) {
  menuBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    if (sidebarOverlay) sidebarOverlay.classList.toggle('open');
  });
}
if (sidebarOverlay && sidebar) {
  sidebarOverlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('open');
  });
}

// 6. 各 section 初始化
initCredentials();
initAiServices();
initChannels();
initStatus();
initManual();
