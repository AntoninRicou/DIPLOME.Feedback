export function createPathPlayer({
    stepInterval = 1.2,
    dwellTime = 0.8,
    arriveThreshold = 0.92,
    maxStepWait = 6,
    isSettled = () => true,
} = {}) {
    let ids = [];
    let cursor = -1;
    let elapsed = 0;
    let sinceArrived = 0;
    let waitingForArrival = false;
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
        sinceArrived = 0;
        waitingForArrival = true;
        running = ids.length > 1;
        emit(null, ids[0], 0);
    }

    function stop() {
        running = false;
        cursor = -1;
        ids = [];
        elapsed = 0;
        sinceArrived = 0;
        waitingForArrival = false;
    }

    function advance() {
        const prevId = ids[cursor];
        cursor += 1;
        emit(prevId, ids[cursor], cursor);
        elapsed = 0;
        sinceArrived = 0;
        waitingForArrival = true;
        if (cursor >= ids.length - 1) running = false;
    }

    function tick(dt) {
        if (!running) return;
        elapsed += dt;

        if (waitingForArrival) {
            if (isSettled(arriveThreshold) || elapsed >= maxStepWait) {
                waitingForArrival = false;
                sinceArrived = 0;
            } else {
                return;
            }
        }

        sinceArrived += dt;
        if (sinceArrived < dwellTime) return;
        if (elapsed < stepInterval) return;
        if (cursor < ids.length - 1) advance();
    }

    function subscribe(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
    }

    return { start, stop, tick, subscribe, get running() { return running; } };
}
