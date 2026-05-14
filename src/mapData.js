const sources = {
    form: '/data/umap_subjects.json',
    // mapType: '/path/to/data.json'
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
    return res.json();
}

export { sources, loadMapData };
