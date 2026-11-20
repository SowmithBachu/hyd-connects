// Client side of the live layer: profiles and online presence, pushed over SSE.
// Positions are never sent; each browser places people in their neighbourhood itself.
const CRED_KEY = 'deccan-commons.me';

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
    es.onerror = () => this.setConnected(false);
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
  async leave() {
    if (!this.cred) return;
    await fetch('/api/profile', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.cred) }).catch(() => {});
    this.cred = null; storeCred(null); this.connect();
  }
  forget() { this.cred = null; storeCred(null); }
}
