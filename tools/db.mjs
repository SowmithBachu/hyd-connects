// Print what is in the database (data/hyd.db), read-only, by name, and without anyone's
// secret sign-in key. Run it with:  npm run db        (or: node tools/db.mjs [events])
// Safe to run while the server is running.
import path from 'node:path';
import fs from 'node:fs';

const quiet = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : quiet.call(process, w, ...a));
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
process.emitWarning = quiet;

const FILE = path.resolve('data/hyd.db');
if (!fs.existsSync(FILE)) { console.log(`No database yet at ${FILE}. Start the server and register someone first.`); process.exit(0); }
const db = new DatabaseSync(FILE, { readOnly: true });
const has = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name);
if (!has('registered_people')) { console.log('This database is in the old layout. Start the server once (npm run dev or npm start) to make it readable, then run this again.'); process.exit(0); }
const LIMIT = Number(process.argv[2]) || 30;
const tidy = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])));

console.log(`\nDatabase: ${FILE}   (all times are Hyderabad time)\n`);

const people = db.prepare('SELECT name, role, company, student, status, block, registered_at, linkedin, x, website FROM registered_people').all();
console.log(`REGISTERED PEOPLE (${people.length})`);
console.table(tidy(people));
for (const p of db.prepare('SELECT name, about, skills, character_body, character_outfit, id FROM registered_people').all()) {
  console.log(`  ${p.name} (${p.id})  about: ${p.about || '-'}  |  skills: ${p.skills || '-'}  |  character: ${[p.character_body, p.character_outfit].filter(Boolean).join(', ') || '-'}`);
}

const hellos = db.prepare('SELECT * FROM who_said_hi_to_whom').all();
console.log(`\nWHO SAID HI TO WHOM (${hellos.length})`);
console.table(tidy(hellos));

const total = db.prepare('SELECT count(*) AS n FROM activity_log').get().n;
console.log(`\nACTIVITY LOG (latest ${Math.min(LIMIT, total)} of ${total}): register, enter, look, hi, leave`);
console.table(tidy(db.prepare('SELECT * FROM activity_log LIMIT ?').all(LIMIT)));
console.log('\nTo browse it in a window: open data/hyd.db in "DB Browser for SQLite" (sqlitebrowser.org)');
console.log('and look at the views registered_people, who_said_hi_to_whom and activity_log first.\n');
