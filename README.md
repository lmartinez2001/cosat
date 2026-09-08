# CO—SAT

*Hyper-personalized astrology, finally based on something we actually put up there.*

A parody of astrology apps (Co–Star and friends) that replaces planets with the
~13,000 satellites CelesTrak tracks: Starlink, OneWeb, GPS/Galileo/GLONASS/BeiDou,
weather satellites, the ISS, geostationary TV birds, this month's launches, and so on.
Give it your birth date and where you are, and it produces a live chart:

- **Big three** — the satellite nearest the Sun, the one nearest the Moon, and the one
  rising over your horizon right now (it changes every minute; this is normal).
- **A natal wheel** — your sky as a twelve-house chart, zenith in the centre, with
  aspects (conjunction, trine, square…) between the big three, the Sun and the Moon.
- **Nine life categories**, each ruled by a constellation, tagged *Power / Pressure /
  Trouble* from how crowded your sky is compared with a typical sky at your latitude.
- **The day you were born** — real objects launched on (or nearest) your birthday,
  from the SATCAT, with owner, launch site and whether they are still up there.
- **Transits** — what is rising and setting over you in the next minutes.
- **Reality check** — the propagated ISS position vs. independent live telemetry.

## The three rituals

Beyond the chart, the app asks you to do something no horoscope can ask: go and check.

**Go outside.** Your *guardian* is a real object still in orbit, chosen for being launched as
close to your birthday as possible and low enough to actually watch (geostationary satellites
never rise or set, so they make a poor appointment). The app finds its next genuinely visible
pass: the satellite must be in sunlight while you are in darkness, which is why satellites are
seen after dusk and before dawn and never at midnight. You get the minute, the compass bearing,
the peak elevation, a live countdown and a drawing of the arc it will trace. Then:

- **Put it in my calendar** downloads a real calendar file with the next five passes and a
  ten-minute alarm on each, so the app lives in your calendar instead of competing for attention.
- **Point my phone at it** uses the orientation sensors to work out where the back of the phone
  is aimed and tells you how many degrees off you are, logging the sighting when you land on it.
- **I saw it** keeps a logbook: confirmations, distinct satellites seen, and a night streak.

**Memento mori.** Everything in low orbit is falling. Each build records where every orbit was
when it was first seen, and ships that baseline inside the catalogue the browser already
downloads, so the decay is measured from real successive element sets rather than modelled. The
page shows the current altitude, the sink rate, and an estimated time until it meets the
atmosphere. It refuses to print a lifetime the data cannot support: a satellite holding station
with thrusters is reported as *held*, not given a fake century. Your natal object, usually long
since burned up, gets a memorial with its real re-entry date.

**Compatibility.** Two birthdays, two real satellites, five axes computed from catalogue values:
the ratio of their orbital periods and how often they realign, the true angle between their
orbital planes, the altitudes they live at, whether the same programme launched them, and whether
either is still up there. When both are still in orbit it also reports the closest the two
actually come to each other over the next three days. Results are shareable by link.

## Shorts

`feed.html` is a vertical, snap-scrolling **video** feed in the style of Shorts / Reels: full-screen
on phones, a phone-shaped column with ↑↓ keys on desktop, muted autoplay, tap for sound. Every card
is a real, already-published clip **shorter than 30 seconds**, embedded or streamed from where it
lives, never downloaded or copied:

- **YouTube**: clips about UFOs, UAP and satellite conspiracies (Black Knight, Project Blue Beam,
  Starlink sightings, Pentagon footage, Roswell, Phoenix Lights…), played through the official
  embedded player from youtube.com. Videos whose uploader disabled embedding are skipped.
- **Wikimedia Commons**: short video files, including the official US government UAP releases,
  streamed from upload.wikimedia.org with a Safari-friendly MP4 transcode where available.

The Internet Archive is no longer a source: its UFO holdings are feature-length films, so nothing
there fits the format.

**How the 30-second rule is enforced**, in three places:

1. `lib/videos.js` searches YouTube server-side (browsers cannot, without an API key) and resolves
   an **exact** duration for every candidate: from the `0:24`-style label when the search page shows
   one, otherwise by reading `lengthSeconds` from the video's own watch page. Results are kept in a
   duration cache that survives across runs, so an id is never checked twice and the pool grows each
   time. Only clips under 30 s are published to `data/videos.json`.
2. The Commons query keeps only files whose API-reported duration is under 30 s.
3. In the browser, the player itself reports the true duration; anything that comes back at 30 s or
   over is dropped from the feed and replaced, as is anything that fails to play.

Each card links to its source and carries a mini radar plus a live line about what is really above
your head at that moment, computed from the same orbital elements as the main page. Only the current
card and its neighbours hold a player; the rest are torn down as you scroll.

## Failure policy

Nothing in this app substitutes a plausible value for a missing one. If a request fails,
the page says which request failed and why, and shows nothing in its place:

- a failed launch-record lookup never renders as "nothing was launched on your birthday";
- a failed pass search never renders as "no pass in the next ten days";
- a compatibility score is not shown at all unless both satellites were actually found;
- the Shorts feed names the sources that are unavailable instead of ending in silence;
- the prediction worker has a timeout, so a dead worker reports an error rather than
  leaving a spinner forever;
- a missing value in a template renders as a visible marker and logs to the console,
  because it means a bug rather than a fact.

## Cache and versioning

GitHub Pages serves every file with a ten-minute cache and no version marker, which is
enough for a phone to keep an old copy of the JavaScript indefinitely, with module
imports and workers resolving straight back to those stale URLs. The build therefore
copies `public/` into `dist/` and stamps every local reference with a hash of the site
contents: stylesheets, module imports, worker scripts, vendored libraries and data files.
The published build id is visible at the bottom of the Chart view under Data & methodology,
so it is easy to confirm which version a device is actually running.

## Run

```bash
npm start
```

Then open <http://localhost:4321>. No dependencies; Node ≥ 18.

## Data, and how it is pulled politely

Everything is real and (as far as orbital elements go) real-time:

| Source | What | How often we ask |
|---|---|---|
| CelesTrak GP data (`gp.php?GROUP=…&FORMAT=json`), 17 groups | Orbital elements | at most once per group every 3 h |
| CelesTrak SATCAT (`satcat.csv`) | Launch dates, owners, decay dates | once every 24 h |
| wheretheiss.at | Independent ISS telemetry | at most once per 30 s, only while a report is open |

The browser never talks to those services. A single caching server (`server.js`,
`lib/celestrak.js`) does, and it:

- caches every response on disk (`data/cache/`) so restarts cost nothing upstream;
- refreshes only stale groups, sequentially, with 2.5 s between requests — never bursts;
- keeps serving the stale copy and backs off exponentially (30 min → 12 h) on any error,
  including 403/429;
- identifies itself with a User-Agent and accepts gzip;
- serves the merged catalog gzipped with an ETag and `max-age` matched to the next
  refresh, so page reloads are 304s.

Satellite positions are then computed **on your device**, every second, for all
objects, with SGP4 (`satellite.js`) in a Web Worker — there is no position polling at
all. The "Data & methodology" panel at the bottom of the page shows the live cache
state per group.

## Layout

```
server.js          HTTP server + JSON API (/api/catalog, /api/status, /api/natal, /api/iss)
lib/celestrak.js   polite cached upstream client
lib/satcat.js      SATCAT parser and natal lookup
lib/groups.js      which CelesTrak groups we track, and which "house" each rules
public/app.js      orchestration, live analysis, DOM
public/features.js the three rituals: passes, decay, compatibility
public/predict.js  worker: visible-pass search, close approaches, plane geometry
lib/history.js     per-object orbital baselines, so decay is measured not guessed
public/worker.js   SGP4 propagation of the whole catalog (1 Hz)
public/globe.js    orthographic globe with day/night terminator and orbit trails
public/wheel.js    natal-style sky wheel
public/report.js   the horoscope copy generator (deterministic per day)
public/astro.js    Sun/Moon positions, sidereal time, horizontal coordinates
```

CO—SAT is a parody. Satellites do not influence your life, except the ones that do.
