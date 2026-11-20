// Landing page and registration.
//
//   landing  ->  Enter the City            (walk around freely as a guest)
//            ->  Register  ->  1 who you are  ->  2 what you do  ->  3 your block
//                          ->  4 your links  ->  5 your character  ->  Enter the City
//
// Guests can roam the whole city; meeting people (profiles, links, guide) needs
// registering, and a guest can start the same five steps from inside the city,
// in which case finishing them drops back where they were. Returning visitors
// (registered on this browser) go straight in. The city loads behind this screen,
// so entering is instant. Progress is kept as a draft in this browser.
const DRAFT_KEY = 'deccan-commons.draft';
const STEPS = ['Who you are', 'What you do', 'Your block', 'Your links', 'Your character'];

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// accept what people actually paste or type, and turn it into a proper link
export function normaliseLinkedIn(v) {
  v = v.trim(); if (!v) return '';
  v = v.replace(/^@/, '');
  if (!/linkedin\.com/i.test(v)) v = 'linkedin.com/in/' + v.replace(/^\/+|\/+$/g, '');
  v = v.replace(/^(https?:\/\/)?(www\.)?/i, 'https://www.');
  return v.replace(/\?.*$/, '').replace(/\/+$/, '');
}
export function normaliseX(v) {
  v = v.trim(); if (!v) return '';
  const m = v.match(/(?:(?:x|twitter)\.com\/)?@?([A-Za-z0-9_]{1,15})\/?(?:\?.*)?$/i);
  return m ? 'https://x.com/' + m[1] : v;
}
export function normaliseSite(v) {
  v = v.trim(); if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : 'https://' + v;
}

export function createOnboarding({ archetypes, lookFor, skins, districts, statusColors, save, getMe, onEnter, onExplore, peopleCount, ready = Promise.resolve() }) {
  const root = h('div'); root.id = 'gate'; root.hidden = true; // shown by show()
  document.body.append(root);
  let draft = load();
  let step = -1; // -1 landing, 0..4 the steps
  let busy = false;
  let inCity = false; // opened from inside the city: back / finish return there
  // the city loads behind the landing page; the way in opens once it is fully ready
  let loaded = false, frac = 0;
  ready.finally(() => { loaded = true; if (!root.hidden && step < 0) render(); });
  // a button that waits for the city, filling up as files arrive
  const enterBtn = (label, onGo) => {
    const b = h('button', 'btn primary big enter');
    if (loaded) { b.textContent = label; b.onclick = onGo; return b; }
    b.disabled = true; b.classList.add('wait'); b.style.setProperty('--p', frac.toFixed(3));
    b.append(h('span', '', 'Loading the city'), h('em', 'pct', Math.round(frac * 100) + '%'));
    return b;
  };

  function load() {
    const blank = { name: '', role: '', student: false, company: '', bio: '', skills: '', status: 'open', area: districts[0].id, linkedin: '', x: '', site: '', arche: 'engineer', skin: skins[2] };
    try { return { ...blank, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; } catch { return blank; }
  }
  const keep = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode */ } };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ } };

  // ---- landing ---------------------------------------------------------------------
  function landing() {
    const me = getMe();
    const box = h('div', 'land');
    // kept deliberately plain: the name, one button, and how many people are in
    const logo = h('div', 'mark big');
    const hero = h('h1', 'hero'); hero.append('Hyderabad ', h('em', '', 'Connect'));
    const sub = h('p', 'lead');
    const cta = h('div', 'cta');
    if (me) {
      const go = enterBtn('Enter the City', () => enter(me));
      const edit = h('button', 'btn', 'Edit my profile'); edit.onclick = () => { fromProfile(me); show(0); };
      cta.append(go, edit);
      sub.textContent = `Welcome back, ${me.name.split(' ')[0]}.`;
    } else {
      // new visitors walk straight in; registering is only needed to meet people
      const go = enterBtn('Enter the City', () => { close(); onExplore(); });
      const reg = h('button', 'btn big', 'Register'); reg.onclick = () => show(0);
      cta.append(go, reg);
    }
    const count = h('div', 'count'); count.append(h('i', 'dot live'), h('span', '', 'Loading the city…'));
    peopleCount().then((n) => { count.lastChild.textContent = n ? `${n} ${n === 1 ? 'person' : 'people'} on the map` : 'Be one of the first on the map'; }).catch(() => { count.lastChild.textContent = 'Hyderabad · Madhapur'; });
    box.append(logo, hero);
    if (sub.textContent) box.append(sub);
    box.append(cta, count);
    return box;
  }

  // ---- the five steps ----------------------------------------------------------------
  const field = (label, key, { ph = '', max = 48, type = 'text', hint = '', big = false, area = false } = {}) => {
    const wrap = h('label', 'fld');
    wrap.append(h('span', 'lbl', label));
    const i = h(area ? 'textarea' : 'input', big ? 'field big' : 'field');
    if (!area) { i.type = type === 'url' ? 'text' : type; if (type === 'url') { i.inputMode = 'url'; i.autocapitalize = 'off'; i.spellcheck = false; } }
    i.value = draft[key]; i.placeholder = ph; i.maxLength = max;
    i.oninput = () => { draft[key] = i.value; keep(); const e = root.querySelector('.wiz .err'); if (e) e.textContent = ''; };
    wrap.append(i);
    if (hint) wrap.append(h('span', 'hint', hint));
    return wrap;
  };
  const segment = (opts, key, onPick) => {
    const g = h('div', 'seg');
    for (const [k, label, dot] of opts) {
      const b = h('button', draft[key] === k ? 'on' : '');
      b.type = 'button';
      if (dot) { const i = h('i', 'dot'); i.style.background = dot; b.append(i); }
      b.append(label);
      b.onclick = () => { draft[key] = k; keep(); onPick?.(); render(); };
      g.append(b);
    }
    return g;
  };

  const steps = [
    { // 1. who you are (with the short description up front)
      // students have no company: they pick "Student" and can add their college instead
      body: () => [field('Full name', 'name', { ph: 'Your real name', big: true }), field('Role', 'role', { ph: draft.student ? 'Computer Science student' : 'Product Designer' }),
        h('span', 'lbl', 'Where you are'), segment([[false, 'Working at a company'], [true, 'Student']], 'student'),
        draft.student ? field('College or university (optional)', 'company', { ph: 'Where you study' }) : field('Company', 'company', { ph: 'Where you work' }),
        field('Describe yourself in a line (optional)', 'bio', { ph: 'What you build, or what you are looking for', max: 140, area: true, hint: 'Shown on your profile card. Up to 140 characters.' })],
      check: () => (draft.name.trim().length < 2 ? 'Add your full name.' : draft.role.trim().length < 2 ? 'Add your role, like "Backend Engineer".'
        : !draft.student && draft.company.trim().length < 2 ? 'Add your company, or pick Student.' : null),
    },
    { // 2. what you do
      body: () => [field('Skills (optional)', 'skills', { ph: 'React, Figma, Go', max: 120, hint: 'Comma separated, up to 6.' }),
        h('span', 'lbl', 'Right now you are'), segment([['open', 'Open to work', statusColors.open], ['hiring', 'Hiring', statusColors.hiring], [null, 'Just exploring']], 'status')],
      check: () => null,
    },
    { // 3. your block
      body: () => [h('p', 'q', 'Your character stands in this block of Madhapur, where people can find you.'), segment(districts.map((d) => [d.id, d.name]), 'area')],
      check: () => (!draft.area ? 'Pick your block.' : null),
    },
    { // 4. your links
      body: () => [field('LinkedIn', 'linkedin', { ph: 'linkedin.com/in/your-name', max: 200, type: 'url' }), field('X (Twitter)', 'x', { ph: '@yourhandle', max: 200 }),
        field('Website or portfolio', 'site', { ph: 'yoursite.com', max: 200, type: 'url' }), h('p', 'q small', 'All optional. Add any you like so people can reach you.')],
      check: () => {
        const li = normaliseLinkedIn(draft.linkedin), x = normaliseX(draft.x), site = normaliseSite(draft.site);
        if (li && !/^https:\/\/www\.linkedin\.com\/\S+$/i.test(li)) return 'That LinkedIn link does not look right.';
        if (x && !/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(x)) return 'That X handle does not look right.';
        if (site && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(site)) return 'That website does not look right.';
        return null;
      },
    },
    { // 5. your character + a last look before entering
      body: () => {
        const tiles = h('div', 'tiles');
        for (const a of archetypes) {
          const t = h('button', 'tile' + (draft.arche === a.id ? ' on' : '')); t.type = 'button'; t.style.setProperty('--tb', a.bg);
          const f = h('i', 'fig'); f.style.setProperty('--c', a.look.top); f.style.setProperty('--hc', a.look.hairColor || '#1c1717');
          t.append(f, h('b', '', a.name));
          t.onclick = () => { draft.arche = a.id; keep(); render(); };
          tiles.append(t);
        }
        const sw = h('div', 'sw');
        for (const c of skins) { const b = h('button', draft.skin === c ? 'on' : ''); b.type = 'button'; b.style.background = c; b.title = 'Skin tone'; b.onclick = () => { draft.skin = c; keep(); render(); }; sw.append(b); }
        return [h('span', 'lbl', 'Pick a look'), tiles, h('span', 'lbl', 'Skin tone'), sw, h('span', 'lbl', 'How you will appear'), review()];
      },
      check: () => null,
    },
  ];
  function two(a, b) { const d = h('div', 'two'); d.append(a, b); return d; }
  function review() {
    const c = h('div', 'rev');
    const top = h('div', 'top'), av = h('div', 'av', initials(draft.name || '?'));
    const a = archetypes.find((x) => x.id === draft.arche);
    av.style.background = `linear-gradient(135deg, ${a.look.top}, ${a.look.accent || '#ff7a3d'})`;
    const who = h('div'); who.append(h('b', '', draft.name || 'Your name'), h('span', '', [draft.role, draft.company.trim() || (draft.student ? 'Student' : '')].filter(Boolean).join(' · ') || 'Your role'));
    top.append(av, who);
    c.append(top);
    if (draft.status) { const t = h('span', 'pill ' + draft.status, draft.status === 'open' ? 'Open to work' : 'Hiring'); c.append(t); }
    if (draft.bio) c.append(h('p', '', draft.bio));
    const ln = [['LinkedIn', normaliseLinkedIn(draft.linkedin)], ['X', normaliseX(draft.x)], ['Website', normaliseSite(draft.site)]].filter(([, v]) => v);
    if (ln.length) { const l = h('div', 'links'); for (const [n] of ln) l.append(h('span', '', n)); c.append(l); }
    return c;
  }
  const initials = (n) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  function wizard() {
    const s = steps[step];
    const card = h('form', 'wiz');
    card.noValidate = true; // our own checks accept "linkedin.com/in/you" and "@handle"; the browser's would not
    card.onsubmit = (e) => { e.preventDefault(); next(); };
    const head = h('div', 'wh');
    const back = h('button', 'back', '‹'); back.type = 'button'; back.title = 'Back'; back.onclick = goBack;
    const prog = h('div', 'prog');
    STEPS.forEach((_, i) => prog.append(h('i', i < step ? 'done' : i === step ? 'now' : '')));
    head.append(back, prog, h('small', '', `Step ${step + 1} of ${STEPS.length}`));
    const title = h('h2', '', STEPS[step]);
    const body = h('div', 'wb'); body.append(...s.body());
    const err = h('div', 'err'); err.setAttribute('role', 'alert');
    const foot = h('div', 'wf');
    const last = step === STEPS.length - 1;
    const go = h('button', 'btn primary big', !last ? 'Next' : inCity ? 'Join the map' : 'Enter the City'); go.type = 'submit';
    foot.append(err, go);
    card.append(head, title, body, foot);
    card.errEl = err; card.goEl = go;
    return card;
  }

  async function next() {
    if (busy) return;
    const card = root.querySelector('.wiz');
    const problem = steps[step].check();
    if (problem) { card.errEl.textContent = problem; return; }
    if (step < STEPS.length - 1) { show(step + 1); return; }
    // last step: register (or save edits), then walk in
    busy = true; card.goEl.disabled = true; card.errEl.textContent = '';
    try {
      const a = archetypes.find((x) => x.id === draft.arche);
      const profile = {
        name: draft.name.trim(), role: draft.role.trim(), student: !!draft.student, company: draft.company.trim() || (draft.student ? 'Student' : ''), bio: draft.bio.trim(),
        skills: draft.skills.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6), status: draft.status, area: draft.area,
        links: { linkedin: normaliseLinkedIn(draft.linkedin), x: normaliseX(draft.x), site: normaliseSite(draft.site) },
        look: { ...lookFor(a.id), skin: draft.skin },
      };
      const person = await save(profile, a.id);
      clearDraft();
      if (!loaded) { card.goEl.textContent = 'Loading the city…'; await ready.catch(() => {}); }
      enter(person, inCity);
    } catch (e) {
      card.errEl.textContent = e.message || 'Could not register. Please try again.';
      card.goEl.disabled = false;
    } finally { busy = false; }
  }

  function fromProfile(p) {
    draft = { ...draft, name: p.name || '', role: p.role || '', student: !!p.student, company: p.student && p.company === 'Student' ? '' : p.company || '', bio: p.bio || '', skills: (p.skills || []).join(', '), status: p.status ?? null, area: p.area,
      linkedin: p.links?.linkedin || '', x: p.links?.x || '', site: p.links?.site || p.link || '', arche: p.arche || draft.arche, skin: p.look?.skin || draft.skin };
  }

  function render() {
    root.replaceChildren(step < 0 ? landing() : wizard());
    const first = root.querySelector('input, textarea');
    if (first && step >= 0 && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
  }
  // show(-1) is the landing page; show(0, { inCity: true }) registers from inside the city
  function show(s, opts = {}) {
    if ('inCity' in opts) inCity = !!opts.inCity; else if (s < 0) inCity = false;
    step = Math.max(-1, Math.min(STEPS.length - 1, s)); root.hidden = false; document.body.classList.add('gated'); render();
  }
  function close() { root.hidden = true; document.body.classList.remove('gated'); }
  function enter(person, fromCity = false) { close(); inCity = false; onEnter(person, fromCity); }
  function goBack() { if (step === 0 && inCity) { inCity = false; close(); } else show(step - 1); }

  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && step >= 0) goBack(); e.stopPropagation(); });
  function progress(f) {
    frac = Math.max(frac, Math.min(0.95, f)); // the last 5% is the shader warm-up
    const b = root.querySelector('.enter.wait'); if (!b) return;
    b.style.setProperty('--p', frac.toFixed(3)); b.querySelector('.pct').textContent = Math.round(frac * 100) + '%';
  }
  return { show, progress, get open() { return !root.hidden; }, refresh: () => { if (!root.hidden && step < 0) render(); } };
}
