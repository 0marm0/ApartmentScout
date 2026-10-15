// Data the page asked for before any code had downloaded. The optimised build (scripts/optimize_site.py) puts a tiny inline
// script in <head> that starts the boot fetches (listings, criteria, manifest, notes, blur-up previews) into
// window.__AS_EARLY; getJSON() in app.js takes a promise from here instead of fetching again. With no such script (the
// source tree, the standalone file, ?data=...) this returns null and the app fetches as it always did.

/** The pending JSON for a data path such as 'data/listings.json', or null. Each path is handed out once. */
export function takeEarly(path) {
  const early = typeof window === 'undefined' ? null : window.__AS_EARLY;
  const p = early && early[path];
  if (!p) return null;
  delete early[path];
  return p;
}
