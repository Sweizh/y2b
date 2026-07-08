// card.mjs — Card component (consumes .card class from components.css)
//
// Public API:
//   createCard(opts) → HTMLDivElement
//
// opts:
//   { title, bodyHTML, extraClasses }
// - Creates <div class="card"> (with optional extraClasses).
// - Optional <h3> title (set via textContent).
// - bodyHTML set via innerHTML.

/**
 * Create a card element.
 * @param {Object} [opts]
 * @returns {HTMLDivElement}
 */
export function createCard(opts) {
  opts = opts || {};

  const card = document.createElement('div');
  card.className = 'card';
  if (opts.extraClasses) {
    card.className += ' ' + opts.extraClasses;
  }

  if (opts.title) {
    const h = document.createElement('h3');
    h.textContent = opts.title;
    card.appendChild(h);
  }

  if (opts.bodyHTML != null) {
    const body = document.createElement('div');
    body.innerHTML = opts.bodyHTML;
    card.appendChild(body);
  }

  return card;
}
