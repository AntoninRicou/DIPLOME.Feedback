export function createCommandsManager(actions) {
  const handlers = {
    focus(payload) {
      actions.focusOnId(payload?.id);
    },

    'focus-random'() {
      const id = actions.pickRandomCommonId();
      if (id) actions.focusOnId(id);
    },

    'set-state'(payload) {
      actions.setState(payload);
    },

    'path-simulate'(payload) {
      actions.simulatePath(payload?.count ?? 10);
    },

    'path-start'(payload) {
      actions.startPath(payload?.ids);
    },

    'path-clear'() {
      actions.clearPaths();
    },

    'path-segment'(payload) {
      actions.addPathSegment(payload?.fromId, payload?.toId);
    },

    'path-truncate'(payload) {
      if (typeof payload?.keepCount !== 'number') return;
      actions.truncatePath(payload.keepCount);
    },

    'set-mask'(payload) {
      actions.setMask(payload);
    },

    'set-canvas-bg'(payload) {
      actions.setCanvasBg(payload);
    },

    'set-highlight'(payload) {
      actions.setHighlight(payload);
    },

    'set-marks'(payload) {
      actions.setMarks(payload);
    },

    'set-ghost-path'(payload) {
      actions.setGhostPath(payload);
    },

    'set-canvas-zoom'(payload) {
      actions.setCanvasZoom(payload);
    },

    'set-canvas-overview'(payload) {
      actions.setCanvasOverview(payload);
    },

    'set-corner-labels'(payload) {
      actions.setCornerLabels(payload);
    },

    'set-canvas-text'(payload) {
      actions.setCanvasText(payload);
    },

    'set-center-caption'(payload) {
      actions.setCenterCaption(payload);
    },
  };

  return {
    register(on) {
      for (const [type, handler] of Object.entries(handlers)) {
        on(type, handler);
      }
    },
    run(type, payload) {
      return handlers[type]?.(payload);
    },
    list() {
      return Object.keys(handlers);
    },
  };
}
