"""Markdown shortlist report: the document you send yourself (or a partner) before tours."""
from __future__ import annotations

import datetime as dt

from .listings import monthly_cost


def _fmt_money(v):
    return f"${v:,.0f}" if v is not None else "?"


def _n(v):
    if v is None:
        return "?"
    return f"{v:.0f}" if isinstance(v, (int, float)) else str(v)


def _yn(v):
    return {True: "yes", False: "no", None: "?"}.get(v, str(v))


def shortlist_report(ws, listings, crit, top: int = 15):
    ranked = sorted((L for L in listings if (L.get("score") or {}).get("rank")), key=lambda L: L["score"]["rank"])[:top]
    favs = [L for L in listings if L.get("status") in ("shortlist", "touring") and L not in ranked]
    dests = [d["name"] for d in crit["commute"]["destinations"]]
    lines = [f"# {crit['search'].get('name', 'Apartment search')}: shortlist", "",
             f"Generated {dt.date.today().isoformat()} from {len(listings)} listings. "
             f"Budget basis: net-effective rent plus fees. Weights: {crit['weights']}.", "",
             "| # | Listing | $/mo | Tier | Score | Conf. | " + " | ".join(dests) + " | W/D | Doorman | Gym | Flags |",
             "|---|---|---:|---|---:|---:|" + "---:|" * len(dests) + "---|---|---|---|"]
    for L in ranked:
        s, am = L["score"], L.get("amenities") or {}
        cm = [f"{(L.get('commute') or {}).get(d, {}).get('minutes', 0):.0f} min" if (L.get('commute') or {}).get(d) else "?" for d in dests]
        flags = ", ".join(g for g in s["gates"] if g.startswith("unverified")) or ""
        lines.append(f"| {s['rank']} | {L.get('building')} {L.get('unit')} | {_fmt_money(s['monthly_cost'])} | "
                     f"{s.get('budget_tier') or '?'} | {s['overall']} | {s['confidence']}% | " + " | ".join(cm) +
                     f" | {_yn(am.get('in_unit_wd'))} | {am.get('doorman') or '?'} | {_yn(am.get('gym'))} | {flags} |")
    lines.append("")
    for L in ranked[:top]:
        s = L["score"]
        lines += [f"## {s['rank']}. {L.get('building')} {L.get('unit')}", "",
                  " · ".join(x for x in (L.get("address"), L.get("neighborhood"), f"{_n(L.get('beds'))} bd",
                                         f"{_n(L.get('sqft'))} sq ft", f"floor {_n(L.get('floor'))}",
                                         f"exposure {','.join(L.get('exposure') or []) or '?'}") if x), "",
                  f"Monthly cost {_fmt_money(monthly_cost(L))} (gross {_fmt_money((L.get('price') or {}).get('gross'))}). "
                  f"Score {s['overall']} (range {s['range'][0]}-{s['range'][1]}, {s['confidence']}% of weight known).", ""]
        parts = ", ".join(f"{k} {v:.0f}" for k, v in s["parts"].items() if v is not None)
        lines += [f"Scores: {parts}.", ""]
        for d, c in (L.get("commute") or {}).items():
            lines.append(f"- Commute to {d}: {c['minutes']:.0f} min ({c.get('route')})")
        rec = L.get("records") or {}
        for f in rec.get("flags") or []:
            lines.append(f"- Records: {f}")
        rv = L.get("reviews") or {}
        if rv.get("summary"):
            lines.append(f"- Reviews: {rv['summary']}")
        if L.get("notes"):
            lines.append(f"- Open questions: {L['notes']}")
        if (L.get("links") or {}).get("listing"):
            lines.append(f"- Listing: {L['links']['listing']}")
        lines.append("")
    if favs:
        lines += ["## Also on your shortlist (not ranked: failed a gate or missing data)", ""]
        for L in favs:
            lines.append(f"- {L.get('building')} {L.get('unit')}: {', '.join((L.get('score') or {}).get('gates') or [])}")
    p = ws.root / "shortlist.md"
    p.write_text("\n".join(lines) + "\n")
    return p
