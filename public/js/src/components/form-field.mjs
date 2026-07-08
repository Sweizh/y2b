// form-field.mjs — Labeled input field component
//
// Public API:
//   createFormField(opts) → { wrapper, input, label }
//
// opts:
//   { labelText, inputType, inputId, value, placeholder, readonly, helpKey, onHelp }
//
// - Creates a wrapper <div class="field"> containing a <label for=inputId> and the input.
// - Input gets id, type, value, placeholder, readonly.
// - If `helpKey` is provided AND `onHelp` is a function, a "?" icon button is appended
//   that calls onHelp(helpKey). (onHelp callback avoids coupling this module to modal/help.)
// - Consumes the `.field` and `.control` component classes from components.css.

import { createIconButton } from './button.mjs';

/**
 * Create a labeled form field.
 * @param {Object} opts
 * @returns {{ wrapper: HTMLDivElement, input: HTMLInputElement, label: HTMLLabelElement }}
 */
export function createFormField(opts) {
  opts = opts || {};
  const labelText = opts.labelText || '';
  const inputType = opts.inputType || 'text';
  const inputId = opts.inputId || '';
  const value = opts.value != null ? opts.value : '';
  const placeholder = opts.placeholder || '';
  const readonly = !!opts.readonly;
  const helpKey = opts.helpKey;
  const onHelp = opts.onHelp;

  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const label = document.createElement('label');
  if (inputId) label.setAttribute('for', inputId);
  label.textContent = labelText;

  const input = document.createElement('input');
  input.className = 'control';
  if (inputId) input.id = inputId;
  input.type = inputType;
  input.value = value;
  if (placeholder) input.setAttribute('placeholder', placeholder);
  if (readonly) input.setAttribute('readonly', 'readonly');

  wrapper.appendChild(label);
  wrapper.appendChild(input);

  if (helpKey != null && typeof onHelp === 'function') {
    const helpBtn = createIconButton({
      icon: 'help-circle',
      ariaLabel: '帮助',
      variant: 'ghost',
      onClick: function () {
        onHelp(helpKey);
      },
    });
    wrapper.appendChild(helpBtn);
  }

  return {
    wrapper: wrapper,
    input: input,
    label: label,
  };
}
