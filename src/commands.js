import { pickRandom as pickRandomColor } from './pathColors.js';

export function createCommands(apps, stateManager, pathPlayer) {
  function focusOnId(pointId) {
    if (!pointId) return;
    console.log('Focusing on', pointId);
    // Overview is read-only on the spatial side: focus messages drive the
    // highlight halo for perceptual feedback, but the camera target must
    // not move. Extends CLAUDE.md's existing post-confirmation rule to any
    // overview state (pre- or post-confirmation).
    const pan = stateManager.state !== 'overview';
    apps.forEach(a => {
      if (a.isReady) a.object.focusOn(pointId, { pan });
    });
  }

  function pickRandomCommonId() {
    const ids = pickNRandomCommonIds(1);
    return ids.length === 1 ? ids[0] : null;
  }

  function pickNRandomCommonIds(n) {
    const ready = apps.filter(a => a.isReady);
    if (ready.length === 0) return [];
    const sets = ready.map(a => new Set(a.object.getIds()));
    const [first, ...rest] = sets;
    const common = [...first].filter(id => rest.every(s => s.has(id)));
    if (common.length === 0) {
      console.warn('No ids in common across datasets');
      return [];
    }
    const out = [];
    const pool = common.slice();
    const take = Math.min(n, pool.length);
    for (let i = 0; i < take; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return out;
  }

  function setState(payload) {
    if (!payload?.name) {
      console.warn('[set-state] dropped: missing name', payload);
      return;
    }
    console.log('[set-state] received', payload);
    // Wire carries duration in ms (PHASE4); stateManager runs on seconds.
    const opts = {};
    if (typeof payload.duration === 'number') opts.duration = payload.duration / 1000;
    stateManager.goTo(payload.name, opts);
  }

  function startPath(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    pathPlayer.start(ids);
  }

  function simulatePath(count = 10) {
    const ids = pickNRandomCommonIds(count);
    if (ids.length === 0) return;
    console.log('Simulating path', ids);
    pathPlayer.start(ids);
  }

  function clearPaths() {
    pathPlayer.stop();
    apps.forEach(a => {
      if (a.isReady) a.object.clearPath();
    });
  }

  function addPathSegment(fromId, toId) {
    if (!fromId || !toId) return;
    const color = pickRandomColor();
    apps.forEach(a => {
      if (a.isReady) a.object.addPathSegment(fromId, toId, color);
    });
  }

  function truncatePath(keepCount) {
    apps.forEach(a => {
      if (a.isReady) a.object.truncatePath(keepCount);
    });
  }

  function setMask(payload) {
    const el = document.getElementById('render-mask');
    if (!el) return;
    const op = Math.max(0, Math.min(1, Number(payload?.opacity)));
    const dur = Math.max(0, Number(payload?.duration) || 0);
    el.style.transition = dur === 0 ? 'none' : `opacity ${dur}ms linear`;
    // Force reflow so the new transition value applies before the opacity change.
    void el.offsetWidth;
    el.style.opacity = String(op);
  }

  function setCanvasBg(payload) {
    const mode = payload?.mode;
    if (mode !== 'black' && mode !== 'gradient') {
      console.warn('[set-canvas-bg] dropped: unknown mode', payload);
      return;
    }
    document.body.dataset.canvasBg = mode;
  }

  // Reveal / hide the four component corner labels (Mirror / Trace /
  // Shift / Replay) rendered inside each canvas container. Driven by
  // an explicit wire directive instead of body[data-state] so the
  // labels can be coordinated with interface_nuxt's own corner-label
  // fade-in (currently triggered at the end of VIEW_3's caption timer).
  function setCornerLabels(payload) {
    const visible = payload?.visible === true;
    document.body.dataset.cornerLabels = visible ? 'visible' : '';
  }

  // Fullscreen-centred caption — drops a single string into
  // `#center-caption` and toggles visibility. Empty string (or missing
  // field) clears + hides. Project is content-blind; interface_nuxt
  // owns the copy and the timing (currently the 1s reveal after the
  // fourth VIEW_3 cross click, mirroring interface's `.modes-caption`).
  function setCenterCaption(payload) {
    const el = document.getElementById('center-caption');
    if (!el) return;
    const text = typeof payload?.text === 'string' ? payload.text : '';
    el.textContent = text;
    el.classList.toggle('visible', !!text);
  }

  // Per-canvas text overlay — drops title + body into the `.canvas-text`
  // DOM block inside container-N and toggles visibility. Empty strings
  // (or missing fields) clear the text and hide the block. Project never
  // knows what the text means; interface_nuxt owns content and decides
  // when each canvas's text appears (VIEW_3 cross click, VIEW_4
  // interpretation toggle).
  function setCanvasText(payload) {
    const i = payload?.canvasIndex;
    if (typeof i !== 'number' || i < 0 || i > 3) {
      console.warn('[set-canvas-text] dropped: bad canvasIndex', payload);
      return;
    }
    const el = document.querySelector(`.canvas-text[data-canvas="${i}"]`);
    if (!el) return;
    const title = typeof payload.title === 'string' ? payload.title : '';
    const body = typeof payload.body === 'string' ? payload.body : '';
    const titleEl = el.querySelector('.canvas-text-title');
    const bodyEl = el.querySelector('.canvas-text-body');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    el.classList.toggle('visible', !!(title || body));
  }

  // Transient perception channel: highlight a single id (or clear with null).
  // No camera move, no state change, no persistence — purely a visual hint.
  function setHighlight(payload) {
    const id = payload && typeof payload.id === 'string' ? payload.id : null;
    apps.forEach(a => {
      if (a.isReady && a.object.highlight) a.object.highlight(id);
    });
  }

  // Per-canvas zoom-in: while project is in `overview`, zoom one canvas
  // toward `split`'s cameraZ AND pan its camera onto the given image.
  // Used by VIEW-3's per-quadrant cross flow; each call shifts one of the
  // four canvases from the overview look to a split-like look. After all
  // four are zoomed the standalone visually matches `split` and the next
  // VIEW transition can flip the state-name without any visible change.
  const SPLIT_CAMERA_Z = 0.2;
  function setCanvasZoom(payload) {
    const i = payload?.canvasIndex;
    const id = payload?.imageId;
    if (typeof i !== 'number' || i < 0 || i > 3 || !id) {
      console.warn('[set-canvas-zoom] dropped: bad payload', payload);
      return;
    }
    const app = apps[i];
    // Matches goTo's default transition duration so the per-canvas zoom
    // feels like the overview transitions elsewhere in the system.
    const ZOOM_DURATION_SEC = 1.5;
    stateManager.setCanvasOverride(i, SPLIT_CAMERA_Z, ZOOM_DURATION_SEC);
    // Also switch this canvas's highlight preset to split's `default`. The
    // `big` preset (set by goTo('overview') for the whole field) reads
    // correctly at the overview cameraZ but renders the focused sprite too
    // large / too glowy once the canvas is at split's cameraZ. Per-canvas
    // preset keeps the zoomed canvas visually identical to a real split.
    if (app?.isReady && app.object.setHighlightPreset) {
      app.object.setHighlightPreset('default');
    }
    // Direct call to the canvas's focusOn with `pan: true` so the camera
    // actually moves — bypasses the focus-in-overview pan suppression
    // applied by `focusOnId`, since the user explicitly asked for this
    // canvas to zoom onto the selection. `panDuration` matches the
    // cameraZ override so lateral pan + zoom converge together; without it
    // the LERP-based pan would drift for seconds after the zoom completes.
    if (app?.isReady) app.object.focusOn(id, { pan: true, panDuration: ZOOM_DURATION_SEC });
  }

  return { focusOnId, pickRandomCommonId, setState, startPath, simulatePath, clearPaths, addPathSegment, truncatePath, setMask, setCanvasBg, setHighlight, setCanvasZoom, setCornerLabels, setCanvasText, setCenterCaption };
}
