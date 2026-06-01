const sources = {
    mirror: '/data/mirror.json',
    trace: '/data/umap_book2.json',
    shift: '/data/umap_semantic_llm.json',
    replay: '/data/umap_replay.json',
};

async function loadMapData(mapType) {
    const src = sources[mapType];
    if (!src) {
        throw new Error(`No source registered for mapType "${mapType}"`);
    }
    const res = await fetch(src);
    if (!res.ok) {
        throw new Error(`Failed to load ${src}: ${res.status}`);
    }
    const raw = await res.json();
    return Array.isArray(raw) ? { points: raw } : raw;
}

export { sources, loadMapData };
