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
public/worker.js   SGP4 propagation of the whole catalog (1 Hz)
public/globe.js    orthographic globe with day/night terminator and orbit trails
public/wheel.js    natal-style sky wheel
public/report.js   the horoscope copy generator (deterministic per day)
public/astro.js    Sun/Moon positions, sidereal time, horizontal coordinates
```

CO—SAT is a parody. Satellites do not influence your life, except the ones that do.
