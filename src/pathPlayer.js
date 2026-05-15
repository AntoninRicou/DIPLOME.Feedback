export function createPathPlayer({ stepInterval = 1.2 } = {}) {
    let ids = [];
    let cursor = -1;
    let elapsed = 0;
    let running = false;
    const listeners = new Set();

    function emit(prevId, id, index) {
        listeners.forEach(cb => cb({ prevId, id, index, total: ids.length }));
    }

    function start(sequence, opts = {}) {
        if (!Array.isArray(sequence) || sequence.length === 0) return;
        ids = sequence.slice();
        cursor = 0;
        elapsed = 0;
        running = ids.length > 1;
        emit(null, ids[0], 0);
    }

    function stop() {
        running = false;
        cursor = -1;
        ids = [];
        elapsed = 0;
    }

    function tick(dt) {
        if (!running) return;
        elapsed += dt;
        while (elapsed >= stepInterval && cursor < ids.length - 1) {
            elapsed -= stepInterval;
            const prevId = ids[cursor];
            cursor += 1;
            emit(prevId, ids[cursor], cursor);
            if (cursor >= ids.length - 1) {
                running = false;
                break;
            }
        }
    }

    function subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
    }

    return { start, stop, tick, subscribe, get running() { return running; } };
}
