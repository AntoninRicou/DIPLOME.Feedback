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
    if (!payload?.name) return;
    stateManager.goTo(payload.name, { duration: payload.duration });
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

  return { focusOnId, pickRandomCommonId, setState, startPath, simulatePath, clearPaths };
}
