// api.mjs — Unified API fetch helpers (migrated from console.html lines 1096-1111)
//
// Public API:
//   apiSafeJson(r)        → 401 → login.html redirect + reject; non-JSON → throw; else r.json()
//   apiFetch(url, opts)   → fetch with credentials:'include', piped through apiSafeJson
//   apiPost(url, body, opts) → POST JSON shorthand
//   apiGet(url, opts)        → GET shorthand
//
// Contract: a 401 response MUST redirect to login.html — the auth check in
// console.html relies on this side effect.

/**
 * Parse a fetch Response safely.
 *  - 401: redirect to login.html and reject with Error('未登录')
 *  - non-JSON content-type: read text and throw Error('服务端返回非 JSON(...)')
 *  - otherwise: resolve with r.json()
 * @param {Response} r
 * @returns {Promise<any>}
 */
export function apiSafeJson(r) {
  if (r.status === 401) {
    location.href = 'login.html';
    return Promise.reject(new Error('未登录'));
  }
  const ct = r.headers.get('content-type') || '';
  if (ct.indexOf('application/json') < 0) {
    return r.text().then(function (t) {
      throw new Error('服务端返回非 JSON(' + (r.status || '??') + ')');
    });
  }
  return r.json();
}

/**
 * fetch wrapper that always sends credentials and pipes the response through
 * apiSafeJson. Resolves to the parsed JSON.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
export function apiFetch(url, opts) {
  const merged = Object.assign({ credentials: 'include' }, opts || {});
  return fetch(url, merged).then(apiSafeJson);
}

/**
 * POST JSON shorthand.
 * @param {string} url
 * @param {*} body
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
export function apiPost(url, body, opts) {
  return apiFetch(url, Object.assign({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts || {}));
}

/**
 * GET shorthand.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
export function apiGet(url, opts) {
  return apiFetch(url, Object.assign({ method: 'GET' }, opts || {}));
}
