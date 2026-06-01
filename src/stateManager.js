const SPREAD = 5;
const CAMERA_FOV_DEG = 75;
const OVERVIEW_Z = SPREAD / (2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360));
const ALL_MAP_TYPES = ['mirror', 'trace', 'shift', 'replay'];
const SINGLE_HOLD = 4;
const SINGLE_MORPH = 1;

const STATES = {
  split: {
    rects: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
    cameraZ: 0.2,
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
    // Clear per-canvas cameraZ overrides — the new state controls all
    // canvases uniformly from here. (Visually a no-op when transitioning
    // overview → split with duration 0, since override target equals
    // split's cameraZ.)
    for (let i = 0; i < canvasOverrides.length; i++) canvasOverrides[i] = null;
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
      singleCurrentMap = host?.mapType ?? 'mirror';
      apps.forEach(a => {
        if (a.isReady && a.object.resetFocus) a.object.resetFocus();
      });
    } else {
      singleActive = false;
      // Restore canvas-1 to its original map; demo cycle may have morphed it away.
      if (host?.isReady && host.object.morphTo && singleCurrentMap && singleCurrentMap !== host.mapType) {
        host.object.morphTo(host.mapType, SINGLE_MORPH);
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
    const choices = ALL_MAP_TYPES.filter(m => m !== singleCurrentMap);
    const next = choices[Math.floor(Math.random() * choices.length)];
    host.object.morphTo(next, SINGLE_MORPH);
    singleCurrentMap = next;
    singleTimer = SINGLE_HOLD + SINGLE_MORPH;
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
    get state() { return currentName; },
    list: () => Object.keys(STATES),
  };
}
