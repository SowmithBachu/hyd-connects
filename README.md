# Hyderabad Connect

A walkable, stylised 3D slice of Madhapur & HITEC City, Hyderabad, where people
stand in their own block with an "Open to work" or "Hiring" tag. Seven blocks:
Cyber Towers Circle, Hitech City Metro, 100 Feet Road, Ayyappa Society,
Durgam Cheruvu Lakefront, Shilparamam and Kavuri Hills.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — site and live API together
```

Production: `npm run build` then `npm start` (serves `dist/` and the API on port 8787).

## Live profiles

`server/api.js` stores profiles in a SQLite database, `data/hyd.db` (Node's built-in
SQLite, so Node 22.13 or newer and nothing to install; see `server/db.js`), and pushes
changes to every open browser over Server-Sent Events. Only profile details and
online/offline presence are shared; nobody's position is synced.

Each browser gets a long-lived device cookie, and the server remembers which profile
that device registered. Cookies are shared by every port on a host, so a returning
visitor is recognised on the dev server, on `npm start`, after a restart, or after the
browser's local storage is cleared. A device registers once, a profile is final once made
(it cannot be edited), and a LinkedIn or X profile can belong to only one person.
There is no password login yet; a person on a new device or browser is a new visitor.
`data/` is git-ignored: back up `data/hyd.db` to keep people's profiles.

Every visit opens on a static landing page (a still of the city, `public/landing/`):
the name, Walk · Meet · Find, one line, and one button, **Enter the City**. Nothing 3D is
drawn while it shows.
Anyone can walk in and roam the whole city as a guest. Meeting people needs an
account: a guest who presses E near someone sees their name and role and a
**Register** button, but not their profile or links, and cannot say hi.

**Register** (from the dock, L, or someone's card) is four short steps: who you are
(name, role, and company, or Student with their college, plus an optional one-line
description); what you do (skills, open to work / hiring); your links (LinkedIn, X or a
website, all optional); and **Edit your character**: woman or man, a starting look, then
hair, top, bottom, shoes and skin, with tiles drawn from the real characters and a live
3D preview that turns as you choose. Inside the city, the **Character** button in the dock (or C,
or the menu) opens the same editor any time; your details stay as registered. Name, role and company (or college, for
students) are required and marked in red. Everyone enters at Cyber Towers Circle, the main
junction (your character stands in your block for others); finishing from inside the city keeps you where you were and opens
the card of the person you wanted to meet. A returning visitor enters as themselves. Profiles
are final: L or the Profile button shows yours, read-only. **Remove my profile** at the
bottom of that window (after a confirm) deletes the profile, character and hellos; the
same browser can register again afterwards. The flow lives in `src/onboarding.js`; an unfinished registration is
kept in the browser so a reload doesn't lose it.

Only people who have registered appear in the city; there are no built-in or
sample profiles. For local testing only, open `http://localhost:5173/?demo` on
the dev server to load 42 made-up profiles from `src/dev/samples.js`. That file
is never included in a production build. The unnamed pedestrians on the
footpaths are background ambience, not profiles.

## Say hi

Registered people can **Say hi 👋** from anyone's card (walk up and press E). The other
person gets it live as a pop-up, and a bell by the clock (top right) shows a red count of
new hellos. The bell's list shows who said hi, with their role and company; tap one to
open their card, or **Say hi back**. Hellos are stored in `data/hyd.db` (the `hellos`
table), sent only to that person's open browsers. You say hi to someone once: it is
remembered, so their card shows **Hi sent ✓** from then on, even after a restart.

## Where the data is

Everything is in one SQLite file: **`data/hyd.db`** in the project folder. Every change is
written straight into it (no side files), so the file on its own is always complete.

Times are Hyderabad time, written like `2026-11-20 21:59:12`. Start with the three
**views**, which show names instead of ids:

| View | What it shows |
| --- | --- |
| `registered_people` | everyone who registered: name, role, company or college, student, status, block, about, skills, links, when they registered |
| `who_said_hi_to_whom` | every Say hi, by name, with when and whether it was seen |
| `activity_log` | everything that happened, newest first: register, enter, look, hi, leave |

The tables underneath:

| Table | What it holds |
| --- | --- |
| `people` | one row per person, one column per profile detail |
| `characters` | how each person's character looks (body, hair, outfit, colours) |
| `blocks` | the neighbourhood blocks (id and name) |
| `devices` | which browser device registered which person |
| `hellos` | who said hi to whom (one per pair) |
| `events` | the activity log (names are copied in, so it reads well after someone leaves) |
| `sign_in_keys` | the secret key each person's browser uses; never share it |

To look at it:

- `npm run db` prints the people, who said hi to whom and the latest activity, by name,
  never showing sign-in keys. `node tools/db.mjs 100` shows the latest 100 events.
- Or open `data/hyd.db` in **DB Browser for SQLite** (free, sqlitebrowser.org) or the VS
  Code **SQLite Viewer** extension, and open the views first. Both work while the server runs.

`data/` is not in git. Back up `data/hyd.db` to keep everyone's profiles.

## Characters

Rigged glTF characters built from Quaternius' Universal Base Characters and
Universal Animation Library (CC0, see `public/characters/CREDITS.txt`). The raw
packs go in `assets/source/` (git-ignored); `python tools/characters/atlas.py`
and `node tools/characters/build.mjs` rebuild `public/characters/`.

## Things to do in the city

- **Walk and look**: W A S D, Shift to run. Click once to capture the mouse for
  game-style looking (raw mouse input, no acceleration); Esc frees it. The wheel
  moves the over-the-shoulder camera closer or further. Mouse speed and invert-Y
  are in the pause menu.
- **Real time of day**: the city follows the clock in Hyderabad (IST): morning,
  afternoon, evening and night, with lit windows and street lamps after dark.
- **Photo mode** (P): the HUD steps aside; pick a look (Natural, Golden, Cool,
  Noir, Film) and press Space to save a PNG.
- **Kites and lanterns**: Sankranti kites over the rooftops by day, glowing sky
  lanterns after dark.
