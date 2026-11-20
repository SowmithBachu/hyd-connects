// Live profiles for Hyderabad Connect.
//
// Stores each signed-in visitor's public profile and pushes changes to every open
// browser over Server-Sent Events. Only profile data and online presence are
// shared: nobody's position or movement is synced.
//
// Sign-in is a placeholder: the first save returns a random token that the
// browser keeps and sends back to edit or remove its own profile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DISTRICTS } from '../src/geo.js';

const FILE = path.resolve('data/people.json');
const AREAS = new Set(DISTRICTS.map((d) => d.id));
const HAIR = new Set(['short', 'side', 'bun', 'long', 'curly', 'spiky', 'cap']);
const OUTFIT = new Set(['tee', 'hoodie', 'shirt', 'kurta', 'suit']);

let people = {};
try { people = JSON.parse(fs.readFileSync(FILE, 'utf8')).people || {}; } catch { people = {}; }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ people }, null, 2));
    fs.renameSync(tmp, FILE);
  }, 150);
}

const clients = new Set();
const online = new Map(); // person id -> open connections

const view = (p) => { const { token, ...rest } = p; return { ...rest, online: online.has(p.id) }; };
const list = () => Object.values(people).map(view);
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '');
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
function clean(input) {
  const p = input && typeof input === 'object' ? input : {};
  const name = str(p.name, 48), role = str(p.role, 48);
  if (name.length < 2) throw new Error('Name must be at least 2 characters.');
  if (role.length < 2) throw new Error('Role must be at least 2 characters.');
  if (!AREAS.has(p.area)) throw new Error('Pick a neighbourhood.');
  const link = str(p.link, 200);
  if (link && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(link)) throw new Error('Link must start with http:// or https://');
  // social links, each checked against the site it claims to be
  const L = p.links && typeof p.links === 'object' ? p.links : {};
  const links = {};
  const check = (key, re, msg) => { const v = str(L[key], 200); if (!v) return; if (!re.test(v)) throw new Error(msg); links[key] = v; };
  check('linkedin', /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/[^\s]+$/i, 'LinkedIn link should look like https://www.linkedin.com/in/your-name');
  check('x', /^https:\/\/(www\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?$/i, 'X link should look like https://x.com/yourhandle');
  check('site', /^https?:\/\/[^\s]+\.[^\s]+$/i, 'Website must start with https://');
  const l = p.look && typeof p.look === 'object' ? p.look : {};
  return {
    name, role, student: !!p.student, company: str(p.company, 48), area: p.area,
    status: p.status === 'open' || p.status === 'hiring' ? p.status : null,
    bio: str(p.bio, 140),
    skills: (Array.isArray(p.skills) ? p.skills : []).map((s) => str(s, 24)).filter(Boolean).slice(0, 6),
    link, links,
    look: {
      top: hex(l.top, '#2aa6b8'), bottom: hex(l.bottom, '#2d3550'), skin: hex(l.skin, '#c08a5c'), hairColor: hex(l.hairColor, '#1c1717'),
      hair: HAIR.has(l.hair) ? l.hair : 'short', glasses: !!l.glasses, headphones: !!l.headphones, backpack: !!l.backpack,
      outfit: OUTFIT.has(l.outfit) ? l.outfit : 'tee', legs: l.legs === 'shorts' ? 'shorts' : 'pants', accent: hex(l.accent, '#ffb81c'), beard: !!l.beard, lanyard: !!l.lanyard,
    },
  };
}

const writes = new Map(); // ip -> recent write timestamps
function limited(ip) {
  const now = Date.now(), recent = (writes.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now); writes.set(ip, recent);
  return recent.length > 20;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, data = '';
    req.on('data', (c) => { size += c.length; if (size > 16_384) { reject(new Error('Too large')); req.destroy(); } else data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const owns = (id, token) => typeof id === 'string' && typeof token === 'string' && people[id] &&
  people[id].token.length === token.length && crypto.timingSafeEqual(Buffer.from(people[id].token), Buffer.from(token));

export async function apiMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/api/')) return next();
  try {
    if (req.method === 'GET' && url.pathname === '/api/people') return send(res, 200, { people: list() });

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ people: list() })}\n\n`);
      clients.add(res);
      const id = url.searchParams.get('id'), mine = owns(id, url.searchParams.get('token'));
      if (mine) {
        online.set(id, (online.get(id) || 0) + 1);
        if (online.get(id) === 1) broadcast('presence', { id, online: true });
      }
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping); clients.delete(res);
        if (mine && people[id]) {
          const n = (online.get(id) || 1) - 1;
          if (n <= 0) { online.delete(id); broadcast('presence', { id, online: false }); } else online.set(id, n);
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/profile') {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'Too many changes. Try again in a minute.' });
      const body = await readBody(req);
      const profile = clean(body.profile);
      let { id, token } = body;
      if (!owns(id, token)) { id = 'u-' + crypto.randomBytes(6).toString('hex'); token = crypto.randomBytes(24).toString('hex'); }
      people[id] = { id, token, ...profile, joinedAt: people[id]?.joinedAt || Date.now(), updatedAt: Date.now() };
      persist();
      broadcast('upsert', view(people[id]));
      return send(res, 200, { id, token, person: view(people[id]) });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/profile') {
      const { id, token } = await readBody(req);
      if (!owns(id, token)) return send(res, 403, { error: 'Not your profile.' });
      delete people[id]; online.delete(id); persist();
      broadcast('remove', { id });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, 400, { error: e.message || 'Bad request' });
  }
}
