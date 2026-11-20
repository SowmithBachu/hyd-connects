// Photo mode (P): the HUD steps aside, you frame the shot with the usual mouse and
// wheel controls, pick a film look, and Space (or the shutter button) saves a PNG of
// exactly what is on screen to your downloads.
import { FILTERS } from '../post.js';

export function createPhoto({ post, notify, onToggle }) {
  const ui = document.createElement('div');
  ui.id = 'photo'; ui.className = 'glass'; ui.hidden = true;
  const flash = document.createElement('div'); flash.id = 'flash';
  document.body.append(ui, flash);
  let on = false, look = 'natural';

  function render() {
    ui.replaceChildren();
    const title = document.createElement('div'); title.className = 'pt';
    title.innerHTML = '<b>Photo mode</b><span>Drag or move the mouse to frame · wheel to zoom · Space to take a photo</span>';
    const looks = document.createElement('div'); looks.className = 'seg';
    for (const [k, f] of Object.entries(FILTERS)) {
      const b = document.createElement('button'); b.textContent = f.label; b.className = k === look ? 'on' : '';
      b.onclick = () => { look = k; post.setFilter(k); render(); };
      looks.append(b);
    }
    const row = document.createElement('div'); row.className = 'row';
    const shot = document.createElement('button'); shot.className = 'btn primary shutter'; shot.textContent = 'Take photo'; shot.onclick = () => api.shoot();
    const out = document.createElement('button'); out.className = 'btn'; out.textContent = 'Done'; out.onclick = () => api.toggle(false);
    row.append(shot, out);
    ui.append(title, looks, row);
  }

  const api = {
    get on() { return on; },
    toggle(v = !on) {
      on = v; ui.hidden = !on; document.body.classList.toggle('photo', on);
      if (on) render(); else { look = 'natural'; post.setFilter('natural'); }
      onToggle?.(on);
    },
    shoot() {
      if (!on) return;
      ui.style.visibility = 'hidden';
      post.capture((blob) => {
        ui.style.visibility = '';
        flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
        if (!blob) { notify('Could not save the photo'); return; }
        const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = `hyderabad-connects-${stamp}.png`; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        notify('Photo saved to your downloads');
      });
    },
  };
  return api;
}
