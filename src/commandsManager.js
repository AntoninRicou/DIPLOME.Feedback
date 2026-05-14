export function createCommandsManager(actions) {
  const handlers = {
    focus(payload) {
      actions.focusOnId(payload?.id);
    },

    'focus-random'() {
      const id = actions.pickRandomCommonId();
      if (id) actions.focusOnId(id);
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
