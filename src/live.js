// Client side of the live layer: profiles and online presence, pushed over SSE.
// Positions are never sent; each browser places people in their neighbourhood itself.
const CRED_KEY = 'hyderabad-connects.me';

export function loadCred() {
  try { const c = JSON.parse(localStorage.getItem(CRED_KEY)); return c && c.id && c.token ? c : null; } catch { return null; }
}
function storeCred(c) { try { if (c) localStorage.setItem(CRED_KEY, JSON.stringify(c)); else localStorage.removeItem(CRED_KEY); } catch { /* private mode */ } }

export class Live {
  constructor(on) { this.on = on; this.cred = loadCred(); this.es = null; this.connected = false; }
  connect() {
    if (this.es) this.es.close();
    const q = this.cred ? `?id=${encodeURIComponent(this.cred.id)}&token=${encodeURIComponent(this.cred.token)}` : '';
    const es = (this.es = new EventSource('/api/stream' + q));
    const json = (fn) => (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    es.addEventListener('hello', json((d) => { this.setConnected(true); this.on.hello(d.people); }));
    es.addEventListener('upsert', json((p) => this.on.upsert(p)));
    es.addEventListener('remove', json((d) => this.on.remove(d.id)));
    es.addEventListener('presence', json((d) => this.on.presence(d.id, d.online)));
    es.addEventListener('hi', json((d) => this.on.hi?.(d)));
    es.onerror = () => this.setConnected(false);
  }
  // the server remembers which profile this device registered (by cookie, shared by every
  // port on this host), so a lost or different browser storage still finds its profile
  async restore() {
    if (this.cred) return;
    try {
      const me = await fetch('/api/me', { cache: 'no-store' }).then((r) => r.json());
      if (me.id && me.token) { this.cred = { id: me.id, token: me.token }; storeCred(this.cred); }
    } catch { /* offline: carry on as a guest */ }
  }
  setConnected(v) { if (v !== this.connected) { this.connected = v; this.on.status?.(v); } }
  async save(profile) {
    const res = await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile, ...(this.cred || {}) }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not save. Is the server running?');
    const fresh = !this.cred || this.cred.id !== body.id;
    this.cred = { id: body.id, token: body.token }; storeCred(this.cred);
    if (fresh) this.connect(); // reconnect so the server counts us as online
    return body.person;
  }
  // only the character's look can change once registered
  async saveLook(look) {
    if (!this.cred) throw new Error('Register first.');
    const res = await fetch('/api/look', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ look, ...this.cred }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not save. Is the server running?');
    return body.person;
  }
  // "Say hi" to someone, and the hellos people have sent me
  async sayHi(to) {
    if (!this.cred) throw new Error('Register to say hi.');
    const res = await fetch('/api/hi', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, ...this.cred }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not say hi. Is the server running?');
    return body;
  }
  // { hellos: who said hi to me, sent: who I have already said hi to }
  async hellos(seen = false) {
    if (!this.cred) return { hellos: [], sent: [] };
    const res = await fetch('/api/hellos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seen, ...this.cred }) });
    return res.ok ? res.json() : { hellos: [], sent: [] };
  }
  // remove my profile for good; only forget my sign-in once the server has really removed it
  async leave() {
    if (!this.cred) return;
    const res = await fetch('/api/profile', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.cred) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not remove your profile. Is the server running?');
    this.cred = null; storeCred(null); this.connect();
  }
  forget() { this.cred = null; storeCred(null); }
}
