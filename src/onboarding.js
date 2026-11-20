// Landing page and registration.
//
//   landing  ->  Enter the City            (walk around freely as a guest)
//   Register ->  1 who you are  ->  2 what you do  ->  3 your links
//            ->  4 edit your character (with a live 3D preview)  ->  Join the map
//
// Guests can roam the whole city; meeting people (profiles, links, saying hi) needs
// registering, and a guest can start the same four steps from inside the city,
// in which case finishing them drops back where they were. Returning visitors
// (registered on this browser) go straight in. The city loads behind this screen,
// so entering is instant. Progress is kept as a draft in this browser.
import { createCharacterPreview, createThumbs } from './features/charpreview.js';

const DRAFT_KEY = 'deccan-commons.draft';
const STEPS = ['Who you are', 'What you do', 'Your links', 'Edit your character'];

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

export function createOnboarding({ archetypes, lookFor, skins, looks, districts, statusColors, save, getMe, onEnter, onExplore, onSaveLook, ready = Promise.resolve() }) {
  const root = h('div'); root.id = 'gate'; root.hidden = true; // shown by show()
  document.body.append(root);
  let draft = load();
  let step = -1; // -1 landing, 0..3 the steps
  let preview = null, thumbs = null; // the character editor's live preview and tile pictures (only while it is open)
  let mode = 'register'; // or 'look': editing my character from inside the city
  let lookEdit = null; // { look, arche, tab } while editing from the city
  let busy = false;
  let inCity = false; // opened from inside the city: back / finish return there
  // the city loads behind the landing page; the way in opens once it is fully ready
  let loaded = false, frac = 0;
  ready.finally(() => {
    loaded = true;
    const b = root.querySelector('.enter.wait'); if (b) b.replaceWith(enterBtn(b._label, b._go));
  });
  // a button that waits for the city, filling up as files arrive
  const enterBtn = (label, onGo) => {
    const b = h('button', 'btn primary big enter');
    b._label = label; b._go = onGo;
    if (loaded) { b.append(h('span', '', label), h('i', 'arrow', '→')); b.onclick = onGo; return b; }
    b.disabled = true; b.classList.add('wait'); b.style.setProperty('--p', frac.toFixed(3));
    b.append(h('span', '', 'Loading the city'), h('em', 'pct', Math.round(frac * 100) + '%'));
    return b;
  };

  function load() {
    const blank = { name: '', role: '', student: false, company: '', bio: '', skills: '', status: 'open', area: districts[0].id, linkedin: '', x: '', site: '', arche: 'engineer', skin: skins[2] };
    try { return { ...blank, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; } catch { return blank; }
  }
  // ---- the character -------------------------------------------------------------------
  const bodyOf = (L) => (L.body === 'female' || L.body === 'male' ? L.body : L.hair === 'bun' || L.hair === 'long' ? 'female' : 'male');
  const fitHair = (hair, body) => (looks.hairs[body].some(([v]) => v === hair) ? hair : looks.hairs[body][0][0]);
  // one of the ready-made looks, worn by this body with this skin
  const archLook = (a, body, skin) => { const L = { ...lookFor(a.id), body, skin }; L.hair = fitHair(L.hair, body); if (body === 'female') L.beard = false; return L; };
  if (!draft.look) { const a = archetypes.find((x) => x.id === draft.arche) || archetypes[1]; draft.look = archLook(a, bodyOf(a.look), draft.skin || skins[2]); }
  const lookOf = () => draft.look;
  const keep = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* private mode */ } };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ } };

  // ---- landing ---------------------------------------------------------------------
  // A still picture of the city, the name, three words and one line, and one way in.
  function landing() {
    const me = getMe();
    const box = h('div', 'land');
    const hero = h('h1', 'hero'); hero.append(h('span', 'w1', 'Hyderabad'), h('em', 'w2', 'Connect'));
    const words = h('div', 'words');
    ['Walk', 'Meet', 'Find'].forEach((w, i) => { if (i) words.append(h('i', 'dot')); words.append(h('b', '', w)); });
    const tag = h('p', 'tag', 'Meet, greet and find the one: your next co-founder, hire or team.');
    const cta = h('div', 'cta');
    cta.append(enterBtn('Enter the City', me ? () => enter(me) : () => { close(); onExplore(); }));
    box.append(hero, words, tag, cta);
    return box;
  }

  // ---- the five steps ----------------------------------------------------------------
  const field = (label, key, { ph = '', max = 48, type = 'text', hint = '', big = false, area = false, req = false } = {}) => {
    const wrap = h('label', 'fld' + (req ? ' req' : ''));
    const lbl = h('span', 'lbl', label); if (req) lbl.append(h('i', 'must', '*'));
    wrap.append(lbl);
    const i = h(area ? 'textarea' : 'input', big ? 'field big' : 'field');
    if (!area) { i.type = type === 'url' ? 'text' : type; if (type === 'url') { i.inputMode = 'url'; i.autocapitalize = 'off'; i.spellcheck = false; } }
    i.value = draft[key]; i.placeholder = ph; i.maxLength = max; i.dataset.key = key; if (req) i.required = true;
    i.oninput = () => { draft[key] = i.value; keep(); wrap.classList.remove('bad'); const e = root.querySelector('.wiz .err'); if (e) e.textContent = ''; };
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
      // students have no company: they pick "Student" and give their college instead
      body: () => [field('Full name', 'name', { ph: 'Your real name', big: true, req: true }), field('Role', 'role', { ph: draft.student ? 'Computer Science student' : 'Product Designer', req: true }),
        h('span', 'lbl', 'Where you are'), segment([[false, 'Working at a company'], [true, 'Student']], 'student'),
        draft.student ? field('College or university', 'company', { ph: 'Where you study', req: true }) : field('Company', 'company', { ph: 'Where you work', req: true }),
        field('Describe yourself in a line (optional)', 'bio', { ph: 'What you build, or what you are looking for', max: 140, area: true, hint: 'Shown on your profile card. Up to 140 characters.' })],
      check: () => (draft.name.trim().length < 2 ? 'Add your full name.' : draft.role.trim().length < 2 ? 'Add your role, like "Backend Engineer".'
        : draft.company.trim().length < 2 ? (draft.student ? 'Add your college or university.' : 'Add your company, or pick Student.') : null),
    },
    { // 2. what you do
      body: () => [field('Skills (optional)', 'skills', { ph: 'React, Figma, Go', max: 120, hint: 'Comma separated, up to 6.' }),
        h('span', 'lbl', 'Right now you are'), segment([['open', 'Open to work', statusColors.open], ['hiring', 'Hiring', statusColors.hiring], [null, 'Just exploring']], 'status')],
      check: () => null,
    },
    { // 3. your links
      body: () => [field('LinkedIn', 'linkedin', { ph: 'linkedin.com/in/your-name', max: 200, type: 'url' }), field('X (Twitter)', 'x', { ph: '@yourhandle', max: 200 }),
        field('Website or portfolio', 'site', { ph: 'yoursite.com', max: 200, type: 'url' }), h('p', 'q small', 'All optional. Add any you like so people can reach you.')],
      check: () => {
        const li = normaliseLinkedIn(draft.linkedin), x = normaliseX(draft.x), site = normaliseSite(draft.site);
        if (li && !/^https:\/\/www\.linkedin\.com\/\S+$/i.test(li)) return ['That LinkedIn link does not look right.', 'linkedin'];
        if (x && !/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(x)) return ['That X handle does not look right.', 'x'];
        if (site && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(site)) return ['That website does not look right.', 'site'];
        return null;
      },
    },
    { // 4. edit your character, watching it change in 3D as you go
      body: () => charEditor(draft, () => { keep(); render(); }),
      check: () => null,
    },
  ];
  // st: { look, arche, ctab }; changed() is called after every choice
  function charEditor(st, changed) {
    const L = st.look, body = bodyOf(L), tab = st.ctab || 'look';
    preview ??= createCharacterPreview();
    preview.set(L);
    thumbs ??= createThumbs();
    thumbs.clearQueue(); // only pictures for what is on screen now
    const set = (patch) => { st.look = { ...st.look, ...patch }; changed(); };
    const pic = (look, frame) => {
      const img = h('img'); img.alt = ''; img.draggable = false;
      const url = thumbs.get(look, frame, (u) => { img.src = u; img.classList.add('in'); });
      if (url) { img.src = url; img.classList.add('in'); }
      return img;
    };
    const tile = (label, look, frame, on, pick, bg) => {
      const t = h('button', 'ctile ' + frame + (on ? ' on' : '')); t.type = 'button';
      if (bg) t.style.setProperty('--tb', bg);
      t.append(pic(look, frame), h('b', '', label));
      t.onclick = pick;
      return t;
    };
    const swatches = (list, key, title) => {
      const sw = h('div', 'sw');
      for (const c of list) { const b = h('button', L[key] === c ? 'on' : ''); b.type = 'button'; b.style.background = c; b.title = title; b.onclick = () => set({ [key]: c }); sw.append(b); }
      return sw;
    };
    const lbl = (t) => h('span', 'lbl', t);

    const bodySeg = h('div', 'seg bodies');
    for (const [v, label] of [['female', 'Woman'], ['male', 'Man']]) {
      const b = h('button', body === v ? 'on' : '', label); b.type = 'button';
      b.onclick = () => { if (body === v) return; set({ body: v, hair: fitHair(L.hair, v), beard: v === 'male' ? L.beard : false }); };
      bodySeg.append(b);
    }
    const tabs = h('div', 'ctabs');
    for (const [v, label] of [['look', 'Look'], ['hair', 'Hair'], ['top', 'Top'], ['bottom', 'Bottom'], ['shoes', 'Shoes'], ['skin', 'Skin']]) {
      const b = h('button', tab === v ? 'on' : '', label); b.type = 'button'; b.onclick = () => { st.ctab = v; changed(); }; tabs.append(b);
    }
    const pane = h('div', 'cpane');
    if (tab === 'look') {
      const g = h('div', 'cgrid');
      for (const a of archetypes) { const look = archLook(a, body, L.skin); g.append(tile(a.name, look, 'bust', st.arche === a.id, () => { st.arche = a.id; st.look = look; changed(); }, a.bg)); }
      pane.append(lbl('Start from a look'), g);
    } else if (tab === 'hair') {
      const g = h('div', 'cgrid');
      for (const [v, label] of looks.hairs[body]) g.append(tile(label, { ...L, hair: v }, 'head', L.hair === v, () => set({ hair: v })));
      pane.append(lbl('Style'), g, lbl('Colour'), swatches(looks.hairColors, 'hairColor', 'Hair colour'));
      if (body === 'male') {
        const bs = h('div', 'seg');
        for (const [v, label] of [[false, 'No beard'], [true, 'Beard']]) { const b = h('button', !!L.beard === v ? 'on' : '', label); b.type = 'button'; b.onclick = () => set({ beard: v }); bs.append(b); }
        pane.append(lbl('Beard'), bs);
      }
    } else if (tab === 'top') {
      const g = h('div', 'cgrid');
      for (const [v, label] of looks.outfits) g.append(tile(label, { ...L, outfit: v }, 'bust', L.outfit === v, () => set({ outfit: v })));
      pane.append(lbl('Style'), g, lbl('Colour'), swatches(looks.tops, 'top', 'Top colour'));
    } else if (tab === 'bottom') pane.append(lbl('Colour'), swatches(looks.bottoms, 'bottom', 'Bottoms colour'));
    else if (tab === 'shoes') pane.append(lbl('Colour'), swatches(looks.shoes, 'shoes', 'Shoe colour'));
    else pane.append(lbl('Skin tone'), swatches(skins, 'skin', 'Skin tone'));

    const stage = h('div', 'pvw'); stage.append(preview.canvas, h('span', 'pvh', 'Drag to turn'));
    const opts = h('div', 'pvo'); opts.append(bodySeg, tabs, pane);
    const split = h('div', 'cedit'); split.append(stage, opts);
    return mode === 'look' ? [split] : [split, h('span', 'lbl', 'How you will appear'), review()];
  }
  function two(a, b) { const d = h('div', 'two'); d.append(a, b); return d; }
  function review() {
    const c = h('div', 'rev');
    const top = h('div', 'top'), av = h('div', 'av', initials(draft.name || '?'));
    av.style.background = `linear-gradient(135deg, ${draft.look.top}, ${draft.look.accent || '#ff7a3d'})`;
    const who = h('div'); who.append(h('b', '', draft.name || 'Your name'), h('span', '', [draft.role, draft.company.trim()].filter(Boolean).join(' · ') || 'Your role'));
    top.append(av, who);
    c.append(top);
    if (draft.status) { const t = h('span', 'pill ' + draft.status, draft.status === 'open' ? 'Open to work' : 'Hiring'); c.append(t); }
    if (draft.bio) c.append(h('p', '', draft.bio));
    const ln = [['LinkedIn', normaliseLinkedIn(draft.linkedin)], ['X', normaliseX(draft.x)], ['Website', normaliseSite(draft.site)]].filter(([, v]) => v);
    if (ln.length) { const l = h('div', 'links'); for (const [n] of ln) l.append(h('span', '', n)); c.append(l); }
    return c;
  }
  const initials = (n) => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  function lookCard() {
    const card = h('form', 'wiz wide look');
    card.noValidate = true;
    card.onsubmit = async (e) => {
      e.preventDefault(); if (busy) return;
      busy = true; go.disabled = true; err.textContent = '';
      try { await onSaveLook(lookEdit.look); close(); } catch (ex) { err.textContent = ex.message || 'Could not save. Please try again.'; go.disabled = false; } finally { busy = false; }
    };
    const head = h('div', 'wh');
    const back = h('button', 'back', '‹'); back.type = 'button'; back.title = 'Back'; back.onclick = goBack;
    head.append(back, h('small', '', 'Your profile stays as registered; only your character changes'));
    const body = h('div', 'wb'); body.append(...charEditor(lookEdit, render));
    const err = h('div', 'err'); err.setAttribute('role', 'alert');
    const foot = h('div', 'wf'), go = h('button', 'btn primary big', 'Save my character'); go.type = 'submit';
    foot.append(err, go);
    card.append(head, h('h2', '', 'Edit your character'), body, foot);
    return card;
  }

  function wizard() {
    if (mode === 'look') return lookCard();
    const s = steps[step];
    const card = h('form', 'wiz' + (step === STEPS.length - 1 ? ' wide' : ''));
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
    if (problem) {
      const [msg, key] = Array.isArray(problem) ? problem : [problem];
      card.errEl.textContent = msg;
      const bad = [...card.querySelectorAll('.fld')].filter((f) => {
        const i = f.querySelector('input, textarea');
        return (f.classList.contains('req') && i.value.trim().length < 2) || i.dataset.key === key;
      });
      bad.forEach((f) => f.classList.add('bad'));
      bad[0]?.querySelector('input, textarea').focus();
      return;
    }
    if (step < STEPS.length - 1) { show(step + 1); return; }
    // last step: register (or save edits), then walk in
    busy = true; card.goEl.disabled = true; card.errEl.textContent = '';
    try {
      const a = archetypes.find((x) => x.id === draft.arche) || archetypes[1];
      const profile = {
        name: draft.name.trim(), role: draft.role.trim(), student: !!draft.student, company: draft.company.trim(), bio: draft.bio.trim(),
        skills: draft.skills.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6), status: draft.status, area: districts[0].id, // everyone starts at the main junction
        links: { linkedin: normaliseLinkedIn(draft.linkedin), x: normaliseX(draft.x), site: normaliseSite(draft.site) },
        look: draft.look,
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

  function render() {
    if (mode !== 'look' && step !== STEPS.length - 1) { preview?.dispose(); preview = null; thumbs?.dispose(); thumbs = null; }
    root.classList.toggle('on-land', step < 0);
    root.replaceChildren(step < 0 ? landing() : wizard());
    const first = root.querySelector('input, textarea');
    if (first && step >= 0 && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
  }
  // show(-1) is the landing page; show(0, { inCity: true }) registers from inside the city
  function show(s, opts = {}) {
    mode = 'register';
    if ('inCity' in opts) inCity = !!opts.inCity; else if (s < 0) inCity = false;
    step = Math.max(-1, Math.min(STEPS.length - 1, s)); root.hidden = false; document.body.classList.add('gated'); render();
  }
  function close() { root.hidden = true; document.body.classList.remove('gated'); preview?.dispose(); preview = null; thumbs?.dispose(); thumbs = null; mode = 'register'; }
  function enter(person, fromCity = false) { close(); inCity = false; onEnter(person, fromCity); }
  function goBack() { if (mode === 'look' || (step === 0 && inCity)) { inCity = false; close(); } else show(step - 1); }
  // "Edit character" from inside the city: the same editor, for my look only
  function editLook(look) {
    lookEdit = { look: { ...look, body: bodyOf(look) }, arche: null, ctab: 'look' };
    mode = 'look'; step = 0; root.hidden = false; document.body.classList.add('gated'); render();
  }

  root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && step >= 0) goBack(); e.stopPropagation(); });
  function progress(f) {
    frac = Math.max(frac, Math.min(0.95, f)); // the last 5% is the shader warm-up
    const b = root.querySelector('.enter.wait'); if (!b) return;
    b.style.setProperty('--p', frac.toFixed(3)); b.querySelector('.pct').textContent = Math.round(frac * 100) + '%';
  }
  return { show, editLook, progress, get open() { return !root.hidden; }, get landing() { return !root.hidden && step < 0; }, refresh: () => { if (!root.hidden && step < 0) render(); } };
}
