const SPREAD = 5;
const CAMERA_FOV_DEG = 75;
// Distance at which the SPREAD field exactly fills the camera frustum
// edge-to-edge (no margin).
const OVERVIEW_FIT_Z = SPREAD / (2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360));
// Overview/grid camera distance: pulled back ~8% from the exact fit so each
// map has a bit of breathing-room margin instead of sticking to its canvas
// edges — matching the `single` view's feel (single sits at cameraZ 3.5, also
// a touch back from the ~3.26 fit distance). Tune the 1.08 for more/less margin.
const OVERVIEW_Z = OVERVIEW_FIT_Z * 1.08;
const ALL_MAP_TYPES = ['source', 'form', 'semantic', 'time'];
const MAP_LABELS = { source: 'Source', form: 'Form', semantic: 'Semantic', time: 'Time' };
const SINGLE_HOLD = 5.5;
const SINGLE_MORPH = 1;

const STATES = {
  split: {
    rects: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
    // Split/zoomed-in camera distance. Slightly LESS zoomed than the original
    // 0.2 (camera a touch further back). Must stay equal to SPLIT_CAMERA_Z in
    // commands.js (the VIEW_3 reach-zoom + VIEW_4 hover-zoom target) so the
    // VIEW_3 → VIEW_4 state flip is seamless (no jump when overrides clear).
    cameraZ: 0.22,
    drift: { mode: 'none', amplitude: 0 },
  },
  single: {
    rects: [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ],
    cameraZ: 3.5,
    drift: { mode: 'none', amplitude: 0 },
  },
  overview: {
    rects: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
    cameraZ: OVERVIEW_Z,
    drift: { mode: 'none', amplitude: 0 },
  },
  disperse: {
    rects: [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
    ],
    cameraZ: 3.5,
    drift: { mode: 'none', amplitude: 0 },
  },
};

function clone(s) {
  return {
    rects: s.rects.map(r => ({ ...r })),
    cameraZ: s.cameraZ,
    drift: { ...s.drift },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

const lerpRect = (a, b, t) => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
});

const easeInOutCubic = t =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function createStateManager({ containers, getApps, initial = 'single' }) {
  let current = clone(STATES[initial]);
  let transition = null;
  let currentName = initial;
  let driftTargets = null;
  let singleActive = false;
  let singleTimer = 0;
  let singleCurrentMap = null;
  let mapLabelActive = false; // armed by set-map-label directive

  // Per-canvas cameraZ overrides. When `set-canvas-zoom` fires for one
  // canvas, that canvas's cameraZ is interpolated from the current state's
  // cameraZ to a target value, independent of the other canvases. Used by
  // VIEW-3's per-quadrant zoom-in flow: clicking each quadrant's cross
  // zooms only that canvas, so the standalone visually transitions from
  // overview to split one canvas at a time. Overrides are cleared on any
  // `goTo` — the next state takes over uniformly.
  const canvasOverrides = [null, null, null, null];

  function applyLayoutToContainers() {
    containers.forEach((c, i) => {
      const r = current.rects[i];
      c.style.left = (r.x * 100) + '%';
      c.style.top = (r.y * 100) + '%';
      c.style.width = (r.w * 100) + '%';
      c.style.height = (r.h * 100) + '%';
    });
    document.body.dataset.state = currentName;
  }

  function goTo(name, { duration = 1.5 } = {}) {
    if (!STATES[name]) {
      console.warn(
        `[state] unknown state "${name}" — known: ${Object.keys(STATES).join(', ')}`,
      );
      return;
    }
    if (name === 'disperse' && currentName === 'single') {
      console.warn('[state] disperse blocked while in single');
      return;
    }
    console.log(`[state] goTo ${currentName} -> ${name}`);
    transition = {
      from: clone(current),
      to: clone(STATES[name]),
      t: 0,
      duration: Math.max(0.01, duration),
    };
    current.drift = { ...STATES[name].drift };
    currentName = name;
    driftTargets = null;
    // Per-canvas cameraZ overrides.
    //
    // For `overview` we KEEP per-canvas continuity instead of clearing.
    // split and overview share identical rects — the only difference is
    // cameraZ — so the overview finale is purely a zoom change. VIEW_4's
    // hover-zoom has left the four canvases at DIFFERENT zoom levels at
    // confirm time (typically one still zoomed in, the rest already pushed
    // out to the overview cameraZ via per-canvas overrides). Clearing the
    // overrides and lerping the single state-level cameraZ from split's 0.2
    // would snap the already-zoomed-out canvases back IN before zooming them
    // all out together — the jarring "zoom somewhere then zoom out" finale.
    //
    // Instead, retarget every canvas from its CURRENT actual z (mid-tween
    // included) straight to the overview cameraZ. setCanvasOverride computes
    // its `fromZ` from the live eased position of any in-flight override (or
    // current.cameraZ when none), so each canvas continues smoothly from
    // wherever it is: canvases already at overview barely move, and only the
    // still-zoomed-in one(s) actually zoom out. The state-level cameraZ tween
    // still runs underneath and lands on the same value, keeping the post-
    // transition state consistent (overview is terminal/read-only anyway).
    //
    // Every other state controls all canvases uniformly, so clear overrides.
    if (name === 'overview') {
      const targetZ = STATES.overview.cameraZ;
      for (let i = 0; i < canvasOverrides.length; i++) {
        setCanvasOverride(i, targetZ, transition.duration);
      }
    } else {
      for (let i = 0; i < canvasOverrides.length; i++) canvasOverrides[i] = null;
    }
    const apps = getApps();
    const host = apps[0];

    // Pick the hover highlight preset per state. Far-camera states (single,
    // overview, disperse) need the louder preset to read against zoomed-out
    // sprites; split's close camera reads fine with the default. Not gated
    // on `isReady` — apps that haven't finished loading cache the preset
    // and apply it once their pointsManager exists.
    const highlightPreset = name === 'split' ? 'default' : 'big';
    apps.forEach(a => {
      if (a.object.setHighlightPreset) a.object.setHighlightPreset(highlightPreset);
    });

    if (name === 'single') {
      singleActive = true;
      singleTimer = SINGLE_HOLD;
      // Snap canvas-1 back to its canonical map if a previous single cycle left
      // it displaying a different one. This fires when single is RE-entered while
      // the canvas is already showing a cycled map — e.g. an interface_nuxt
      // refresh re-emits set-state('single') while the standalone has been
      // cycling and is mid-rotation. Without this, the tracker resets to
      // host.mapType (source) but the points stay on the stale cycled map, so
      // canvas-1 shows a non-source map on refresh. Instant (duration 0):
      // cleanup, not a designed visual — mirrors the leave-single restore below.
      // Skipped on first boot (singleCurrentMap === null → canvas already on source).
      if (host?.isReady && host.object.morphTo && singleCurrentMap && singleCurrentMap !== host.mapType) {
        host.object.morphTo(host.mapType, 0);
      }
      singleCurrentMap = host?.mapType ?? 'form';
      updateMapLabel();
      apps.forEach(a => {
        if (a.isReady && a.object.resetFocus) a.object.resetFocus();
      });
    } else {
      singleActive = false;
      // Leaving single hides the explore map label (visibility requires
      // singleActive). The directive intent (mapLabelActive) is left as-is;
      // boot/reconnect clears it via setMapLabel(false).
      updateMapLabel();
      // Restore canvas-1 to its original map; the single-state demo cycle may
      // have morphed it away. Snap INSTANTLY (duration 0): this restore is a
      // cleanup, not a designed visual, and every single → other transition
      // runs behind the render mask. A timed (SINGLE_MORPH = 1 s) morph here
      // leaked past the VIEW_1 → VIEW_2 hidden-morph reveal — the points were
      // still flying to their canonical positions when the mask lifted, which
      // read as an intermittent "jump".
      //
      // UNCONDITIONAL (no `singleCurrentMap !== host.mapType` guard): a guarded
      // snap skipped the case where the cycle was mid-morph BACK TO the
      // canonical map (singleCurrentMap already === host.mapType) — the points
      // were still drifting toward it when the mask lifted. morphTo(_, 0) snaps
      // within a frame and cancels any in-flight cycle morph, so the map is
      // dead-steady the instant the grid is revealed. A no-op when already
      // settled on the canonical map.
      if (host?.isReady && host.object.morphTo) {
        host.object.morphTo(host.mapType, 0);
        singleCurrentMap = host.mapType;
      }
    }

    if (name === 'disperse') {
      if (host?.isReady && host.object.enterDisperse) host.object.enterDisperse();
    } else {
      if (host?.isReady && host.object.exitDisperse) host.object.exitDisperse();
    }

    if (name === 'overview') {
      apps.forEach(a => {
        if (a.isReady) a.object.setDriftTarget(0, 0);
      });
    }
  }

  function tickSingleCycle(dt) {
    if (!singleActive || transition) return;
    singleTimer -= dt;
    if (singleTimer > 0) return;
    const apps = getApps();
    const host = apps[0];
    if (!host || !host.isReady || !host.object.morphTo) {
      singleTimer = 0.5;
      return;
    }
    const currentIndex = ALL_MAP_TYPES.indexOf(singleCurrentMap);
    const next = ALL_MAP_TYPES[(currentIndex + 1) % ALL_MAP_TYPES.length];
    host.object.morphTo(next, SINGLE_MORPH);
    singleCurrentMap = next;
    updateMapLabel();
    singleTimer = SINGLE_HOLD + SINGLE_MORPH;
  }

  // Explore-map-label — shows the current cycling map name top-left.
  // The element (#explore-map-label) carries class="explore-map-label" from
  // HTML so base styles always apply; this only toggles `.visible`.
  function updateMapLabel() {
    const el = document.getElementById('explore-map-label');
    if (!el) return;
    if (mapLabelActive && singleActive) {
      el.textContent = MAP_LABELS[singleCurrentMap] ?? '';
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  function setMapLabel(active) {
    mapLabelActive = active === true;
    updateMapLabel();
  }

  function randomTarget() {
    const amp = current.drift.amplitude;
    return {
      x: (Math.random() - 0.5) * 2 * amp,
      y: (Math.random() - 0.5) * 2 * amp,
      timer: 3 + Math.random() * 4,
    };
  }

  function applyDrift(dt) {
    if (current.drift.mode !== 'wander') return;
    const apps = getApps();
    if (!driftTargets || driftTargets.length !== apps.length) {
      driftTargets = apps.map(() => randomTarget());
    }
    apps.forEach((a, i) => {
      if (!a.isReady) return;
      let t = driftTargets[i];
      t.timer -= dt;
      if (t.timer <= 0) {
        driftTargets[i] = randomTarget();
        t = driftTargets[i];
      }
      a.object.setDriftTarget(t.x, t.y);
    });
  }

  function tick(dt) {
    let layoutChanged = false;
    if (transition) {
      transition.t += dt / transition.duration;
      const t = Math.min(1, transition.t);
      const e = easeInOutCubic(t);
      for (let i = 0; i < 4; i++) {
        current.rects[i] = lerpRect(transition.from.rects[i], transition.to.rects[i], e);
      }
      current.cameraZ = lerp(transition.from.cameraZ, transition.to.cameraZ, e);
      applyLayoutToContainers();
      layoutChanged = true;
      if (t >= 1) transition = null;
    }

    const apps = getApps();
    apps.forEach((a, i) => {
      if (!a.isReady) return;
      if (layoutChanged) a.object.resize();
      let z = current.cameraZ;
      const override = canvasOverrides[i];
      if (override) {
        override.t = Math.min(1, override.t + dt / override.duration);
        const e = easeInOutCubic(override.t);
        z = override.fromZ + (override.toZ - override.fromZ) * e;
      }
      a.object.setCameraZ(z);
    });

    applyDrift(dt);
    tickSingleCycle(dt);
  }

  function setCanvasOverride(canvasIndex, targetZ, duration = 0.6, opts = {}) {
    if (canvasIndex < 0 || canvasIndex >= canvasOverrides.length) return;
    // Start tween from the current *interpolated* cameraZ. With no prior
    // override, that's the state-level value. With one in flight, compute
    // the eased position instead of using `prev.toZ` — otherwise replacing
    // a mid-flight tween (e.g. rapid VIEW_4 hover changes) snaps cameraZ
    // back to the previous tween's target before animating to the new one.
    const prev = canvasOverrides[canvasIndex];
    let fromZ;
    if (prev) {
      const e = easeInOutCubic(prev.t);
      fromZ = prev.fromZ + (prev.toZ - prev.fromZ) * e;
    } else {
      fromZ = current.cameraZ;
    }
    canvasOverrides[canvasIndex] = {
      fromZ,
      toZ: targetZ,
      t: 0,
      duration: Math.max(0.001, duration),
      // VIEW_4 hover-unzoom needs `focus(id)` arrivals from history nav
      // to update the perceptual halo without panning the camera of an
      // unzoomed canvas. The flag persists past tween completion (the
      // override record stays pinned at `toZ`), so subsequent focus
      // emissions consult the latest setter's intent.
      suppressFocusPan: opts.suppressFocusPan === true,
    };
  }

  function shouldPanCanvas(canvasIndex) {
    const o = canvasOverrides[canvasIndex];
    return !(o && o.suppressFocusPan);
  }

  return {
    init: applyLayoutToContainers,
    tick,
    goTo,
    setCanvasOverride,
    shouldPanCanvas,
    setMapLabel,
    get state() { return currentName; },
    // The map currently shown by the single-view host canvas (cycles in single).
    get singleMap() { return singleCurrentMap; },
    // True when the single view is on a fully-settled map: in single, no
    // state/layout transition, and outside the per-cycle point-morph window
    // (the cycle sets singleTimer to SINGLE_HOLD + SINGLE_MORPH when it fires,
    // so the map is morphing while singleTimer > SINGLE_HOLD, then settled
    // through the hold). Drives the map-words overlay so labels only place +
    // show once their sprites have stopped moving.
    get singleSettled() {
      return singleActive && !transition && singleTimer <= SINGLE_HOLD;
    },
    list: () => Object.keys(STATES),
  };
}
