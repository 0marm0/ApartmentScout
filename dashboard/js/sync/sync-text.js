// The words of the sync panel and the menu row, as pure functions of the status (so `node --test` checks them).

const ms = (t) => { const x = Date.parse(t); return Number.isFinite(x) ? x : 0; };

/** "just now", "2 min ago", "3 h ago", "yesterday", "12 Oct". */
export function ago(iso, nowMs = Date.now()) {
  const t = ms(iso);
  if (!t) return 'never';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
const clock = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The one-line status. `s`: { target: 'off'|'gist'|'file', phase: 'idle'|'syncing'|'synced'|'offline'|'limited'|'error', lastSync, lastFileOut, lastFileIn, pending, retryAt, error: {message} }
 * @returns {{ text: string, tone: 'off'|'ok'|'busy'|'warn'|'bad' }}
 */
export function statusLine(s, nowMs = Date.now()) {
  if (s.target === 'file') {
    const out = s.lastFileOut ? `exported ${ago(s.lastFileOut, nowMs)}` : 'not exported yet', inn = s.lastFileIn ? `, merged ${ago(s.lastFileIn, nowMs)}` : '';
    return { text: `Sync file: ${out}${inn}`, tone: s.lastFileOut ? 'ok' : 'off' };
  }
  if (s.target !== 'gist') return { text: 'Sync is off', tone: 'off' };
  const wait = s.pending ? ' · changes waiting' : '';
  switch (s.phase) {
    case 'syncing': return { text: 'Syncing…', tone: 'busy' };
    case 'offline': return { text: 'Offline: will sync when you are back', tone: 'warn' };
    case 'limited': return { text: s.retryAt ? `GitHub asked for a pause: trying again at ${clock(s.retryAt)}` : 'GitHub asked for a pause: trying again soon', tone: 'warn' };
    case 'error': return { text: s.error?.message || 'Sync stopped', tone: 'bad' };
    case 'synced': return { text: `Synced ${ago(s.lastSync, nowMs)}${wait}`, tone: 'ok' };
    default: return { text: s.lastSync ? `Synced ${ago(s.lastSync, nowMs)}${wait}` : s.pending ? 'Changes waiting to sync' : 'Ready to sync', tone: s.lastSync && !s.pending ? 'ok' : 'busy' };
  }
}

/** A short line for what a merge changed: "3 new, 2 updated, 1 removed". Empty when nothing changed. */
export function mergeLine({ added = 0, updated = 0, removed = 0 } = {}) {
  return [added && `${added} new`, updated && `${updated} updated`, removed && `${removed} removed`].filter(Boolean).join(', ');
}

/** Bytes as "12 KB" / "3.4 MB". */
export function size(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}
