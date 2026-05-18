import * as THREE from 'three';
import { loadMapData } from './mapData.js';
import { createPointsManager } from './components/pointsManager.js';
import { createPathTrace } from './components/pathTrace.js';

const SPREAD = 5;
const dataCache = new Map();

function app({ container, id, mapType, state, appIsReady }) {
    console.log("App initialized");
    let canvas, scene, camera, renderer, data, points, pathTrace;
    let targetX = 0, targetY = 0;
    let panStartDist = 0;
    let panProgress = 1;
    const LERP = 0.015;
    const { clientWidth: width, clientHeight: height } = container;
    const viewAspect = (width && height) ? width / height : 1;


    async function setup() {
        canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        container.appendChild(canvas);
        window.addEventListener('resize', resize);

        createScene();

        const [mapData, atlasMeta, atlasTexture] = await Promise.all([
            loadMapData(mapType),
            fetch('/atlas/atlas.json').then(r => r.json()),
            new THREE.TextureLoader().loadAsync('/atlas/atlas.jpg'),
        ]);

        atlasTexture.flipY = false;
        atlasTexture.colorSpace = THREE.SRGBColorSpace;
        atlasTexture.minFilter = THREE.LinearMipMapLinearFilter;
        atlasTexture.magFilter = THREE.LinearFilter;
        atlasTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        atlasTexture.generateMipmaps = true;

        data = mapData;
        points = createPointsManager({ scene, data, atlas: atlasMeta, atlasTexture, viewAspect, canvasId: id });
        pathTrace = createPathTrace({ scene, points });
        appIsReady(id);
    }

    function createScene() {
        scene = new THREE.Scene();
        scene.background = null;
        camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.z = .2;
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    function resize() {
        const { clientWidth: width, clientHeight: height } = container;
        if (!width || !height || !camera || !renderer) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    }

    function setCameraZ(z) {
        if (!camera) return;
        camera.position.z = z;
    }

    function setDriftTarget(x, y) {
        targetX = x;
        targetY = y;
    }

    function update() { }

    function animate(dt = 0) {
        if (!container.clientWidth || !container.clientHeight) return;
        camera.position.x += (targetX - camera.position.x) * LERP;
        camera.position.y += (targetY - camera.position.y) * LERP;
        if (points) points.tick(dt);
        if (panStartDist > 1e-4) {
            const dx = targetX - camera.position.x;
            const dy = targetY - camera.position.y;
            const remaining = Math.hypot(dx, dy);
            panProgress = Math.max(0, Math.min(1, 1 - remaining / panStartDist));
        } else {
            panProgress = 1;
        }
        if (pathTrace) pathTrace.tick(panProgress);
        renderer.render(scene, camera);
    }

    function focusOn(pointId) {
        if (!points) {
            console.log(`[focusOn:${id}] SKIP ${pointId} — points not ready`);
            return;
        }
        const pos = points.getPosition(pointId);
        if (!pos) {
            console.log(`[focusOn:${id}] SKIP ${pointId} — id not in dataset`);
            return;
        }
        const prevX = targetX, prevY = targetY;
        panStartDist = Math.hypot(pos.x - camera.position.x, pos.y - camera.position.y);
        panProgress = panStartDist > 1e-4 ? 0 : 1;
        targetX = pos.x;
        targetY = pos.y;
        const changed = targetX !== prevX || targetY !== prevY;
        console.log(`[focusOn:${id}] ${pointId} target ${changed ? 'CHANGED' : 'unchanged'} (${prevX.toFixed(3)},${prevY.toFixed(3)}) -> (${targetX.toFixed(3)},${targetY.toFixed(3)}) panStartDist=${panStartDist.toFixed(3)}`);
        points.highlight(pointId);
    }

    function getPanProgress() {
        return panProgress;
    }

    function getIds() {
        return points ? points.ids : [];
    }

    function addPathSegment(fromId, toId, color) {
        if (pathTrace) pathTrace.addSegment(fromId, toId, color);
    }

    function clearPath() {
        if (pathTrace) pathTrace.clear();
    }

    async function morphTo(targetMapType, duration = 1) {
        if (!points) return;
        let other = dataCache.get(targetMapType);
        if (!other) {
            other = await loadMapData(targetMapType);
            dataCache.set(targetMapType, other);
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of other.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const scaleX = (SPREAD * viewAspect) / rangeX;
        const scaleY = SPREAD / rangeY;
        const byId = new Map();
        for (const p of other.points) {
            byId.set(p.id, { x: (p.x - cx) * scaleX, y: (p.y - cy) * scaleY });
        }
        points.morphTo(byId, duration);
    }

    function enterDisperse(opts) {
        if (points) points.enterDisperse(opts);
    }

    function exitDisperse() {
        if (points) points.exitDisperse();
    }

    setup();

    return { animate, focusOn, getIds, addPathSegment, clearPath, resize, setCameraZ, setDriftTarget, morphTo, enterDisperse, exitDisperse, getPanProgress }
}

export default app;
