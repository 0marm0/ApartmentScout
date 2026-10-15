// Which home Unit 3D and the Floor plan studio (the Home tab) open when the address names none.
//
// The search names its own default in criteria.yaml (`search.default_listing`); `apartmentscout build` writes it into
// manifest.json as `default_listing`, so no listing id lives in the code. Order of precedence, first one the view can show wins:
//   1. the home in the address (#unit/<id>, #plan/<id>), when the view has data for it;
//   2. the home this view showed last in this session;
//   3. the home the renter opened last in this browser (local storage, key SAVED_KEY): the renter's own choice beats the default;
//   4. the search's default home (manifest.default_listing);
//   5. the first home in the list.
export const SAVED_KEY = 'home-id';

/** `ids`: the homes the view has data for. Returns one of them, or null when there are none. */
export function chooseHome({ want, current, saved, preferred, ids }) {
  const list = Array.isArray(ids) ? ids : [];
  for (const id of [want, current, saved, preferred]) if (typeof id === 'string' && id && list.includes(id)) return id;
  return list.length ? list[0] : null;
}

/** The id to remember after the address named a home the view could show (a deliberate choice), else null. */
export function homeToRemember({ want, ids }) {
  return typeof want === 'string' && want && Array.isArray(ids) && ids.includes(want) ? want : null;
}
