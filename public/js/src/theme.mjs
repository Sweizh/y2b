// theme.mjs — Theme init & toggle (migrated from console.html lines 906-935)
//
// Public API:
//   getCurrentTheme()           → 'dark' | 'light' (reads .dark class on <html>)
//   applyTheme(t)                → set .dark class + data-theme attr, persist to localStorage
//   setThemeToggleIcon()         → update #theme-toggle-icon emoji (🌙 dark / ☀️ light)
//   initTheme()                  → read localStorage['y2b-theme'] (or prefers-color-scheme)
//                                   and apply to <html> (mirrors original IIFE, lines 920-928)
//   bindThemeToggle(btnSelector) → bind click handler that toggles theme; returns button
//
// Contract: localStorage key 'y2b-theme', .dark class on <html>, and the data-theme
// attribute MUST be preserved exactly — other code reads these.

/**
 * Return the currently applied theme based on the .dark class on <html>.
 * @returns {'dark'|'light'}
 */
export function getCurrentTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * Update the #theme-toggle-icon text to the emoji for the current theme.
 * Keeps the emoji (🌙/☀️) for now — a later enhancement may swap in Lucide icons.
 */
export function setThemeToggleIcon() {
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) {
    icon.textContent = getCurrentTheme() === 'dark' ? '🌙' : '☀️';
  }
}

/**
 * Apply a theme: set .dark class + data-theme attr on <html>, persist to
 * localStorage['y2b-theme'] (wrapped in try/catch), and refresh the toggle icon.
 * @param {'dark'|'light'} t
 */
export function applyTheme(t) {
  const h = document.documentElement;
  if (t === 'light') {
    h.classList.remove('dark');
    h.setAttribute('data-theme', 'light');
  } else {
    h.classList.add('dark');
    h.setAttribute('data-theme', 'dark');
  }
  try {
    localStorage.setItem('y2b-theme', t);
  } catch (e) {}
  setThemeToggleIcon();
}

/**
 * Initialize theme from localStorage['y2b-theme'], falling back to the OS
 * prefers-color-scheme media query. Mirrors the original IIFE (console.html
 * lines 920-928). Does NOT call setThemeToggleIcon — the caller does that,
 * matching the original sequence (IIFE runs, then setThemeToggleIcon() is
 * called separately).
 */
export function initTheme() {
  try {
    let t = localStorage.getItem('y2b-theme');
    if (!t) {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    const h = document.documentElement;
    if (t === 'light') {
      h.classList.remove('dark');
      h.setAttribute('data-theme', 'light');
    } else {
      h.classList.add('dark');
      h.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
}

/**
 * Bind the theme toggle button's click handler to flip between light/dark.
 * @param {string} [btnSelector] default '[data-dom-id="theme-toggle-btn"]'
 * @returns {Element|null} the button element (or null if not found)
 */
export function bindThemeToggle(btnSelector) {
  const sel = btnSelector || '[data-dom-id="theme-toggle-btn"]';
  const btn = document.querySelector(sel);
  if (btn) {
    btn.addEventListener('click', function () {
      applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
    });
  }
  return btn;
}
