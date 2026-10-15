// Office (destination) pin style: "gold" (white pin, gold outline, green briefcase; the default) or "classic" (the
// green pin with a white briefcase). Chosen in the settings menu or with ?pin=classic; remembered per browser.
const KEY = 'as:destPin';
const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const put = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: the choice lasts this visit */ } };

export function applyDestPin(v) {
  const style = v === 'classic' ? 'classic' : 'gold';
  if (style === 'classic') document.documentElement.dataset.destPin = 'classic'; else delete document.documentElement.dataset.destPin;
  document.querySelectorAll('[data-dest-pin]').forEach((b) => { if (b.tagName === 'BUTTON') b.setAttribute('aria-checked', String(b.dataset.destPin === style)); });
  return style;
}

export function initDestPin() {
  const q = new URLSearchParams(location.search).get('pin');
  applyDestPin(q || get());
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-dest-pin]');
    if (!b) return;
    put(applyDestPin(b.dataset.destPin));
  });
}
