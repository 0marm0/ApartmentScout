// Installable app, the decisions that need no browser (tests/js/pwa.test.mjs covers them).

/** May this page register the service worker? Needs a secure context (https, or localhost for development), the API,
 *  and a deliberate build: the optimised site (scripts/optimize_site.py) stamps `<meta name="as-build">` into its page,
 *  and `?pwa=1` opts a plain copy of dashboard/ in. A source copy never registers on its own, so a developer's edits are
 *  never hidden by a cache. Never on the local `apartmentscout serve` page (it carries the as-token meta tag: that
 *  server rebuilds data under the page). `?pwa=0` turns it off for one visit.
 *  @param {{ protocol: string, hostname: string, search?: string, hasToken?: boolean, hasApi?: boolean, hasBuild?: boolean }} env */
export function shouldRegister({ protocol, hostname, search = '', hasToken = false, hasApi = true, hasBuild = false }) {
  if (!hasApi || hasToken) return false;
  const q = new URLSearchParams(search).get('pwa');
  if (q === '0' || !(hasBuild || q === '1')) return false;
  if (protocol === 'https:') return true;
  return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost'));
}

/** Same-origin resources the page has loaded so far, as scope-relative URLs the worker can pre-cache ("warm"): the
 *  lazy view bundles, map layers and data a plain copy of dashboard/ (no precache.json) would otherwise miss.
 *  @param {string[]} names resource-timing entry names @param {string} origin @param {string} scope */
export function warmList(names, origin, scope) {
  const out = new Set();
  for (const n of names) {
    let u; try { u = new URL(n); } catch { continue; }
    if (u.origin !== origin || !u.href.startsWith(scope)) continue;
    const rel = u.href.slice(scope.length);
    if (/^(?:sw\.js|precache\.json|api\/|media\/)/.test(rel)) continue;
    out.add(u.pathname + (/\.(?:js|css|json|svg|woff2|webmanifest)$/.test(u.pathname) ? '' : u.search));
  }
  return [...out];
}

/** "1.4 MB" style size for the status line. */
export const sizeLabel = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
