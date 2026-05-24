const sources = {
    form: '/data/umap_subjects.json',
    projection_2d: '/data/projection_2d.json',
    umap_book: '/data/umap_book2.json',
    umap_subjects_embeddings: '/data/umap_subjects_embeddings2.json',
    umap_random: '/data/umap_replay.json',
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
