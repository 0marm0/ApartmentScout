// [ar] "View in your room (AR)" for the Floor plan studio: one action for the whole furnished room and one for each piece.
//
// iPhone and iPad (iOS, iPadOS): the action is a real link, `<a rel="ar" href="blob:...usdz"><img>`, which Safari opens in AR Quick Look
// (point at the floor, tap to place, walk around it at true size). A link and not a button because Safari only starts Quick Look from
// a tap on the link itself, not from a script that finishes some time after the tap; so the .usdz files are built ahead, one after the
// other when the studio is idle (the room first), and the link appears as each is ready. Elsewhere (a desktop, an Android phone) the
// action downloads the file: .usdz for an Apple device, .glb for Android's Scene Viewer or any viewer; those are built on the click.
// Pure markup builders and a small stateful kit; the studio supplies `entries()` (what can be shown) and `build(ids)` (the baked model).
import { esc } from '../util.js';
import { arPlatform, exportUSDZ, exportGLB, usdzBlob, glbBlob, fmtBytes, sizeNote } from '../room3d/ar-export.js';

/** The AR cube, as the one image Safari wants as the link's first child (it is also the AR badge). */
const BADGE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/></svg>')}`;
const slug = (s) => String(s || 'furniture').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'furniture';

/** The text and links for one entry in its current state. `file` = {status, url, bytes, size}; pure. */
export function slotHTML(platform, key, label, file, { compact = false } = {}) {
  const k = esc(key), name = `${slug(label)}.usdz`;
  if (platform === 'ios') {
    if (file?.status === 'ready') {
      return `<a class="btn ar-go${compact ? ' sm' : ' primary'}" rel="ar" href="${esc(file.url)}" download="${esc(name)}" data-ar-link="${k}"><img class="ar-ico" alt="" width="16" height="16" src="${BADGE}">${compact ? 'AR' : 'View in your room (AR)'}</a>${compact ? '' : `<small class="ar-size">true size${file.size ? `, ${esc(sizeNote(file.size))}` : ''} · ${esc(fmtBytes(file.bytes))}</small>`}`;
    }
    if (file?.status === 'error') return `<span class="ar-err" role="status" title="${esc(file.error || '')}">AR file failed</span>`;
    return `<span class="ar-wait" role="status" data-ar-wait>${compact ? 'AR…' : 'Preparing the AR model…'}</span>`;
  }
  const first = platform === 'android' ? ['glb', '.glb'] : ['usdz', '.usdz'], second = platform === 'android' ? ['usdz', '.usdz'] : ['glb', '.glb'];
  const b = (f, t, cls) => `<button type="button" class="btn ${cls}${compact ? ' sm' : ''}" data-ar-dl="${f}" data-ar-key="${k}" title="${f === 'usdz' ? 'Download for AR Quick Look on an iPhone or iPad' : 'Download a glTF binary for Android Scene Viewer, Blender or a web viewer'}">${compact ? t : `Download ${t}`}</button>`;
  return compact ? `${b(...first, 'ghost')}${b(...second, 'ghost')}` : `${b(...first, '')}${b(...second, 'ghost')}`;
}

/** The section that sits in the Furniture tab: the whole room, then a note for the device. */
export function sectionHTML(platform) {
  const note = platform === 'ios'
    ? 'Point your phone at the floor, then tap to place. Everything is at true size, in your room, from the sizes in your furniture list. Each piece has its own AR link below.'
    : 'Open the .usdz on an iPhone or iPad (AirDrop it, or open this page there) to see it at true size in your room. The .glb opens in Android\'s Scene Viewer, Blender or any glTF viewer.';
  return `<section class="ar" aria-label="See it in your room">
    <h3 class="label">See it in your room <span>true size, in AR</span></h3>
    <div class="ar-room" data-ar="room" data-ar-label="Whole furnished room"></div>
    <p class="ps-note faint">${esc(note)}</p></section>`;
}

/**
 * The stateful kit. `entries()` -> [{key, label, sig}] (key 'room' is the whole layout); `build(ids|null)` -> the baked group (arModel).
 * `opts.platform` defaults to the device's; `opts.save(blob, filename)` downloads (tests replace it).
 */
export function createAr({ entries, build, platform = arPlatform(), save = defaultSave, delay = 700 }) {
  const files = new Map();   // key -> {sig, status, url, bytes, size, error}
  let timer = 0, running = false, again = false, dead = false;
  const label = (key) => entries().find((e) => e.key === key)?.label || key;
  const paint = (root = document) => {
    for (const el of root.querySelectorAll('[data-ar]')) {
      const key = el.dataset.ar, e = entries().find((x) => x.key === key); if (!e) { el.innerHTML = ''; continue; }
      const f = files.get(key), file = f && f.sig === e.sig ? f : null;   // a link for an older layout is never shown: it says it is preparing
      const html = slotHTML(platform, key, e.label, file, { compact: 'arCompact' in el.dataset });
      if (el.dataset.arHtml !== html) { el.innerHTML = html; el.dataset.arHtml = html; }
    }
  };
  async function prepareAll() {
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        const list = entries(), order = [...list.filter((e) => e.key === 'room'), ...list.filter((e) => e.key !== 'room')];
        for (const e of order) {
          if (dead) return;
          const have = files.get(e.key); if (have?.sig === e.sig && have.status !== 'error') continue;
          files.set(e.key, { sig: e.sig, status: 'busy', old: have?.url });
          try {
            const root = await build(e.key === 'room' ? null : [e.key]), bytes = await exportUSDZ(root);
            if (have?.url) URL.revokeObjectURL(have.url);
            files.set(e.key, { sig: e.sig, status: 'ready', url: URL.createObjectURL(usdzBlob(bytes)), bytes: bytes.byteLength, size: root.userData.ar?.size });
          } catch (err) { files.set(e.key, { sig: e.sig, status: 'error', error: String(err?.message || err) }); }
          paint(); await new Promise((r) => setTimeout(r, 30));
        }
      } while (again);
    } finally { running = false; }
  }
  const api = {
    platform, files, paint,
    /** Something changed (a piece moved, the tab opened): iOS rebuilds what is stale a moment after the last change. */
    touch() { paint(); if (platform !== 'ios' || dead) return; clearTimeout(timer); timer = setTimeout(prepareAll, delay); },
    /** Build one file now and save it (desktop and Android; also what a test calls). */
    async download(key, kind = 'usdz') {
      const root = await build(key === 'room' ? null : [key]), stem = slug(key === 'room' ? label('room') : label(key));
      if (kind === 'glb') save(glbBlob(await exportGLB(root)), `${stem}.glb`); else save(usdzBlob(await exportUSDZ(root)), `${stem}.usdz`);
      return root.userData.ar;
    },
    /** One delegated click handler for the download buttons. */
    onClick(e, toast = () => {}) {
      const b = e.target.closest?.('[data-ar-dl]'); if (!b) return false;
      e.preventDefault(); b.disabled = true;
      toast('Building the AR model…');
      api.download(b.dataset.arKey, b.dataset.arDl).then((s) => toast(`Saved (${sizeNote(s.size)}, true size)`), (err) => toast(`Could not build the AR model: ${err?.message || err}`, 5000)).finally(() => { b.disabled = false; });
      return true;
    },
    dispose() { dead = true; clearTimeout(timer); for (const f of files.values()) if (f.url) URL.revokeObjectURL(f.url); files.clear(); },
  };
  return api;
}

function defaultSave(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
