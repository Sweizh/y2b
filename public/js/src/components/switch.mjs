// switch.mjs — Accessible toggle switch component
//
// Public API:
//   createSwitch(opts) → { el, setChecked(bool), getChecked(), toggle() }
//
// opts:
//   { checked, onChange, ariaLabel }
//
// - Creates a <button> with role="switch", aria-checked reflecting state, tabindex="0".
// - Space/Enter and click toggle the state.
// - Visual: 44×24px track, 20px knob. Checked → --brand-500; unchecked → --background-400.
//   Knob → --background-50.
// - CSS vars: --brand-500, --background-400, --background-50, --shadow-sm.

/**
 * Create an accessible switch toggle.
 * @param {Object} [opts]
 * @param {boolean} [opts.checked]
 * @param {Function} [opts.onChange]  called with new checked value on change
 * @param {string} [opts.ariaLabel]
 * @returns {{ el: HTMLButtonElement, setChecked: Function, getChecked: Function, toggle: Function }}
 */
export function createSwitch(opts) {
  opts = opts || {};
  let checked = !!opts.checked;
  const onChange = opts.onChange;
  const ariaLabel = opts.ariaLabel || '';

  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('role', 'switch');
  el.setAttribute('aria-label', ariaLabel);
  el.tabIndex = 0;

  const knob = document.createElement('span');

  function render() {
    el.setAttribute('aria-checked', checked ? 'true' : 'false');
    el.style.cssText =
      'width:44px;height:24px;border-radius:9999px;border:none;cursor:pointer;position:relative;' +
      'transition:background .18s;flex:0 0 auto;padding:0;background:' +
      (checked ? 'var(--brand-500)' : 'var(--background-400)');
    knob.style.cssText =
      'position:absolute;top:2px;width:20px;height:20px;border-radius:9999px;' +
      'background:var(--background-50);transition:left .18s,right .18s;box-shadow:var(--shadow-sm);' +
      'left:' + (checked ? '22px' : '2px');
  }

  el.appendChild(knob);
  render();

  function setChecked(v, silent) {
    const next = !!v;
    if (next === checked) return;
    checked = next;
    render();
    if (!silent && typeof onChange === 'function') onChange(checked);
  }

  function getChecked() {
    return checked;
  }

  function toggle() {
    setChecked(!checked);
  }

  el.addEventListener('click', function (e) {
    e.preventDefault();
    toggle();
  });

  el.addEventListener('keydown', function (e) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  });

  return {
    el: el,
    setChecked: setChecked,
    getChecked: getChecked,
    toggle: toggle,
  };
}
