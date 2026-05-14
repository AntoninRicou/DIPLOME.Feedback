export function createCommands(apps) {
  function focusOnId(pointId) {
    if (!pointId) return;
    console.log('Focusing on', pointId);
    apps.forEach(a => {
      if (a.isReady) a.object.focusOn(pointId);
    });
  }

  function pickRandomCommonId() {
    const ready = apps.filter(a => a.isReady);
    if (ready.length === 0) return null;
    const sets = ready.map(a => new Set(a.object.getIds()));
    const [first, ...rest] = sets;
    const common = [...first].filter(id => rest.every(s => s.has(id)));
    if (common.length === 0) {
      console.warn('No ids in common across datasets');
      return null;
    }
    return common[Math.floor(Math.random() * common.length)];
  }

  return { focusOnId, pickRandomCommonId };
}
