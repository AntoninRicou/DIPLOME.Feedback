import { colorForQuadrant } from './pathColors.js';

export function createCommands(apps, stateManager, pathPlayer, mapWords) {
  function focusOnId(pointId) {
    if (!pointId) return;
    console.log('Focusing on', pointId);
    // Overview is read-only on the spatial side: focus messages drive the
    // highlight halo for perceptual feedback, but the camera target must
    // not move. Extends CLAUDE.md's existing post-confirmation rule to any
    // overview state (pre- or post-confirmation).
    const globalOverview = stateManager.state === 'overview';
    // Per-canvas pan suppression: VIEW_4 hover-unzoom pins individual
    // canvases at overview cameraZ via setCanvasOverride. Those canvases
    // must keep their (0,0) camera position when history nav fires focus,
    // even though the global state is `split`. The halo still updates so
    // the user sees the active-image hint on the full map.
    apps.forEach((a, i) => {
      if (!a.isReady) return;
      const pan = !globalOverview && stateManager.shouldPanCanvas(i);
      a.object.focusOn(pointId, { pan });
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

  function addPathSegment(fromId, toId, quadrant) {
    if (!fromId || !toId) return;
    // Colour by the clicked image's quadrant (0=tl,1=tr,2=bl,3=br), with a
    // single global override available. See pathColors.js to tune/erase.
    const color = colorForQuadrant(quadrant);
    apps.forEach((a, i) => {
      if (!a.isReady) return;
      // Per-canvas timer fallback: when this canvas has its pan
      // suppressed (VIEW_4 hover-unzoom), pathTrace can't ride
      // panProgress to draw the segment — animate on its own clock
      // instead so the line still visibly reaches the new image.
      const useTimer = !stateManager.shouldPanCanvas(i);
      a.object.addPathSegment(fromId, toId, color, useTimer);
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

  // Luminosity dimmer — animates the #render-dim black overlay's opacity.
  // Same shape as setMask: `level` (0..1) is the darkness, `duration` (ms) the
  // fade (0 = instant). Pure DOM/CSS overlay; no render-loop participation.
  function setDim(payload) {
    const el = document.getElementById('render-dim');
    if (!el) return;
    const level = Math.max(0, Math.min(1, Number(payload?.level)));
    const dur = Math.max(0, Number(payload?.duration) || 0);
    el.style.transition = dur === 0 ? 'none' : `opacity ${dur}ms linear`;
    // Force reflow so the new transition value applies before the opacity change.
    void el.offsetWidth;
    el.style.opacity = String(level);
  }

  function setCanvasBg(payload) {
    const mode = payload?.mode;
    if (mode !== 'black' && mode !== 'gradient') {
      console.warn('[set-canvas-bg] dropped: unknown mode', payload);
      return;
    }
    document.body.dataset.canvasBg = mode;
  }

  // Reveal / hide the four component corner labels (Source / Form /
  // Semantic / Time) rendered inside each canvas container. Driven by
  // an explicit wire directive instead of body[data-state] so the
  // labels can be coordinated with interface_nuxt's own corner-label
  // fade-in (currently triggered at the end of VIEW_3's caption timer).
  function setCornerLabels(payload) {
    const visible = payload?.visible === true;
    const els = document.querySelectorAll('.corner-label');
    if (!visible) {
      // INSTANT hide. The base `.corner-label` carries a 600ms opacity
      // transition for the VIEW_3 reveal (fade-in). That same transition also
      // animates the fade-OUT when clearing, so a stale-visible label (project
      // left in split/overview from a prior run, a reconnect, or dev HMR) would
      // fade out over 600ms when this defensive clear fires — and the
      // VIEW_1→VIEW_2 overview reveal (gated on the variable disperse burst)
      // sometimes catches that tail, flashing the top-left "Source" label.
      // Suppress the transition so the clear is a hard cut with no visible tail.
      els.forEach((el) => { el.style.transition = 'none'; });
      document.body.dataset.cornerLabels = '';
      els.forEach((el) => el.classList.remove('visible'));
      void document.body.offsetWidth; // reflow commits opacity 0 with no transition
      els.forEach((el) => { el.style.transition = ''; });
      return;
    }
    document.body.dataset.cornerLabels = 'visible';
    // Keep the per-element `.visible` path coherent with the all-or-nothing
    // path: an all-on re-asserts every label (600ms fade-in preserved).
    els.forEach((el) => el.classList.add('visible'));
  }

  // Per-quadrant corner-label reveal. Granular sibling of setCornerLabels —
  // VIEW_3 emits one per quadrant cross click so each label pops in sync
  // with the interface, rather than all four at once. canvasIndex 0..3 maps
  // to container-1..4 (tl/tr/bl/br), matching set-canvas-zoom / set-canvas-text.
  function setCornerLabel(payload) {
    const i = payload?.canvasIndex;
    if (typeof i !== 'number' || i < 0 || i > 3) return;
    const visible = payload?.visible === true;
    const el = document.querySelector(`#container-${i + 1} .corner-label`);
    if (!el) return;
    el.classList.toggle('visible', visible);
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
    if (text) {
      // `variant: 'rotate'` (VIEW_2/VIEW_3 rotating-intro mirror) styles the
      // caption like the interface (bigger + blue-grey stroke); anything else
      // (modes-caption, image-credit) keeps the plain center style.
      el.textContent = text;
      el.classList.toggle('rotate', payload?.variant === 'rotate');
      // `allowSingle` opts this caption past the `:not([data-state="single"])`
      // guard so the explore-others prompt can show while project is in single.
      el.classList.toggle('single-ok', !!payload?.allowSingle);
      el.classList.add('visible');
    } else {
      // Hide by fading opacity ONLY — keep the text + variant class so the
      // text fades OUT visibly (matching the interface caption's leave) over
      // the matching duration, instead of vanishing instantly. The next
      // non-empty caption overwrites the text and resets the variant class.
      el.classList.remove('visible');
    }
  }

  // Single-explore map label — arms/disarms the top-left label that names the
  // auto-cycling map while project is in the explore single view. The label
  // TEXT is owned by stateManager (it knows which map the single cycle is
  // currently showing); this just toggles whether it tracks + shows.
  function setMapLabel(payload) {
    stateManager.setMapLabel(payload?.active === true);
  }

  // Fade path line + glow to invisible over 600 ms (Start over).
  // Opacity is restored to defaults on the next path-clear (boot handshake).
  function pathFadeOut() {
    apps.forEach(a => { if (a.isReady && a.object.fadeOutPath) a.object.fadeOutPath(); });
  }

  // Map-words overlay data — the per-zone "characteristic word" labels for the
  // Form and Source maps in the explore-single view. Empty arrays disarm it.
  function setMapWords(payload) {
    if (mapWords) mapWords.setLabels(payload);
  }

  // Interpretation veil — beige blurred overlay over the four canvases that
  // mirrors interface_nuxt's `.interpret-veil` (shown on the VIEW_4 `+`
  // toggle), so the field recedes behind the centred credit on both screens.
  // Pure DOM/CSS overlay; toggles a class on `#render-veil`. No render-loop
  // or state-machine participation.
  function setCanvasVeil(payload) {
    const active = !!payload?.active;
    const el = document.getElementById('render-veil');
    if (el) el.classList.toggle('visible', active);
    // Flag the body so the structural cross can blur itself (it sits ABOVE
    // the veil, so the veil's backdrop-filter can't blur it — mirrors the
    // interface, where the cross gets its own blur instead of vanishing).
    document.body.dataset.veil = active ? 'on' : '';
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
    if (title || body) {
      // Revealing / replacing — write the new content, then fade it in.
      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.textContent = body;
      el.classList.add('visible');
    } else {
      // Clearing — DON'T wipe textContent here: removing it instantly would
      // hard-cut the glyphs while the (now empty) box fades, which reads as a
      // "speed cut". Just drop `.visible` so the existing text fades out via
      // the opacity transition (same pattern as setCenterCaption). The stale
      // content stays hidden in the DOM until the next reveal overwrites it
      // (`.visible` is only ever re-added together with fresh content above).
      el.classList.remove('visible');
    }
  }

  // Transient perception channel: highlight a single id (or clear with null).
  // No camera move, no state change, no persistence — purely a visual hint.
  function setHighlight(payload) {
    const id = payload && typeof payload.id === 'string' ? payload.id : null;
    apps.forEach(a => {
      if (a.isReady && a.object.highlight) a.object.highlight(id);
    });
  }

  // Persistent multi-highlight: light a set of ids on every canvas (or
  // clear with an empty/missing list). Mirrors `setHighlight`'s shape but
  // persistent and multi-id — used by the overview "circle of images" to
  // light the whole contributed path at once. Pure perception: no camera
  // move, no state change, no path mutation.
  function setMarks(payload) {
    const ids = Array.isArray(payload?.ids) ? payload.ids : [];
    apps.forEach(a => {
      if (a.isReady && a.object.setMarks) a.object.setMarks(ids);
    });
  }

  // Ghost path — transient dashed line on every canvas from `fromId` to
  // `toId`, showing the proximity link between the active central image
  // and whichever related image is currently hovered. Mirrors the shape
  // of `setHighlight`: pure perceptual feedback, no state change, no
  // persistence. Empty / null payload clears (fades out). Apps whose
  // dataset doesn't contain both ids hide the ghost on that canvas.
  function setGhostPath(payload) {
    const fromId = payload && typeof payload.fromId === 'string' ? payload.fromId : null;
    const toId = payload && typeof payload.toId === 'string' ? payload.toId : null;
    apps.forEach(a => {
      if (a.isReady && a.object.setGhostPath) a.object.setGhostPath(fromId, toId);
    });
  }

  // Per-canvas zoom-in: while project is in `overview`, zoom one canvas
  // toward `split`'s cameraZ AND pan its camera onto the given image.
  // Used by VIEW-3's per-quadrant cross flow; each call shifts one of the
  // four canvases from the overview look to a split-like look. After all
  // four are zoomed the standalone visually matches `split` and the next
  // VIEW transition can flip the state-name without any visible change.
  // Per-canvas zoom-in target for VIEW_3 reach-zoom + VIEW_4 quadrant-hover
  // zoom. Slightly less zoomed than the original 0.2. MUST equal STATES.split
  // cameraZ in stateManager.js so VIEW_3 → VIEW_4 flips seamlessly.
  const SPLIT_CAMERA_Z = 0.22;
  function setCanvasZoom(payload) {
    const i = payload?.canvasIndex;
    const id = payload?.imageId;
    if (typeof i !== 'number' || i < 0 || i > 3 || !id) {
      console.warn('[set-canvas-zoom] dropped: bad payload', payload);
      return;
    }
    const app = apps[i];
    // VIEW_3's per-cross zoom defaults to 1.5s (matches goTo's transition
    // pacing). VIEW_4 hover-zoom passes its own slower duration via
    // payload.durationSec so the hover-out / hover-in motions feel
    // deliberate without speeding up the VIEW_3 sequence.
    const ZOOM_DURATION_SEC = typeof payload?.durationSec === 'number' ? payload.durationSec : 1.5;
    stateManager.setCanvasOverride(i, SPLIT_CAMERA_Z, ZOOM_DURATION_SEC);
    // Also switch this canvas's highlight preset to split's `default`. The
    // `big` preset (set by goTo('overview') for the whole field) reads
    // correctly at the overview cameraZ but renders the focused sprite too
    // large / too glowy once the canvas is at split's cameraZ. Per-canvas
    // preset keeps the zoomed canvas visually identical to a real split.
    if (app?.isReady && app.object.setHighlightPreset) {
      // Ease the preset over the same window as the cameraZ tween so the
      // focused sprite doesn't pop in size when the canvas starts re-zooming.
      app.object.setHighlightPreset('default', ZOOM_DURATION_SEC);
    }
    // Direct call to the canvas's focusOn with `pan: true` so the camera
    // actually moves — bypasses the focus-in-overview pan suppression
    // applied by `focusOnId`, since the user explicitly asked for this
    // canvas to zoom onto the selection. `panDuration` matches the
    // cameraZ override so lateral pan + zoom converge together; without it
    // the LERP-based pan would drift for seconds after the zoom completes.
    if (app?.isReady) app.object.focusOn(id, { pan: true, panDuration: ZOOM_DURATION_SEC });
  }

  // Symmetric inverse of `setCanvasZoom` — lift one canvas back to the
  // overview cameraZ + pan its camera to map origin. Drives VIEW_4's
  // hover-unzoom behavior: hovering a quadrant unzooms the other three
  // to show the full map; moving the mouse to the central image (or to
  // another quadrant) re-zooms the canvases that are no longer the
  // hovered one. The override carries `suppressFocusPan: true` so
  // history-nav focus emissions update the perceptual halo (the user
  // still sees where the active image is on the full map) without
  // panning the camera away from origin.
  const OVERVIEW_CAMERA_Z = 3.5;
  function setCanvasOverview(payload) {
    const i = payload?.canvasIndex;
    if (typeof i !== 'number' || i < 0 || i > 3) {
      console.warn('[set-canvas-overview] dropped: bad payload', payload);
      return;
    }
    const app = apps[i];
    // Default 0.6s for any internal callers; VIEW_4 hover-unzoom passes
    // its own slower duration via payload.durationSec to match the
    // hover re-zoom pacing.
    const UNZOOM_DURATION_SEC = typeof payload?.durationSec === 'number' ? payload.durationSec : 0.6;
    stateManager.setCanvasOverride(i, OVERVIEW_CAMERA_Z, UNZOOM_DURATION_SEC, { suppressFocusPan: true });
    if (app?.isReady && app.object.setHighlightPreset) {
      // Ease the preset over the same window as the cameraZ tween so the
      // focused sprite doesn't pop in size when the canvas starts unzooming.
      app.object.setHighlightPreset('big', UNZOOM_DURATION_SEC);
    }
    if (app?.isReady && app.object.setCameraTarget) {
      app.object.setCameraTarget({ x: 0, y: 0, panDuration: UNZOOM_DURATION_SEC });
    }
  }

  return { focusOnId, pickRandomCommonId, setState, startPath, simulatePath, clearPaths, addPathSegment, truncatePath, setMask, setDim, setCanvasBg, setHighlight, setMarks, setGhostPath, setCanvasZoom, setCanvasOverview, setCornerLabels, setCornerLabel, setCanvasText, setCenterCaption, setCanvasVeil, setMapLabel, setMapWords, pathFadeOut };
}
