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
browser's local storage is cleared. A device registers once: registering again from it
updates the same profile, and a LinkedIn or X profile can belong to only one person.
There is no password login yet; a person on a new device or browser is a new visitor.
`data/` is git-ignored: back up `data/hyd.db` to keep people's profiles.

Every visit opens on a landing page with **Enter the City** and **Register**.
Anyone can walk in and roam the whole city as a guest. Meeting people needs an
account: a guest who presses E near someone sees their name and role and a
**Register** button, but not their profile, links or the guide.

**Register** (from the landing page, the dock, L, or someone's card) is five short
steps: who you are (name, role, and company, or Student with an optional college;
plus an optional one-line description); what you do (skills, open to work / hiring);
your block; your links (LinkedIn, X or a website, all optional); your character.
Only name, role and company (or Student) are required. Everyone enters at Cyber Towers Circle, the main
junction (your character stands in your block for others); finishing from inside the city keeps you where you were and opens
the card of the person you wanted to meet. A returning visitor gets **Enter the
City** straight away, or **Edit my profile**. The flow lives in `src/onboarding.js`; an unfinished registration is
kept in the browser so a reload doesn't lose it.

Only people who have registered appear in the city; there are no built-in or
sample profiles. For local testing only, open `http://localhost:5173/?demo` on
the dev server to load 42 made-up profiles from `src/dev/samples.js`. That file
is never included in a production build. The unnamed pedestrians on the
footpaths are background ambience, not profiles.

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
- **Guide me**: from anyone's profile card, a saffron beacon and an on-screen arrow
  lead you to them on foot (G cancels). "Jump there" still teleports.
- **Kites and lanterns**: Sankranti kites over the rooftops by day, glowing sky
  lanterns after dark.
