// button.mjs — Button helpers (migrated from console.html setBtnLoading lines 961-973)
//
// Public API:
//   setBtnLoading(btn, loading, text) — toggle loading state, restore text on done
//   createIconButton(opts)              — icon button with 44×44 touch target
//
// setBtnLoading:
//   loading=true  → store btn.dataset.originalText, disable, opacity .7, textContent = text || '处理中…'
//   loading=false → re-enable, clear opacity, restore from dataset.originalText
//
// createIconButton opts:
//   { icon, ariaLabel, onClick, variant }
//   - icon: Lucide icon name string (rendered as <i data-lucide="...">)
//   - variant: 'ghost' (transparent) | 'default'
//   - min touch target 44×44 (via padding, not changing visual size)
//   - lazily calls window.lucide?.createIcons() after appending

/**
 * Toggle a button's loading state, preserving its original text.
 * @param {HTMLButtonElement} btn
 * @param {boolean} loading
 * @param {string} [text]  override loading label (defaults to '处理中…')
 */
export function setBtnLoading(btn, loading, text) {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.textContent = text || '处理中…';
  } else {
    btn.disabled = false;
    btn.style.opacity = '';
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }
}

/**
 * Create an icon button with a 44×44 minimum touch target.
 * @param {Object} opts
 * @param {string} [opts.icon]         Lucide icon name
 * @param {string} [opts.ariaLabel]
 * @param {Function} [opts.onClick]
 * @param {'ghost'|'default'} [opts.variant='default']
 * @returns {HTMLButtonElement}
 */
export function createIconButton(opts) {
  opts = opts || {};
  const icon = opts.icon || '';
  const ariaLabel = opts.ariaLabel || '';
  const onClick = opts.onClick;
  const variant = opts.variant || 'default';

  const btn = document.createElement('button');
  btn.type = 'button';
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);

  // Lucide replaces <i data-lucide="..."> with an <svg> on createIcons().
  const iconEl = document.createElement('i');
  iconEl.setAttribute('data-lucide', icon);
  iconEl.style.display = 'inline-flex';
  btn.appendChild(iconEl);

  const base =
    'cursor:pointer;padding:10px;border-radius:8px;min-width:44px;min-height:44px;' +
    'display:inline-flex;align-items:center;justify-content:center;line-height:1;';
  if (variant === 'ghost') {
    btn.style.cssText =
      base +
      'background:transparent;border:none;color:var(--apple-muted-foreground);';
  } else {
    btn.style.cssText =
      base +
      'background:transparent;border:1px solid var(--apple-border);color:var(--apple-foreground);';
  }

  if (onClick) btn.addEventListener('click', onClick);

  // Lazily render lucide icons once the button has been appended to the DOM.
  // requestAnimationFrame gives the caller a turn to append before we scan.
  if (typeof window !== 'undefined') {
    const tryRender = function () {
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        try {
          window.lucide.createIcons();
        } catch (e) {
          /* ignore */
        }
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(tryRender);
    } else {
      setTimeout(tryRender, 0);
    }
  }

  return btn;
}
