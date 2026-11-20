// Profile storage: one SQLite file (data/hyd.db), using Node's built-in SQLite
// (Node 22.13 or newer), so there is nothing extra to install or run.
//
//   people   one row per registered person (public profile as JSON, plus the
//            secret token that lets them edit it)
//   devices  which browser device registered which person; a device can hold at
//            most one profile, which is how "register once" is kept
//
// Older installs kept profiles in data/people.json; they are imported on first start.
import fs from 'node:fs';
import path from 'node:path';

// node:sqlite still prints an "experimental" notice on start; it is stable enough for this
const quiet = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : quiet.call(process, w, ...a));
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
process.emitWarning = quiet;

const DIR = path.resolve('data');
fs.mkdirSync(DIR, { recursive: true });
// one connection for the whole process, kept alive on purpose: node:sqlite closes a
// connection nothing references any more, which would finalise every prepared statement
const db = (globalThis.__hydDb ??= new DatabaseSync(path.join(DIR, 'hyd.db')));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS people (
    id         TEXT PRIMARY KEY,
    token      TEXT NOT NULL,
    profile    TEXT NOT NULL,          -- public profile, JSON
    linkedin   TEXT,                   -- normalised, for "already registered" checks
    x          TEXT,
    joined_at  INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS people_linkedin ON people(linkedin) WHERE linkedin IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS people_x ON people(x) WHERE x IS NOT NULL;
  CREATE TABLE IF NOT EXISTS devices (
    device     TEXT PRIMARY KEY,
    person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    linked_at  INTEGER NOT NULL
  );
`);

// a LinkedIn or X link reduced to who it points at, so different spellings match
export const keyOfLinkedIn = (u) => { const m = /linkedin\.com\/(in|company)\/([^/?#]+)/i.exec(u || ''); return m ? `${m[1]}/${decodeURIComponent(m[2])}`.toLowerCase() : null; };
export const keyOfX = (u) => { const m = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i.exec(u || ''); return m ? m[1].toLowerCase() : null; };

const q = {
  all: db.prepare('SELECT * FROM people'),
  get: db.prepare('SELECT * FROM people WHERE id = ?'),
  put: db.prepare(`INSERT INTO people (id, token, profile, linkedin, x, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET profile = excluded.profile, linkedin = excluded.linkedin, x = excluded.x, updated_at = excluded.updated_at`),
  del: db.prepare('DELETE FROM people WHERE id = ?'),
  byLinkedIn: db.prepare('SELECT id FROM people WHERE linkedin = ?'),
  byX: db.prepare('SELECT id FROM people WHERE x = ?'),
  ofDevice: db.prepare('SELECT p.* FROM devices d JOIN people p ON p.id = d.person_id WHERE d.device = ?'),
  link: db.prepare('INSERT INTO devices (device, person_id, linked_at) VALUES (?, ?, ?) ON CONFLICT(device) DO UPDATE SET person_id = excluded.person_id, linked_at = excluded.linked_at'),
};

const row2person = (r) => r && { ...JSON.parse(r.profile), id: r.id, token: r.token, joinedAt: r.joined_at, updatedAt: r.updated_at };

export const allPeople = () => q.all.all().map(row2person);
export const getPerson = (id) => row2person(q.get.get(id));
export const personOfDevice = (device) => (device ? row2person(q.ofDevice.get(device)) : null);
export const linkDevice = (device, id) => { if (device && id) q.link.run(device, id, Date.now()); };
export const deletePerson = (id) => { q.del.run(id); };

// who else already registered with this LinkedIn or X (null if nobody)
export function takenBy(links, exceptId) {
  const li = keyOfLinkedIn(links?.linkedin), x = keyOfX(links?.x);
  const a = li && q.byLinkedIn.get(li), b = x && q.byX.get(x);
  if (a && a.id !== exceptId) return 'LinkedIn';
  if (b && b.id !== exceptId) return 'X';
  return null;
}

export function savePerson({ id, token, joinedAt, updatedAt, ...profile }) {
  const now = Date.now();
  q.put.run(id, token, JSON.stringify(profile), keyOfLinkedIn(profile.links?.linkedin), keyOfX(profile.links?.x), joinedAt || now, now);
  return getPerson(id);
}

// one-time import of the old JSON store
const OLD = path.join(DIR, 'people.json');
if (fs.existsSync(OLD) && !q.all.all().length) {
  try {
    const old = JSON.parse(fs.readFileSync(OLD, 'utf8')).people || {};
    for (const p of Object.values(old)) { try { savePerson(p); } catch (e) { console.warn('could not import', p.id, e.message); } }
    fs.renameSync(OLD, OLD + '.imported');
    console.log(`Imported ${Object.keys(old).length} profile(s) from data/people.json into data/hyd.db`);
  } catch (e) { console.warn('people.json import failed:', e.message); }
}
