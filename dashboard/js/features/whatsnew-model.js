// "What's new": the pure part. Reads alerts.json (the digest `apartmentscout build` writes from `apartmentscout alerts`; schema in
// apartmentscout/alerts.py) and works out what the panel, the menu dot, the home-screen badge and the local notification say.
// No DOM and no imports, so `node --test` can load it; whatsnew.js owns the screen, the Badging API and the Notification API.

export const GROUPS = [
  ['new', 'New homes that fit'], ['fits', 'Now fit your criteria'], ['drops', 'Price drops'], ['rises', 'Price rises'],
  ['gone', 'No longer available'], ['back', 'Back on the market'], ['jumps', 'Into the top {top}'], ['resolved', 'Unknowns resolved'],
];

const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? `$${Math.round(v).toLocaleString('en-US')}` : 'price unknown');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Oct 14' from '2026-10-14' (or an ISO time); the text unchanged when it is not a date. */
export function dayText(iso) {
  const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[+m[1] - 1]} ${+m[2]}` : String(iso || '');
}

/** The digest as the panel uses it, or null when the file is not an alerts digest (missing, another schema, damaged). */
export function parseAlerts(doc) {
  if (!doc || typeof doc !== 'object' || doc.kind !== 'alerts' || doc.schema_version !== 1) return null;
  const groups = {};
  for (const [k] of GROUPS) groups[k] = Array.isArray(doc.groups?.[k]) ? doc.groups[k].filter((r) => r && typeof r.id === 'string') : [];
  const total = Object.values(groups).reduce((n, rows) => n + rows.length, 0);
  return {
    id: String(doc.id || ''), title: String(doc.title || ''), headline: String(doc.headline || ''), since: doc.since || null, generated: doc.generated || null,
    firstRun: !!doc.first_run, pending: !!doc.pending, top: Number(doc.top) || 10, tracked: Number(doc.tracked) || 0, fitting: Number(doc.fitting) || 0,
    quietNew: Number(doc.quiet_new) || 0, note: doc.note || null, total, groups,
  };
}

/** What the badge and the menu dot show: the number of changes while this digest has not been seen, else 0. */
export const badgeCount = (digest, seenId) => (digest && digest.total > 0 && digest.id !== seenId ? digest.total : 0);

/** Should a local notification be shown now? Once per digest, only with permission, the renter's opt-in and something to say. */
export function shouldNotify({ digest, permission, enabled, notifiedId, seenId }) {
  return !!(digest && digest.total > 0 && enabled && permission === 'granted' && digest.id !== notifiedId && digest.id !== seenId);
}

/** The text of the notification. */
export const notificationText = (digest) => ({
  title: 'ApartmentScout', body: digest.headline ? `${digest.headline[0].toUpperCase()}${digest.headline.slice(1)}` : 'Something changed in your search',
});

/** One row of the panel for one change. */
export function rowOf(group, r) {
  const name = r.name || r.id, hood = r.hood || '';
  const rank = r.rank ? `ranked #${r.rank}` : '';
  switch (group) {
    case 'new': case 'back': return { id: r.id, name, hood, right: money(r.gross), sub: rank };
    case 'fits': return { id: r.id, name, hood, right: money(r.gross), sub: [rank, r.why ? `${r.why} before` : '', r.from != null ? `${r.delta < 0 ? 'down' : 'up'} from ${money(r.from)}` : ''].filter(Boolean).join(' · ') };
    case 'drops': case 'rises': {
      const d = Math.abs(r.delta || 0);
      return { id: r.id, name, hood, right: `${r.delta < 0 ? '−' : '+'}${money(d)}`, sub: `${money(r.from)} → ${money(r.to)}${r.basis && r.basis !== 'rent' ? ` ${r.basis}` : ''}`, tone: r.delta < 0 ? 'good' : 'warn' };
    }
    case 'gone': return { id: r.id, name, hood, right: 'gone', sub: r.was_rank ? `was ranked #${r.was_rank}` : '', tone: 'bad', static: !!r.removed };
    case 'jumps': return { id: r.id, name, hood, right: `#${r.from} → #${r.to}`, sub: '' };
    default: return { id: r.id, name, hood, right: '', sub: `now known: ${(r.resolved || []).join(', ')}` };
  }
}

/** The groups that have changes, each with its title and its rows, in reading order. */
export function sectionsOf(digest) {
  if (!digest) return [];
  return GROUPS.filter(([k]) => digest.groups[k].length)
    .map(([k, title]) => ({ key: k, title: title.replace('{top}', digest.top), count: digest.groups[k].length, rows: digest.groups[k].map((r) => rowOf(k, r)) }));
}

/** One calm sentence under the heading. */
export function subtitle(digest) {
  if (!digest) return '';
  if (digest.firstRun) return `Alerts start here: ${digest.tracked} homes tracked, ${digest.fitting} fit your criteria.`;
  if (!digest.total) return digest.note || 'Nothing changed for the homes that fit your criteria or are on your shortlist.';
  const since = digest.since ? `Since ${dayText(digest.since)}` : 'Recently';
  return `${since}: ${digest.headline}.`;
}

/** How the "notify me on this device" control should read, from what the browser offers. */
export function notifyState({ supported, permission, enabled, ios, standalone }) {
  if (!supported) return ios && !standalone ? { kind: 'install', text: 'On iPhone, add ApartmentScout to the Home Screen to turn on notifications and the icon badge.' } : { kind: 'none', text: '' };
  if (permission === 'denied') return { kind: 'blocked', text: 'Notifications are blocked for this app. Allow them in the browser or iPhone settings to use this.' };
  if (permission === 'granted' && enabled) return { kind: 'on', text: 'On: opening the app with something new shows a notification and a badge on the icon.' };
  return { kind: 'off', text: 'Get a notification and a badge on the icon when you open the app and something changed.' };
}
