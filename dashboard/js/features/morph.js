// A small DOM patcher: make a live element look like freshly built markup while keeping the nodes that did not
// change, so an <img> does not reload, a hover or focus state survives, and event listeners on kept nodes stay.
// It is used for the result cards, whose markup is rebuilt from data on every re-rank; only the changed text,
// attributes and nodes are touched.
//
// Other scripts decorate cards after they render (enhance.js fades photos in with an `ld` class and cycles extra
// photos on hover), so a few classes and nodes are left alone instead of being "corrected" back to the markup.

const KEEP_CLASS = new Set(['ld', 'err', 'cycling', 'hl', 'dragging']);   // set by scripts, never by the markup
const KEEP_ATTR = /^(?:aria-posinset|aria-setsize|data-vk)$/;              // set by the windowed list
const foreign = (n) => n.nodeType === 1 && (n.classList.contains('cyc') || n.classList.contains('cyc-dots'));

function syncAttrs(real, next) {
  for (const a of next.attributes) {
    if (a.name === 'class') {
      const want = new Set(a.value.split(/\s+/).filter(Boolean));
      for (const c of real.classList) if (KEEP_CLASS.has(c)) want.add(c);
      const cls = [...want].join(' ');
      if (real.getAttribute('class') !== cls) real.setAttribute('class', cls);
    } else if (real.getAttribute(a.name) !== a.value) real.setAttribute(a.name, a.value);
  }
  for (const name of real.getAttributeNames()) {
    if (!next.hasAttribute(name) && !KEEP_ATTR.test(name) && !(name === 'class' && real.classList.length && [...real.classList].every((c) => KEEP_CLASS.has(c)))) real.removeAttribute(name);
  }
}

/** Patch `real`'s attributes and children to match `next` (same tag). Returns false when the tags differ. */
export function morph(real, next) {
  if (real.localName !== next.localName) return false;
  syncAttrs(real, next);
  let r = real.firstChild, n = next.firstChild;
  while (r && foreign(r)) r = r.nextSibling;
  while (n) {
    const after = n.nextSibling;
    if (!r) real.append(n);   // moving a node out of the template: `after` was read first
    else if (r.nodeType === n.nodeType && (n.nodeType !== 1 || r.localName === n.localName)) {
      if (n.nodeType === 1) morph(r, n); else if (r.nodeValue !== n.nodeValue) r.nodeValue = n.nodeValue;
      r = r.nextSibling;
      while (r && foreign(r)) r = r.nextSibling;
    } else {
      const nx = r.nextSibling;
      real.replaceChild(n, r);
      r = nx;
      while (r && foreign(r)) r = r.nextSibling;
    }
    n = after;
  }
  while (r) { const nx = r.nextSibling; if (!foreign(r)) r.remove(); r = nx; }
  return true;
}

/** Parse one element of markup. */
export function parse(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild;
}
