"""Static PNG charts for reports and READMEs (the dashboard draws its own, interactively)."""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from .sun import Skyline, at, day_track, window_point  # noqa: E402

INK, MUTED, SUN, SHADE, ACCENT = "#18211d", "#5d6a63", "#d98a00", "#4b6a9b", "#0d7556"


def _style(ax):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.grid(alpha=0.25)


def sun_charts(site: dict, face: dict, floor: int, out_dir: Path, stem: str, compare_floor: int | None = None) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    tz = site.get("timezone", "America/New_York")
    lat, lon = site["origin"]["lat"], site["origin"]["lon"]
    sky = Skyline(site)
    fh = site.get("floor_height_m", 3.2)
    t = (site.get("window") or {}).get("t", 0.5)
    prof = sky.profile(*window_point(face, t, floor, fh))
    cmp_floor = compare_floor or min(len(site.get("study", {}).get("floors_table", {})) + 1, floor + 9)
    prof2 = sky.profile(*window_point(face, t, cmp_floor, fh))
    fb = face["bearing"]
    paths = []
    # sun path vs skyline
    fig, ax = plt.subplots(figsize=(10, 4.6), dpi=140)
    az = np.arange(fb - 110, fb + 110.5, 0.5)
    ax.fill_between(az, 0, [min(75, at(prof, a)) for a in az], color=SHADE, alpha=0.55, lw=0,
                    label=f"Buildings blocking sky, floor {floor}")
    ax.plot(az, [min(75, at(prof2, a)) for a in az], color=INK, lw=1.2, ls="--", label=f"Skyline from floor {cmp_floor}")
    year = dt.date.today().year
    for (m, d), c, lw, lab in (((12, 21), MUTED, 1, "Dec 21"), ((3, 20), MUTED, 1, "Mar 20 / Sep 22"),
                               ((6, 21), MUTED, 1, "Jun 21"), ((10, 15), SUN, 2.4, "Oct 15")):
        tr = day_track(dt.date(year, m, d), lat, lon, tz)
        xs = [((a - fb + 540) % 360 - 180) + fb for _, a, _ in tr]
        ys = [min(75, al) for _, _, al in tr]
        ax.plot(xs, ys, color=c, lw=lw, label=lab)
        if lw > 2:
            for mm, a, al in tr:
                if mm % 60 == 0:
                    x = ((a - fb + 540) % 360 - 180) + fb
                    if fb - 110 <= x <= fb + 110:
                        ax.plot(x, al, "o", color=c, ms=4)
                        h = mm // 60
                        ax.annotate(f"{(h - 1) % 12 + 1}{'am' if h < 12 else 'pm'}", (x, al), textcoords="offset points",
                                    xytext=(0, 6), ha="center", fontsize=8, color=c)
    ax.axvline(fb - 90, color=MUTED, ls=":", lw=1)
    ax.axvline(fb + 90, color=MUTED, ls=":", lw=1)
    ax.set_xlim(fb - 110, fb + 110)
    ax.set_ylim(0, 75)
    ticks = np.arange(np.ceil((fb - 110) / 30) * 30, fb + 111, 30)
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{int(t % 360)}°" for t in ticks])
    ax.set_xlabel("compass bearing (window faces %d°)" % fb, color=MUTED)
    ax.set_ylabel("degrees above horizon", color=MUTED)
    ax.set_title(f"Sun path against the skyline, floor {floor}", loc="left", color=INK, fontsize=12)
    ax.legend(fontsize=8, loc="upper right", frameon=False, ncol=2)
    _style(ax)
    fig.tight_layout()
    p = out_dir / f"{stem}-sunpath.png"
    fig.savefig(p)
    plt.close(fig)
    paths.append(p)
    # floors x months table
    tab = site.get("study", {}).get("floors_table") or {}
    if tab:
        floors = sorted(int(k) for k in tab)
        M = np.array([tab[f] if f in tab else tab[str(f)] for f in floors])
        fig, ax = plt.subplots(figsize=(8, 0.28 * len(floors) + 1.4), dpi=140)
        ax.imshow(M, cmap="YlOrBr", vmin=0, vmax=9, aspect="auto", origin="lower")
        for i, f in enumerate(floors):
            for j in range(12):
                v = M[i, j]
                ax.text(j, i, f"{v:.1f}", ha="center", va="center", fontsize=7, color="#1b1200" if v > 4 else INK)
        ax.set_yticks(range(len(floors)))
        ax.set_yticklabels(floors, fontsize=8)
        ax.set_xticks(range(12))
        ax.set_xticklabels("JFMAMJJASOND", fontsize=9)
        ax.set_ylabel("floor", color=MUTED)
        ax.set_title("Direct sun, hours per day (15th of each month)", loc="left", color=INK, fontsize=12)
        if floor in floors:
            k = floors.index(floor)
            ax.add_patch(plt.Rectangle((-0.5, k - 0.5), 12, 1, fill=False, ec=ACCENT, lw=2))
        fig.tight_layout()
        p = out_dir / f"{stem}-sun-by-floor.png"
        fig.savefig(p)
        plt.close(fig)
        paths.append(p)
    p = sun_range_chart(site, out_dir / f"{stem}-sun-range.png")
    if p:
        paths.append(p)
    return paths


def sun_range_chart(site: dict, out: Path) -> Path | None:
    """Monthly direct sun for the chosen window, with the range over facade positions and nearby
    floors shaded, and the after-construction line when filed buildings would cut it."""
    st = site.get("study") or {}
    rng, hours = st.get("sun_hours_range"), st.get("sun_hours")
    if not rng or not hours:
        return None
    x = np.arange(12)
    fig, ax = plt.subplots(figsize=(8, 3.4), dpi=140)
    fl = rng.get("floors") or []
    ax.fill_between(x, rng["lo"], rng["hi"], color=SUN, alpha=0.22, lw=0,
                    label=f"range: window positions {', '.join(f'{t:.2f}' for t in rng.get('positions', []))}"
                          + (f", floors {fl[0]}-{fl[-1]}" if fl else ""))
    w = site.get("window") or {}
    ax.plot(x, hours, color=SUN, lw=2.2, marker="o", ms=3.5, label=f"floor {w.get('floor')}, window at t={w.get('t')}")
    if st.get("sun_hours_future"):
        ax.plot(x, st["sun_hours_future"], color=INK, lw=1.2, ls="--", label="with filed new buildings")
    ax.set_xticks(x)
    ax.set_xticklabels("JFMAMJJASOND")
    ax.set_ylim(0, max(9, max(rng["hi"]) + 0.5))
    ax.set_ylabel("hours per day", color=MUTED)
    ax.set_title("Direct sun on the window, 15th of each month", loc="left", color=INK, fontsize=12)
    ax.legend(fontsize=8, loc="upper left", frameon=False)
    _style(ax)
    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    plt.close(fig)
    return out


def noise_hour_chart(dossier: dict, out: Path) -> Path | None:
    nz = dossier.get("noise_311") or {}
    hrs = nz.get("by_hour")
    if not hrs:
        return None
    fig, ax = plt.subplots(figsize=(8, 3), dpi=140)
    cols = [SHADE if (h >= 22 or h < 6) else ACCENT for h in range(24)]
    ax.bar(range(24), hrs, color=cols)
    ax.set_xticks(range(0, 24, 3))
    ax.set_xticklabels([f"{(h - 1) % 12 + 1}{'am' if h < 12 else 'pm'}" for h in range(0, 24, 3)])
    ax.set_title(f"311 noise requests within {nz.get('radius_m')} m by hour ({nz.get('nearby_total')} total)",
                 loc="left", fontsize=11, color=INK)
    _style(ax)
    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)
    plt.close(fig)
    return out
