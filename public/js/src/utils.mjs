// utils.mjs — Common DOM helpers (migrated from console.html)
//
// Public API:
//   escapeHtml(s)              → HTML-escape a string (original lines 2393-2396)
//   setupDirtyCheck(fields, saveBtn, opts)
//                              → generalized dirty-check from setupSave() (lines 1353-1379)
//   formatTime(ms)             → format epoch ms or duration ms to a readable string
//   qs(sel, parent)            → querySelector shorthand
//   qsa(sel, parent)           → querySelectorAll → Array shorthand

/**
 * Escape a string for safe insertion into HTML. Exact behavior from the
 * original (console.html lines 2393-2396).
 * @param {*} s
 * @returns {string}
 */
export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * Set up dirty-checking on a set of form fields controlling a save button.
 * Snapshots current values, attaches `input` listeners, and toggles the save
 * button's disabled state + opacity based on whether any field changed.
 *
 * Generalized from setupSave() (console.html lines 1353-1379).
 *
 * @param {Array<HTMLElement>} fields input/textarea elements to monitor
 * @param {HTMLButtonElement} saveBtn the save button
 * @param {{disabledOpacity?:number, enabledOpacity?:number}} [opts]
 * @returns {{refresh:Function, resnapshot:Function}}
 */
export function setupDirtyCheck(fields, saveBtn, opts) {
  opts = opts || {};
  const disabledOpacity = opts.disabledOpacity != null ? opts.disabledOpacity : 0.4;
  const enabledOpacity = opts.enabledOpacity != null ? opts.enabledOpacity : 1;
  const fieldList = Array.from(fields || []);
  let snapshot = {};

  function collectSnapshot() {
    snapshot = {};
    fieldList.forEach(function (f, i) {
      snapshot[i] = f.value;
    });
  }

  function isDirty() {
    for (let i = 0; i < fieldList.length; i++) {
      if (fieldList[i].value !== snapshot[i]) return true;
    }
    return false;
  }

  function refresh() {
    if (isDirty()) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = String(enabledOpacity);
      saveBtn.style.cursor = 'pointer';
    } else {
      saveBtn.disabled = true;
      saveBtn.style.opacity = String(disabledOpacity);
      saveBtn.style.cursor = 'not-allowed';
    }
  }

  collectSnapshot();
  fieldList.forEach(function (f) {
    f.addEventListener('input', refresh);
  });

  return {
    refresh: refresh,
    resnapshot: function () {
      collectSnapshot();
      refresh();
    },
  };
}

/**
 * Format a millisecond value. If it looks like an epoch timestamp
 * (number > 1e12), format as a locale string date. Otherwise format as a
 * human-readable duration. Returns '' for non-numeric input so status
 * displays never render "NaNmNaNs".
 * @param {number} ms
 * @returns {string}
 */
export function formatTime(ms) {
  if (typeof ms !== 'number' || isNaN(ms)) return '';
  if (ms > 1e12) {
    return new Date(ms).toLocaleString();
  }
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm' + Math.floor((ms % 60000) / 1000) + 's';
}

/**
 * querySelector shorthand.
 * @param {string} sel
 * @param {ParentNode} [parent]
 * @returns {Element|null}
 */
export function qs(sel, parent) {
  return (parent || document).querySelector(sel);
}

/**
 * querySelectorAll → Array shorthand.
 * @param {string} sel
 * @param {ParentNode} [parent]
 * @returns {Array<Element>}
 */
export function qsa(sel, parent) {
  return Array.from((parent || document).querySelectorAll(sel));
}
