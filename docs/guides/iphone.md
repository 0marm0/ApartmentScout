# ApartmentScout on your iPhone

The dashboard is an installable web app, so the phone in your pocket can be the tool you use on tour day: today's visits in order
with directions, a one-hand checklist at each home, a noise check that keeps one number, and your picks and notes saved on the
device. There is no App Store app and nothing to sign in to.

Needs: an iPhone with Safari (the steps below are Safari's; other iPhone browsers have their own *Add to Home Screen*).

## 1. Try it with the demo

Open <https://0marm0.github.io/ApartmentScout/demo/> in Safari. It is the dashboard on the worked example, a Manhattan
one-bedroom search from fall 2026. Tap a card to open a home, then **See inside** to stand in Unit 3D, and drag to look around.

## 2. Add it to your Home Screen

1. In Safari, tap the **Share** button (the square with an arrow, in the toolbar or at the top).
2. Scroll the sheet and tap **Add to Home Screen**.
3. Leave the name as **ApartmentScout**, keep **Open as Web App** switched on if your iPhone shows that option, then tap **Add**.

It now opens full screen like an app, with no browser bars, and the first time you use it the app saves what it needs so it keeps
working with no signal (a lift, a lobby, a basement flat). Open it once on Wi-Fi first.

What works offline: your shortlist, the map's saved data, each home's drawer, the 3D models and floor plans you have opened,
Tour day and its checklist. What needs a connection: the map's background tiles for areas you have not looked at, photos you have
not opened, and the turn-by-turn directions (they open in Apple Maps).

## 3. Tour day

On the day of a tour, a **Tour day** button appears on the main screen (or open it from the search box). It is built for one hand on a phone:

- **Route.** Today's tours in time order, each with its time, address, a **Directions** link that opens Apple Maps, and the
  minutes to the next stop. Reorder or add a stop.
- **A checklist at each home.** Light at the window (1 to 5) and which way it faces, noise with the windows shut and open, water
  pressure, signal, washer and dryer, closets, and the questions the score is unsure about, each with the reason it matters. Add a
  photo or a note.
- **Noise check.** **Measure 10 s** asks for the microphone only when you tap it, keeps one approximate number and throws the
  audio away. Nothing is recorded or uploaded. Compare homes with the same phone; it is not a calibrated meter.
- **After the visit.** *Finish this home* shows a summary of what you found and what differs from the listing, and the answers feed
  the home's flags and score.

The full description is in [the dashboard guide](dashboard.md#tour-day-the-phone).

## 4. Use it on your own search

The demo shows the example data. For your own search the phone needs your dashboard from a web address that starts with
`https://`: the offline copy and Add to Home Screen both depend on it. Two ways:

- **Host your own build.** Run `apartmentscout build` and put the output folder on any static host (GitHub Pages, Netlify,
  Cloudflare Pages, your own site). Then open that address in Safari and add it to the Home Screen as above. Read
  [the privacy note](#your-data-and-the-phone) first: a published page shows your listings and notes to anyone with the link.
- **Send yourself a read-only page.** `apartmentscout share --picks picks.json --out shortlist.html` makes a single HTML file of
  your saved picks. AirDrop it, or save it to Files and open it. It is a snapshot, not the full dashboard.

To move your saved picks between devices, use **Back up picks** and **Restore picks...** in the dashboard menu under *Data*.

## Your data and the phone

- Your picks, notes, visit answers and settings are saved **in the browser on that phone**, not on a server. Nothing is uploaded by
  ApartmentScout.
- Safari can clear a website's saved data after about a week without a visit. An app added to the Home Screen is kept, but make a
  backup (**Back up picks**) before tour day anyway.
- A hosted page is public to anyone with its address. For a private search, keep personal criteria, notes and photos out of what you
  publish, and run `python scripts/release_check.py` first.
- The microphone is used only for the noise check, and only after you tap **Measure 10 s**.

## If something is off

- *Add to Home Screen is missing.* Open the page in Safari itself (not inside another app's built-in browser).
- *It does not work offline.* Open it once on Wi-Fi, wait for the app to finish loading, and make sure the address starts with
  `https://`. A page opened as a local file or from `apartmentscout serve` never installs the offline copy.
- *It shows an old version.* The app says **A new version is ready**; tap **Reload**. Or close it from the app switcher and open it
  again.
- *The page stopped at start-up.* A card offers **Reload**, and **Reset this browser's settings (keeps your saved picks)**.
