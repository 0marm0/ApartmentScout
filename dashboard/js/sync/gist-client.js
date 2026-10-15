// The only module that talks to api.github.com. It reads and writes one private ("secret") gist that holds the sync document. It never
// logs, never puts the token in an error message or a URL, sends nothing to any other host, and sends nothing but the sync files.
// `fetch` is passed in, so the unit tests and the browser tests answer for GitHub and no test ever reaches the real API.
import { MAIN_FILE, PART_RE } from './sync-model.js';

export const API = 'https://api.github.com';
export const DESCRIPTION = 'ApartmentScout sync (your picks, notes and tour findings; written by the app, safe to leave alone)';
export const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';
export const CLASSIC_TOKEN_PAGE = 'https://github.com/settings/tokens/new?scopes=gist&description=ApartmentScout%20sync';

/** Why a call failed, in the words the panel uses. `kind`: network | auth | forbidden | ratelimit | notfound | invalid | server | shape. */
export class SyncError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    Object.assign(this, extra);   // status, retryAt (ms since epoch)
  }
}

const redact = (text, token) => (token ? String(text).split(token).join('[token]') : String(text));

/** @param {{ token: string, fetch?: typeof fetch, now?: () => number, timeoutMs?: number }} o */
export function createClient({ token, fetch: fetchFn = (...a) => globalThis.fetch(...a), now = () => Date.now(), timeoutMs = 25000 }) {
  if (!token || typeof token !== 'string') throw new SyncError('auth', 'No token.');

  async function call(method, path, body, { etag = null, keepalive = false } = {}) {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-None-Match'] = etag;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetchFn(API + path, {
        method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', keepalive: keepalive || undefined, signal: ctl?.signal,
      });
    } catch (e) {
      throw new SyncError('network', e?.name === 'AbortError' ? 'GitHub did not answer in time.' : 'GitHub cannot be reached.');
    } finally { if (timer) clearTimeout(timer); }
    if (res.status === 304) return { status: 304, etag: res.headers.get('etag') || etag, data: null };
    let data = null;
    try { data = await res.json(); } catch { /* an empty or non-JSON body */ }
    if (res.ok) return { status: res.status, etag: res.headers.get('etag') || null, data };
    throw failure(res, data);
  }

  function failure(res, data) {
    const status = res.status, msg = redact(String(data?.message || '').slice(0, 200), token), h = (n) => res.headers.get(n);
    const remaining = h('x-ratelimit-remaining'), retryAfter = Number(h('retry-after')), reset = Number(h('x-ratelimit-reset'));
    const limited = status === 429 || (status === 403 && (remaining === '0' || Number.isFinite(retryAfter) && h('retry-after') != null || /rate limit|abuse|secondary/i.test(msg)));
    if (limited) {
      const retryAt = Number.isFinite(retryAfter) && h('retry-after') != null ? now() + retryAfter * 1000 : Number.isFinite(reset) && reset > 0 ? reset * 1000 : now() + 60000;
      return new SyncError('ratelimit', 'GitHub asked for a pause.', { status, retryAt: Math.max(retryAt, now() + 5000) });
    }
    if (status === 401) return new SyncError('auth', 'GitHub does not accept this token. It may have expired or been revoked.', { status });
    if (status === 403) return new SyncError('forbidden', 'This token is not allowed to use gists. It needs the Gists permission, read and write.', { status });
    if (status === 404) return new SyncError('notfound', 'GitHub cannot find the sync gist for this token (it was deleted, or the token cannot see it).', { status });
    if (status === 422 || status === 413) return new SyncError('invalid', `GitHub refused the sync data${msg ? `: ${msg}` : ''}.`, { status });
    if (status >= 500) return new SyncError('server', 'GitHub is having trouble. The app will try again.', { status });
    return new SyncError('shape', `GitHub answered ${status}${msg ? `: ${msg}` : ''}.`, { status });
  }

  const files = (g) => (g && typeof g === 'object' && g.files && typeof g.files === 'object' ? g.files : null);

  return {
    /** The sync files of a gist as { name: text }. With `etag` and an unchanged gist: { notModified: true }. */
    async get(id, { etag = null } = {}) {
      const r = await call('GET', `/gists/${encodeURIComponent(id)}`, undefined, { etag });
      if (r.status === 304) return { notModified: true, etag: r.etag };
      const f = files(r.data);
      if (!f) throw new SyncError('shape', 'GitHub sent something that is not a gist.');
      const out = {};
      for (const [name, file] of Object.entries(f)) {
        if (!PART_RE.test(name)) continue;
        if (file?.truncated) throw new SyncError('shape', `The sync file ${name} is larger than GitHub returns in one call. Disconnect and connect again to rebuild it.`);
        if (typeof file?.content === 'string') out[name] = file.content;
      }
      return { files: out, etag: r.etag, htmlUrl: r.data.html_url || null, updatedAt: r.data.updated_at || null, owner: r.data.owner?.login || null };
    },
    /** Make a new secret gist holding `files` ({ name: text }). */
    async create(fileMap) {
      const r = await call('POST', '/gists', { description: DESCRIPTION, public: false, files: contentOf(fileMap) });
      if (!r.data?.id) throw new SyncError('shape', 'GitHub did not return the new gist.');
      return { id: String(r.data.id), etag: r.etag, htmlUrl: r.data.html_url || null, owner: r.data.owner?.login || null };
    },
    /** Write files: { name: text } sets a file, { name: null } removes it. Files not named are left as they are. */
    async update(id, fileMap, { keepalive = false } = {}) {
      const r = await call('PATCH', `/gists/${encodeURIComponent(id)}`, { files: contentOf(fileMap) }, { keepalive });
      return { etag: r.etag, htmlUrl: r.data?.html_url || null };
    },
    /** The newest of this account's gists that holds a sync file, or null (so a second device finds the first one's gist from the token alone). */
    async find() {
      let best = null;
      for (let page = 1; page <= 3; page++) {
        const r = await call('GET', `/gists?per_page=100&page=${page}`);
        const list = Array.isArray(r.data) ? r.data : [];
        for (const g of list) {
          if (!g?.id || !g.files || !(MAIN_FILE in g.files)) continue;
          if (!best || String(g.updated_at) > String(best.updated_at)) best = g;
        }
        if (list.length < 100) break;
      }
      return best ? { id: String(best.id), htmlUrl: best.html_url || null, updatedAt: best.updated_at || null, owner: best.owner?.login || null } : null;
    },
    /** The account name the token belongs to, or null (a token with only the Gists permission may not be allowed to ask). */
    async user() {
      try { const r = await call('GET', '/user'); return typeof r.data?.login === 'string' ? r.data.login : null; } catch (e) { if (e.kind === 'network') throw e; return null; }
    },
  };
}

function contentOf(fileMap) {
  const out = {};
  for (const [name, text] of Object.entries(fileMap)) out[name] = text === null ? null : { content: text };
  return out;
}

/** A gist id from what a person pastes: the bare id, or a gist.github.com link ending in it. Null when it is neither. */
export function gistIdFrom(text) {
  const t = String(text || '').trim();
  const m = /(?:^|\/)([0-9a-f]{20,40})(?:[/?#.]|$)/i.exec(t);
  return m ? m[1].toLowerCase() : null;
}
/** Does this look like a GitHub token? (Fine-grained ones start github_pat_, classic ones ghp_.) Only a hint for the panel; GitHub decides. */
export const looksLikeToken = (t) => /^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/.test(String(t || '').trim());
