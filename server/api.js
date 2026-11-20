// Live profiles for Hyderabad Connects.
//
// Stores each signed-in visitor's public profile and pushes changes to every open
// browser over Server-Sent Events. Only profile data and online presence are
// shared: nobody's position or movement is synced.
//
// Profiles live in SQLite (server/db.js). Who is who:
//  - registering returns a random token the browser keeps to edit or remove its profile;
//  - the server also gives each browser a long-lived device cookie and remembers which
//    profile that device registered. Cookies are shared by every port on a host, so the
//    dev server, `npm start` and a restarted server all recognise a returning device;
//  - a device registers once, and a profile is final once made (it cannot be edited);
//    a LinkedIn or X profile can only belong to one person.
import crypto from 'node:crypto';
import { DISTRICTS } from '../src/geo.js';
import { allPeople, getPerson, personOfDevice, linkDevice, savePerson, deletePerson, takenBy, addHello, lastHello, hellosFor, markHellosSeen, hellosSentBy, logEvent } from './db.js';

const AREAS = new Set(DISTRICTS.map((d) => d.id));
const HAIR = new Set(['short', 'side', 'bun', 'long', 'curly', 'spiky', 'cap']);
const OUTFIT = new Set(['tee', 'hoodie', 'shirt', 'kurta', 'suit']);

const clients = new Set();
const online = new Map(); // person id -> open connections
const streams = new Map(); // person id -> their open live streams (for messages meant only for them)
function sendTo(id, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of streams.get(id) || []) c.write(msg);
}

const view = (p) => { const { token, ...rest } = p; return { ...rest, online: online.has(p.id) }; };
const list = () => allPeople().map(view);
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
  if (str(p.company, 48).length < 2) throw new Error(p.student ? 'Add your college or university.' : 'Add your company.');
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
  return {
    name, role, student: !!p.student, company: str(p.company, 48), area: p.area,
    status: p.status === 'open' || p.status === 'hiring' ? p.status : null,
    bio: str(p.bio, 140),
    skills: (Array.isArray(p.skills) ? p.skills : []).map((s) => str(s, 24)).filter(Boolean).slice(0, 6),
    link, links,
    look: cleanLook(p.look),
  };
}
// the character's look: the only part of a profile that can change after registering
function cleanLook(input) {
  const l = input && typeof input === 'object' ? input : {};
  return {
    body: l.body === 'female' || l.body === 'male' ? l.body : undefined,
    top: hex(l.top, '#2aa6b8'), bottom: hex(l.bottom, '#2d3550'), skin: hex(l.skin, '#c08a5c'), hairColor: hex(l.hairColor, '#1c1717'),
    shoes: typeof l.shoes === 'string' && /^#[0-9a-f]{6}$/i.test(l.shoes) ? l.shoes : undefined,
    hair: HAIR.has(l.hair) ? l.hair : 'short', glasses: !!l.glasses, headphones: !!l.headphones, backpack: !!l.backpack,
    outfit: OUTFIT.has(l.outfit) ? l.outfit : 'tee', legs: l.legs === 'shorts' ? 'shorts' : 'pants', accent: hex(l.accent, '#ffb81c'), beard: !!l.beard, lanyard: !!l.lanyard,
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
function owns(id, token) {
  if (typeof id !== 'string' || typeof token !== 'string') return false;
  const p = getPerson(id);
  return !!p && p.token.length === token.length && crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(token));
}

// this browser's device id, from its cookie (set on its first API request)
const DEVICE = 'hc_device';
function deviceOf(req, res) {
  const m = /(?:^|;\s*)hc_device=([A-Za-z0-9_-]{16,64})/.exec(req.headers.cookie || '');
  if (m) return m[1];
  const id = crypto.randomBytes(18).toString('base64url');
  const https = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('set-cookie', `${DEVICE}=${id}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`);
  return id;
}

export async function apiMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/api/')) return next();
  try {
    const device = deviceOf(req, res);
    if (req.method === 'GET' && url.pathname === '/api/people') return send(res, 200, { people: list() });

    // a returning device gets its sign-in back, whatever port or browser storage it lost
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const p = personOfDevice(device);
      return send(res, 200, p ? { id: p.id, token: p.token } : {});
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ people: list() })}\n\n`);
      clients.add(res);
      const id = url.searchParams.get('id'), mine = owns(id, url.searchParams.get('token'));
      if (mine) { linkDevice(device, id); logEvent('enter', id); } // (profiles made before device cookies get linked here)
      if (mine) {
        if (!streams.has(id)) streams.set(id, new Set());
        streams.get(id).add(res);
        online.set(id, (online.get(id) || 0) + 1);
        if (online.get(id) === 1) broadcast('presence', { id, online: true });
      }
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { try {
        clearInterval(ping); clients.delete(res);
        if (mine) { streams.get(id)?.delete(res); if (!streams.get(id)?.size) streams.delete(id); }
        if (mine && getPerson(id)) {
          const n = (online.get(id) || 1) - 1;
          if (n <= 0) { online.delete(id); broadcast('presence', { id, online: false }); } else online.set(id, n);
        }
      } catch (e) { console.error('stream close:', e.message); } }); // a slip here must never take the server down
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/profile') {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'Too many changes. Try again in a minute.' });
      const body = await readBody(req);
      const profile = clean(body.profile);
      // profiles are final: registering creates one, and nothing can change it afterwards
      if (owns(body.id, body.token) || personOfDevice(device)) return send(res, 409, { error: 'You have already registered on this device, and profiles cannot be changed once made.' });
      const id = 'u-' + crypto.randomBytes(6).toString('hex'), token = crypto.randomBytes(24).toString('hex');
      const clash = takenBy(profile.links, id);
      if (clash) return send(res, 409, { error: `That ${clash} profile is already registered. If it is yours, open the city on the device you registered with.` });
      const person = savePerson({ id, token, ...profile, joinedAt: getPerson(id)?.joinedAt });
      linkDevice(device, id);
      logEvent('register', id, null, { name: person.name, role: person.role, company: person.company });
      broadcast('upsert', view(person));
      return send(res, 200, { id, token, person: view(person) });
    }

    // "Say hi": tell someone you said hi; they get it live, and in their bell list later
    if (req.method === 'POST' && url.pathname === '/api/hi') {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'Too many hellos. Try again in a minute.' });
      const body = await readBody(req);
      if (!owns(body.id, body.token)) return send(res, 403, { error: 'Register to say hi.' });
      if (typeof body.to !== 'string' || body.to === body.id || !getPerson(body.to)) return send(res, 404, { error: 'That person is not on the map any more.' });
      // once is enough: a hello to someone is remembered for good, so saying it again does nothing
      const before = lastHello(body.id, body.to);
      if (before) return send(res, 200, { ok: true, already: true, at: before });
      const hi = { id: addHello(body.id, body.to), from: body.id, at: Date.now(), seen: false };
      logEvent('hi', body.id, body.to);
      sendTo(body.to, 'hi', hi);
      return send(res, 200, { ok: true });
    }
    // my hellos (newest first), and marking them seen when I open the bell
    if (url.pathname === '/api/hellos') {
      const body = req.method === 'POST' ? await readBody(req) : { id: url.searchParams.get('id'), token: url.searchParams.get('token') };
      if (!owns(body.id, body.token)) return send(res, 403, { error: 'Not yours.' });
      if (req.method === 'POST' && body.seen) markHellosSeen(body.id);
      return send(res, 200, { hellos: hellosFor(body.id), sent: hellosSentBy(body.id) });
    }

    // change my character's look (profile details stay as registered)
    if (req.method === 'POST' && url.pathname === '/api/look') {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: 'Too many changes. Try again in a minute.' });
      const body = await readBody(req);
      if (!owns(body.id, body.token)) return send(res, 403, { error: 'Not your character.' });
      const person = savePerson({ ...getPerson(body.id), look: cleanLook(body.look) });
      logEvent('look', body.id);
      broadcast('upsert', view(person));
      return send(res, 200, { person: view(person) });
    }

    if (req.method === 'DELETE' && url.pathname === '/api/profile') {
      const { id, token } = await readBody(req);
      if (!owns(id, token)) return send(res, 403, { error: 'Not your profile.' });
      logEvent('leave', id, null, { name: getPerson(id)?.name });
      deletePerson(id); online.delete(id);
      broadcast('remove', { id });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (res.headersSent) { console.error('api:', e); return res.end(); } // e.g. a live stream that already started
    if (!/^(Name|Role|Pick|Link|LinkedIn|X link|Website|Too large|Bad JSON|Add)/.test(e.message || '')) console.error('api:', e);
    return send(res, 400, { error: e.message || 'Bad request' });
  }
}
