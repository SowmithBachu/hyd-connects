// Storage: one SQLite file, data/hyd.db, using Node's built-in SQLite (Node 22.13 or
// newer), so there is nothing extra to install or run.
//
// Laid out to be read by people as well as by the app (open it in "DB Browser for
// SQLite", or run `npm run db`). Times are Hyderabad time, written like
// "2026-11-20 21:59:12". Start with the three views, which show names instead of ids:
//
//   registered_people      everyone who registered, with their whole profile
//   who_said_hi_to_whom    every "Say hi", by name
//   activity_log           everything that happened, newest first, by name
//
// The tables underneath:
//
//   people        one row per registered person: their profile, one column per detail
//   characters    how each person's character looks
//   blocks        the neighbourhood blocks (id and name)
//   devices       which browser device registered which person (a device registers once)
//   hellos        who said hi to whom, when, and whether they have seen it (once per pair)
//   events        a log of every action: register, enter, look, hi, leave
//   sign_in_keys  the secret key each person's browser uses to prove it is them; never share
//
// Everything lives in hyd.db itself (no side files), so any SQLite viewer shows it all.
//
// Older versions of the file (one JSON column per profile) are converted on start, after
// a backup copy is saved next to it.
import fs from 'node:fs';
import path from 'node:path';
import { DISTRICTS } from '../src/geo.js';

// node:sqlite still prints an "experimental" notice on start; it is stable enough for this
const quiet = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : quiet.call(process, w, ...a));
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
process.emitWarning = quiet;

const DIR = path.resolve('data');
const FILE = path.join(DIR, 'hyd.db');
fs.mkdirSync(DIR, { recursive: true });
// one connection for the whole process, kept alive on purpose: node:sqlite closes a
// connection nothing references any more, which would finalise every prepared statement
const db = (globalThis.__hydDb ??= new DatabaseSync(FILE));

// ---- time: stored as Hyderabad time text, used by the app as milliseconds -------------
const IST = 5.5 * 3600_000;
export const istText = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 19).replace('T', ' ');
const istMs = (text) => (text ? Date.parse(text.replace(' ', 'T') + '+05:30') : 0);

// ---- what the app's values mean, written out ----------------------------------------
const STATUS_TEXT = { open: 'open to work', hiring: 'hiring' };
const STATUS_CODE = { 'open to work': 'open', hiring: 'hiring' };
const yes = (b) => (b ? 'yes' : 'no');

// a LinkedIn or X link in one standard spelling, so the same profile always matches
const cleanLinkedIn = (u) => { const m = /linkedin\.com\/(in|company)\/([^/?#]+)/i.exec(u || ''); return m ? `https://www.linkedin.com/${m[1]}/${m[2]}` : u || null; };
const cleanX = (u) => { const m = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i.exec(u || ''); return m ? `https://x.com/${m[1]}` : u || null; };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS blocks (
    id    TEXT PRIMARY KEY,           -- e.g. cyber
    name  TEXT NOT NULL               -- e.g. Cyber Towers Circle
  );
  CREATE TABLE IF NOT EXISTS people (
    id             TEXT PRIMARY KEY,  -- e.g. u-3898eb1b8feb
    name           TEXT NOT NULL,
    role           TEXT NOT NULL,
    company        TEXT,              -- company, or college for students
    student        TEXT NOT NULL DEFAULT 'no',   -- yes / no
    status         TEXT,              -- open to work / hiring / (empty)
    about          TEXT,              -- their one line about themselves
    skills         TEXT,              -- comma separated
    linkedin       TEXT,
    x              TEXT,
    website        TEXT,
    block          TEXT REFERENCES blocks(id),
    registered_at  TEXT NOT NULL,     -- Hyderabad time
    updated_at     TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS people_linkedin ON people(lower(linkedin)) WHERE linkedin IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS people_x ON people(lower(x)) WHERE x IS NOT NULL;
  CREATE TABLE IF NOT EXISTS characters (
    person_id      TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
    body           TEXT,              -- female / male
    hair           TEXT,
    hair_colour    TEXT,
    skin           TEXT,
    outfit         TEXT,              -- tee / hoodie / shirt / kurta
    top_colour     TEXT,
    bottom_colour  TEXT,
    shoes_colour   TEXT,
    accent_colour  TEXT,
    beard          TEXT NOT NULL DEFAULT 'no',
    changed_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sign_in_keys (
    person_id  TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
    secret     TEXT NOT NULL          -- proves a browser is this person; never share
  );
  CREATE TABLE IF NOT EXISTS devices (
    device     TEXT PRIMARY KEY,      -- a random id kept in that browser's cookie
    person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    linked_at  TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hellos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id   TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    to_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    said_at   TEXT NOT NULL,
    seen      TEXT NOT NULL DEFAULT 'no'   -- yes / no
  );
  CREATE INDEX IF NOT EXISTS hellos_to ON hellos(to_id, said_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS hellos_pair ON hellos(from_id, to_id);
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,         -- Hyderabad time
    event      TEXT NOT NULL,         -- register / enter / look / hi / leave
    person_id  TEXT NOT NULL,         -- who did it (kept even after they leave)
    person     TEXT,                  -- their name at the time
    other_id   TEXT,                  -- who it was done to (for hi)
    other      TEXT,                  -- that person's name at the time
    detail     TEXT
  );
  CREATE INDEX IF NOT EXISTS events_at ON events(at DESC);

  -- the easy way in: names instead of ids
  DROP VIEW IF EXISTS registered_people;
  CREATE VIEW registered_people AS
    SELECT p.name, p.role, p.company, p.student, p.status, b.name AS block, p.about, p.skills,
           p.linkedin, p.x, p.website, p.registered_at, p.updated_at, c.body AS character_body, c.outfit AS character_outfit, p.id
    FROM people p LEFT JOIN blocks b ON b.id = p.block LEFT JOIN characters c ON c.person_id = p.id
    ORDER BY p.registered_at;
  DROP VIEW IF EXISTS who_said_hi_to_whom;
  CREATE VIEW who_said_hi_to_whom AS
    SELECT f.name AS who_said_hi, t.name AS to_whom, h.said_at, h.seen
    FROM hellos h JOIN people f ON f.id = h.from_id JOIN people t ON t.id = h.to_id
    ORDER BY h.said_at DESC;
  DROP VIEW IF EXISTS activity_log;
  CREATE VIEW activity_log AS
    SELECT e.at, e.event, COALESCE(p.name, e.person) AS who, COALESCE(o.name, e.other) AS to_whom, e.detail
    FROM events e LEFT JOIN people p ON p.id = e.person_id LEFT JOIN people o ON o.id = e.other_id
    ORDER BY e.at DESC, e.id DESC;
`;

// ---- convert an older file (profile as one JSON column, times as numbers) -------------
function readOld() {
  const cols = db.prepare("SELECT name FROM pragma_table_info('people')").all().map((c) => c.name);
  if (!cols.includes('profile')) return null;
  // a copy of the old file first, just in case
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const backup = path.join(DIR, `hyd-before-readable-${istText().slice(0, 10)}.db`);
  if (!fs.existsSync(backup)) fs.copyFileSync(FILE, backup);
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const old = {
    people: db.prepare('SELECT * FROM people').all().map((r) => ({ ...JSON.parse(r.profile), id: r.id, token: r.token, joinedAt: r.joined_at, updatedAt: r.updated_at })),
    devices: has('devices') ? db.prepare('SELECT * FROM devices').all() : [],
    hellos: has('hellos') ? db.prepare('SELECT * FROM hellos ORDER BY id').all() : [],
    events: has('events') ? db.prepare('SELECT * FROM events ORDER BY id').all() : [],
  };
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    for (const t of ['hellos', 'events', 'devices', 'people']) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  return { old, backup };
}

const migrating = readOld();
// every change is written straight into hyd.db itself (no side "-wal" file), so the file on
// its own is always complete: any viewer, or a copy of just this file, sees everything
db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;');
db.exec(SCHEMA);
{ const put = db.prepare('INSERT INTO blocks (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'); for (const d of DISTRICTS) put.run(d.id, d.name); }

const PERSON = 'SELECT p.*, s.secret, c.body, c.hair, c.hair_colour, c.skin, c.outfit, c.top_colour, c.bottom_colour, c.shoes_colour, c.accent_colour, c.beard FROM people p LEFT JOIN sign_in_keys s ON s.person_id = p.id LEFT JOIN characters c ON c.person_id = p.id';
const q = {
  all: db.prepare(PERSON + ' ORDER BY p.registered_at'),
  get: db.prepare(PERSON + ' WHERE p.id = ?'),
  putPerson: db.prepare(`INSERT INTO people (id, name, role, company, student, status, about, skills, linkedin, x, website, block, registered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, company = excluded.company, student = excluded.student, status = excluded.status,
      about = excluded.about, skills = excluded.skills, linkedin = excluded.linkedin, x = excluded.x, website = excluded.website, block = excluded.block, updated_at = excluded.updated_at`),
  putLook: db.prepare(`INSERT INTO characters (person_id, body, hair, hair_colour, skin, outfit, top_colour, bottom_colour, shoes_colour, accent_colour, beard, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(person_id) DO UPDATE SET body = excluded.body, hair = excluded.hair, hair_colour = excluded.hair_colour, skin = excluded.skin, outfit = excluded.outfit,
      top_colour = excluded.top_colour, bottom_colour = excluded.bottom_colour, shoes_colour = excluded.shoes_colour, accent_colour = excluded.accent_colour,
      beard = excluded.beard, changed_at = excluded.changed_at`),
  putKey: db.prepare('INSERT INTO sign_in_keys (person_id, secret) VALUES (?, ?) ON CONFLICT(person_id) DO NOTHING'),
  del: db.prepare('DELETE FROM people WHERE id = ?'),
  byLinkedIn: db.prepare('SELECT id FROM people WHERE lower(linkedin) = lower(?)'),
  byX: db.prepare('SELECT id FROM people WHERE lower(x) = lower(?)'),
  ofDevice: db.prepare('SELECT person_id FROM devices WHERE device = ?'),
  link: db.prepare('INSERT INTO devices (device, person_id, linked_at) VALUES (?, ?, ?) ON CONFLICT(device) DO UPDATE SET person_id = excluded.person_id, linked_at = excluded.linked_at'),
  hiAdd: db.prepare('INSERT INTO hellos (from_id, to_id, said_at) VALUES (?, ?, ?)'),
  hiCopy: db.prepare('INSERT INTO hellos (from_id, to_id, said_at, seen) VALUES (?, ?, ?, ?)'),
  hiLast: db.prepare('SELECT said_at FROM hellos WHERE from_id = ? AND to_id = ?'),
  hiFor: db.prepare('SELECT id, from_id, said_at, seen FROM hellos WHERE to_id = ? ORDER BY said_at DESC, id DESC LIMIT 40'),
  hiSeen: db.prepare("UPDATE hellos SET seen = 'yes' WHERE to_id = ? AND seen = 'no'"),
  hiSent: db.prepare('SELECT to_id, said_at FROM hellos WHERE from_id = ?'),
  ev: db.prepare('INSERT INTO events (at, event, person_id, person, other_id, other, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  name: db.prepare('SELECT name FROM people WHERE id = ?'),
};

// a database row back into the shape the app uses
function rowToPerson(r) {
  if (!r) return null;
  const links = {};
  if (r.linkedin) links.linkedin = r.linkedin;
  if (r.x) links.x = r.x;
  if (r.website) links.site = r.website;
  const look = { body: r.body || undefined, hair: r.hair || 'short', hairColor: r.hair_colour || '#1c1717', skin: r.skin || '#c08a5c', outfit: r.outfit || 'tee',
    top: r.top_colour || '#2aa6b8', bottom: r.bottom_colour || '#2d3550', shoes: r.shoes_colour || undefined, accent: r.accent_colour || '#ffb81c', beard: r.beard === 'yes' };
  return {
    id: r.id, token: r.secret, name: r.name, role: r.role, company: r.company || '', student: r.student === 'yes',
    status: STATUS_CODE[r.status] || null, bio: r.about || '', skills: r.skills ? r.skills.split(',').map((s) => s.trim()).filter(Boolean) : [],
    links, link: '', area: r.block, look, joinedAt: istMs(r.registered_at), updatedAt: istMs(r.updated_at),
  };
}

export const allPeople = () => q.all.all().map(rowToPerson);
export const getPerson = (id) => rowToPerson(q.get.get(id));
export const personOfDevice = (device) => { const r = device && q.ofDevice.get(device); return r ? getPerson(r.person_id) : null; };
export const linkDevice = (device, id) => { if (device && id) q.link.run(device, id, istText()); };
export const deletePerson = (id) => { q.del.run(id); };

// who else already registered with this LinkedIn or X (null if nobody)
export function takenBy(links, exceptId) {
  const a = links?.linkedin && q.byLinkedIn.get(cleanLinkedIn(links.linkedin)), b = links?.x && q.byX.get(cleanX(links.x));
  if (a && a.id !== exceptId) return 'LinkedIn';
  if (b && b.id !== exceptId) return 'X';
  return null;
}

// write one person (profile, character and sign-in key) given in the app's shape
function writePerson({ id, token, joinedAt, updatedAt, look = {}, links = {}, ...p }, changed = istText()) {
  q.putPerson.run(id, p.name, p.role, p.company || null, yes(p.student), STATUS_TEXT[p.status] || null, p.bio || null,
    (p.skills || []).join(', ') || null, links.linkedin ? cleanLinkedIn(links.linkedin) : null, links.x ? cleanX(links.x) : null, links.site || p.link || null,
    p.area || null, joinedAt ? istText(joinedAt) : changed, updatedAt ? istText(updatedAt) : changed);
  q.putLook.run(id, look.body || null, look.hair || null, look.hairColor || null, look.skin || null, look.outfit || null, look.top || null,
    look.bottom || null, look.shoes || null, look.accent || null, yes(look.beard), changed);
  if (token) q.putKey.run(id, token);
}
export function savePerson(person) {
  db.exec('BEGIN');
  try { writePerson({ ...person, updatedAt: undefined }); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getPerson(person.id);
}

// "Say hi"
export const addHello = (from, to) => Number(q.hiAdd.run(from, to, istText()).lastInsertRowid);
export const lastHello = (from, to) => istMs(q.hiLast.get(from, to)?.said_at);
export const hellosFor = (to) => q.hiFor.all(to).map((r) => ({ id: r.id, from: r.from_id, at: istMs(r.said_at), seen: r.seen === 'yes' }));
export const markHellosSeen = (to) => { q.hiSeen.run(to); };
export const hellosSentBy = (from) => q.hiSent.all(from).map((r) => ({ to: r.to_id, at: istMs(r.said_at) }));

// the activity log: names are copied in too, so it still reads well after someone leaves
export function logEvent(event, personId, otherId = null, detail = null) {
  try {
    q.ev.run(istText(), event, personId, q.name.get(personId)?.name || detail?.name || null, otherId, otherId ? q.name.get(otherId)?.name || null : null,
      detail ? Object.entries(detail).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') : null);
  } catch (e) { console.warn('activity log:', e.message); }
}

// ---- bring older data across ----------------------------------------------------------
if (migrating) {
  const { old, backup } = migrating;
  db.exec('BEGIN');
  try {
    for (const p of old.people) writePerson(p, istText(p.updatedAt || Date.now()));
    const ids = new Set(old.people.map((p) => p.id)), nameOf = new Map(old.people.map((p) => [p.id, p.name]));
    for (const d of old.devices) if (ids.has(d.person_id)) q.link.run(d.device, d.person_id, istText(d.linked_at));
    const pairs = new Set();
    for (const h of old.hellos) {
      const k = h.from_id + '>' + h.to_id;
      if (pairs.has(k) || !ids.has(h.from_id) || !ids.has(h.to_id)) continue;
      pairs.add(k); q.hiCopy.run(h.from_id, h.to_id, istText(h.at), h.seen ? 'yes' : 'no');
    }
    for (const e of old.events) q.ev.run(istText(e.at), e.type, e.person_id, nameOf.get(e.person_id) || null, e.other_id, e.other_id ? nameOf.get(e.other_id) || null : null, e.detail || null);
    db.exec('COMMIT');
    console.log(`Database made readable: ${old.people.length} people, ${pairs.size} hellos, ${old.events.length} events moved across. The old file is saved as data/${path.basename(backup)}.`);
  } catch (e) { db.exec('ROLLBACK'); console.error(`Could not move the old data across; it is safe in data/${path.basename(backup)}`, e); }
}

// one-time import of the oldest store of all (data/people.json)
const OLD = path.join(DIR, 'people.json');
if (fs.existsSync(OLD) && !q.all.all().length) {
  try {
    const old = JSON.parse(fs.readFileSync(OLD, 'utf8')).people || {};
    for (const p of Object.values(old)) { try { savePerson(p); } catch (e) { console.warn('could not import', p.id, e.message); } }
    fs.renameSync(OLD, OLD + '.imported');
    console.log(`Imported ${Object.keys(old).length} profile(s) from data/people.json into data/hyd.db`);
  } catch (e) { console.warn('people.json import failed:', e.message); }
}
