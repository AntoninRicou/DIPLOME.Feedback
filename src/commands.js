import { pickRandom as pickRandomColor } from './pathColors.js';

export function createCommands(apps, stateManager, pathPlayer) {
  function focusOnId(pointId) {
    if (!pointId) return;
    console.log('Focusing on', pointId);
    apps.forEach(a => {
      if (a.isReady) a.object.focusOn(pointId);
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

  return { focusOnId, pickRandomCommonId, setState, startPath, simulatePath, clearPaths, addPathSegment, truncatePath, setMask };
}
