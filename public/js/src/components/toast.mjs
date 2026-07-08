// toast.mjs — Toast notifications (migrated from console.html lines 937-959)
//
// Public API:
//   ensureToastContainer()  → lazily creates & returns #toast-container
//   showToast(msg, type)     → type: 'success' | 'error' | 'info' (default 'info')
//
// CSS vars: --state-success-surface/--state-success, --state-error-surface/--state-error,
//           --brand-50/--brand-600. Keyframe `toast-in` exists in built CSS.

/**
 * Lazily create the fixed #toast-container div if it does not exist yet.
 * @returns {HTMLDivElement}
 */
export function ensureToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:calc(100vw - 32px)';
    document.body.appendChild(c);
  }
  return c;
}

/**
 * Show a transient toast message.
 * @param {string} msg
 * @param {'success'|'error'|'info'} [type='info']
 */
export function showToast(msg, type) {
  type = type || 'info';
  const c = ensureToastContainer();
  const t = document.createElement('div');

  let bg = 'var(--brand-50)';
  let col = 'var(--brand-600)';
  if (type === 'success') {
    bg = 'var(--state-success-surface)';
    col = 'var(--state-success)';
  } else if (type === 'error') {
    bg = 'var(--state-error-surface)';
    col = 'var(--state-error)';
  }

  t.style.cssText =
    'pointer-events:auto;display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;' +
    'box-shadow:var(--shadow-lg);min-width:240px;max-width:360px;font-size:13px;font-weight:500;' +
    'background:' + bg + ';color:' + col + ';animation:toast-in .2s ease';
  t.textContent = msg;
  c.appendChild(t);

  setTimeout(function () {
    t.style.opacity = '0';
    t.style.transition = 'opacity .2s';
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 200);
  }, 3000);
}
