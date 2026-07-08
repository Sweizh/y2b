// modal.mjs — Unified modal dialog (migrated from console.html showModal lines 976-1007
//             and showHelp lines 1010-1046)
//
// Public API:
//   showModal(opts) → returns { close }
//
// opts:
//   { title, body, okText, cancelText, onOk, onHelpBody }
//
// - When `onHelpBody` (HTML string) is provided: renders a wider help dialog
//   (max-width:560px, max-height:80vh, overflow-y:auto) with a close (×) button in
//   the header and NO cancel/ok buttons row. This replaces the showHelp() use case.
// - Otherwise: renders a confirm dialog (max-width:400px) with title + body + cancel/ok.
//
// Accessibility:
//   - Focus trap: Tab/Shift+Tab cycles focus within the modal only.
//   - On open, the previously-focused element (document.activeElement) is remembered;
//     on close, focus is returned to it.
//   - Esc closes. Overlay click (e.target === overlay) closes.
//
// CSS vars: --apple-card, --apple-card-foreground, --apple-muted-foreground, --apple-border,
//           --apple-foreground, --apple-secondary, --brand-500, --background-50, --shadow-2xl,
//           --font-mono. Keyframes `modal-fade` exists in built CSS.

const FOCUSABLE_SELECTOR =
  'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])';

function styleHelpContent(root) {
  root.querySelectorAll('a').forEach(function (a) {
    a.style.color = 'var(--brand-500)';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.textDecoration = 'underline';
  });
  root.querySelectorAll('code').forEach(function (c) {
    c.style.cssText =
      'background:var(--apple-secondary);color:var(--apple-foreground);padding:1px 6px;border-radius:4px;' +
      'font-family:var(--font-mono);font-size:12px;word-break:break-all';
  });
}

function getFocusable(root) {
  return Array.prototype.slice
    .call(root.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(function (el) {
      if (el.disabled) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      // skip elements that are not visible
      return el.offsetParent !== null || el === document.activeElement;
    });
}

/**
 * Show a modal dialog (confirm or help variant).
 * @param {Object} [opts]
 * @returns {{ close: Function }}
 */
export function showModal(opts) {
  opts = opts || {};
  const isHelp = opts.onHelpBody != null;

  // Remember focus to restore on close.
  const previouslyFocused = document.activeElement;

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;display:flex;' +
    'align-items:center;justify-content:center;padding:16px;animation:modal-fade .18s ease';

  const dialog = document.createElement('div');
  dialog.setAttribute('tabindex', '-1');
  if (isHelp) {
    dialog.style.cssText =
      'background:var(--apple-card);color:var(--apple-card-foreground);border-radius:16px;padding:24px;' +
      'max-width:560px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:var(--shadow-2xl)';
  } else {
    dialog.style.cssText =
      'background:var(--apple-card);color:var(--apple-card-foreground);border-radius:16px;padding:24px;' +
      'max-width:400px;width:100%;box-shadow:var(--shadow-2xl)';
  }

  let closeIcon = null;
  let okBtn = null;
  let cancelBtn = null;

  if (isHelp) {
    const head = document.createElement('div');
    head.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;margin:0 0 16px';
    const h = document.createElement('h3');
    h.style.cssText = 'font-size:16px;font-weight:600;margin:0';
    h.textContent = opts.title || '';

    closeIcon = document.createElement('button');
    closeIcon.type = 'button';
    closeIcon.innerHTML = '&times;';
    closeIcon.setAttribute('aria-label', '关闭');
    closeIcon.style.cssText =
      'background:none;border:none;font-size:24px;cursor:pointer;color:var(--apple-muted-foreground);' +
      'padding:0;line-height:1;width:28px;height:28px;display:flex;align-items:center;justify-content:center;' +
      'border-radius:6px';
    closeIcon.onmouseenter = function () {
      closeIcon.style.background = 'var(--apple-secondary)';
    };
    closeIcon.onmouseleave = function () {
      closeIcon.style.background = 'none';
    };

    head.appendChild(h);
    head.appendChild(closeIcon);

    const body = document.createElement('div');
    body.style.cssText =
      'font-size:13px;line-height:1.7;color:var(--apple-muted-foreground)';
    body.innerHTML = opts.onHelpBody;
    styleHelpContent(body);

    dialog.appendChild(head);
    dialog.appendChild(body);
  } else {
    const title = document.createElement('h3');
    title.style.cssText = 'font-size:16px;font-weight:600;margin:0 0 12px';
    title.textContent = opts.title || '确认';

    const body = document.createElement('p');
    body.style.cssText =
      'font-size:14px;margin:0 0 20px;color:var(--apple-muted-foreground)';
    body.textContent = opts.body || '';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';

    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = opts.cancelText || '取消';
    cancelBtn.style.cssText =
      'height:36px;padding:0 16px;border-radius:8px;border:1px solid var(--apple-border);' +
      'background:transparent;color:var(--apple-foreground);cursor:pointer;font-size:13px';

    okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = opts.okText || '确认';
    okBtn.style.cssText =
      'height:36px;padding:0 16px;border-radius:8px;border:none;background:var(--brand-500);' +
      'color:var(--background-50);cursor:pointer;font-size:13px;font-weight:500';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);

    dialog.appendChild(title);
    dialog.appendChild(body);
    dialog.appendChild(btnRow);
  }

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', trap);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try {
        previouslyFocused.focus();
      } catch (e) {
        /* ignore */
      }
    }
  }

  function trap(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;

    const f = getFocusable(dialog);
    if (f.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = f[0];
    const last = f[f.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('keydown', trap);
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close();
  });

  if (closeIcon) closeIcon.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  if (okBtn) {
    okBtn.addEventListener('click', function () {
      close();
      if (typeof opts.onOk === 'function') opts.onOk();
    });
  }

  // Move initial focus into the dialog.
  const f = getFocusable(dialog);
  if (f.length > 0) {
    f[0].focus();
  } else {
    dialog.focus();
  }

  return { close: close };
}
