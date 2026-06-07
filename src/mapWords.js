// Map-words overlay — per-zone characteristic labels over the explore-single maps:
//   Form     → 25 keywords (most-characteristic-by-lift per grid zone)
//   Source   → 17 subjects anchored to each book cluster's densest blob
//   Semantic → up to 23 most-encompassing two-word keywords (from its own tag source)
//   Time     → 25 evenly-spread years
// Labels are DOM spans re-anchored to their sprite's live screen position every
// frame via app.getScreenPosition(id). Driven by `set-map-words` + per-frame
// update() from main.js's render loop. Pure DOM overlay — no render-loop,
// state-machine, or interaction-logic participation (project exception #16).
//
// Time labels use canvas-4 (the time/spiral canvas) for screen positions since
// the year anchors live in the spiral embedding; all other labels use canvas-1
// (the host single-view canvas, which morphs between form/source/semantic maps).
export function createMapWords() {
  const container = document.getElementById('map-words');
  let labels = { form: [], source: [], semantic: [], time: [] };
  let activeKey = null;  // 'form' | 'source' | 'semantic' | 'time' | null
  let nodes = [];        // [{ id, el }] for the mounted set
  let fadingOut = false; // true while fade-out is in progress; blocks update() from re-showing

  function clearNodes() {
    for (const n of nodes) n.el.remove();
    nodes = [];
  }

  function mount(key) {
    fadingOut = false; // new data arriving cancels any in-progress fade
    clearNodes();
    activeKey = key;
    if (!container || !key) return;
    const set = labels[key] ?? [];
    for (const lab of set) {
      if (!lab || typeof lab.id !== 'string') continue;
      const el = document.createElement('span');
      el.className = 'map-word';
      el.textContent = typeof lab.text === 'string' ? lab.text : '';
      container.appendChild(el);
      nodes.push({ id: lab.id, el });
    }
  }

  function setLabels(payload) {
    const form     = Array.isArray(payload?.form)     ? payload.form     : [];
    const source   = Array.isArray(payload?.source)   ? payload.source   : [];
    const semantic = Array.isArray(payload?.semantic) ? payload.semantic : [];
    const time     = Array.isArray(payload?.time)     ? payload.time     : [];
    const allEmpty = form.length === 0 && source.length === 0 && semantic.length === 0 && time.length === 0;
    if (allEmpty) {
      // Fade out smoothly — remove .visible (triggers 600ms CSS transition)
      // and set fadingOut so update() doesn't re-add .visible on the next frame.
      // Nodes stay mounted for the duration of the fade; reload cleans them up.
      fadingOut = true;
      if (container) container.classList.remove('visible');
      labels = { form, source, semantic, time };
      return;
    }
    fadingOut = false; // real data arrived — cancel any in-progress fade
    labels = { form, source, semantic, time };
    if (activeKey) mount(activeKey);
  }

  // Called each frame.
  //   apps    — full apps array from main.js (apps[0] = canvas-1, apps[3] = canvas-4)
  //   map     — current single-view map type ('form'/'source'/'time'/...) or null
  //   settled — true when NOT mid-morph
  function update(apps, map, settled) {
    // While a fade-out is in progress, block update() from re-showing the overlay.
    if (fadingOut) return;
    if (!settled) {
      if (container) container.classList.remove('visible');
      return;
    }

    const desired = (map === 'form' || map === 'source' || map === 'semantic' || map === 'time') ? map : null;

    if (!desired) {
      if (activeKey) mount(null);
      if (container) container.classList.remove('visible');
      return;
    }

    if (desired !== activeKey) mount(desired);
    if (!container || !activeKey) {
      if (container) container.classList.remove('visible');
      return;
    }

    // All labels — including Time — use canvas-1 (apps[0]), the only full-screen
    // canvas in single state. When singleCurrentMap is 'time', canvas-1 has
    // already morphed to the spiral layout, so getScreenPosition returns the
    // correct spiral-space screen positions for those ids.
    const appEntry = apps[0];
    const app = appEntry && appEntry.isReady ? appEntry.object : null;
    if (!app || !app.getScreenPosition) {
      if (container) container.classList.remove('visible');
      return;
    }

    let any = false;
    for (const n of nodes) {
      const p = app.getScreenPosition(n.id);
      if (p) {
        n.el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
        n.el.style.display = '';
        any = true;
      } else {
        n.el.style.display = 'none';
      }
    }
    container.classList.toggle('visible', any);
  }

  return { setLabels, update };
}
