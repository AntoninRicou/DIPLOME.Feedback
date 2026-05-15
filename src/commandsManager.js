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
