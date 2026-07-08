// section-nav.mjs — Sidebar section navigation (migrated from console.html
//                   IntersectionObserver + smooth-scroll, lines 1169-1203)
//
// Public API:
//   initSectionNav(opts) → { setActive(id) }
//
// opts:
//   { sidebar, sections, links, mobileBreakpoint }   (mobileBreakpoint default 1024)
//
// - Click handlers on `links` smooth-scroll to the matching #section-*.
// - IntersectionObserver highlights the active nav link for the section in view
//   (active style: color var(--brand-500); background var(--brand-50)).
// - Mobile: clicking a link when window.innerWidth < breakpoint collapses the sidebar
//   (removes `open` class from sidebar + #sidebar-overlay).

/**
 * Initialize section navigation.
 * @param {Object} opts
 * @param {HTMLElement} [opts.sidebar]
 * @param {Element[]} [opts.sections]   array of <section id="section-*">
 * @param {HTMLAnchorElement[]} [opts.links]
 * @param {number} [opts.mobileBreakpoint=1024]
 * @returns {{ setActive: Function }}
 */
export function initSectionNav(opts) {
  opts = opts || {};
  const sidebar = opts.sidebar;
  const sections = opts.sections || [];
  const links = opts.links || [];
  const mobileBreakpoint = opts.mobileBreakpoint || 1024;

  function setActive(id) {
    links.forEach(function (a) {
      const href = a.getAttribute('href') || '';
      if (href === '#' + id) {
        a.style.color = 'var(--brand-500)';
        a.style.background = 'var(--brand-50)';
      } else {
        a.style.color = 'var(--apple-foreground)';
        a.style.background = 'transparent';
      }
    });
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) setActive(en.target.id);
        });
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: 0 }
    );
    sections.forEach(function (s) {
      io.observe(s);
    });
  }

  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      const href = a.getAttribute('href') || '';
      if (href.indexOf('#') === 0 && href.length > 1) {
        e.preventDefault();
        const target = document.getElementById(href.slice(1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (window.innerWidth < mobileBreakpoint && sidebar) {
          sidebar.classList.remove('open');
          const overlay = document.getElementById('sidebar-overlay');
          if (overlay) overlay.classList.remove('open');
        }
      }
    });
  });

  return { setActive: setActive };
}
