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
    const LERP = 0.12;
    const { clientWidth: width, clientHeight: height } = container;


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
        points = createPointsManager({ scene, data, atlas: atlasMeta, atlasTexture });
        pathTrace = createPathTrace({ scene, points });
        appIsReady(id);
    }

    function createScene() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0e0e10);
        camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.z = .2;
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
        if (pathTrace) pathTrace.tick();
        renderer.render(scene, camera);
    }

    function focusOn(pointId) {
        if (!points) return;
        const pos = points.getPosition(pointId);
        if (!pos) return;
        targetX = pos.x;
        targetY = pos.y;
        points.highlight(pointId);
    }

    function getIds() {
        return points ? points.ids : [];
    }

    function addPathSegment(fromId, toId) {
        if (pathTrace) pathTrace.addSegment(fromId, toId);
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
        const byId = new Map();
        for (const p of other.points) {
            const nx = (p.x - minX) / rangeX;
            const ny = (p.y - minY) / rangeY;
            byId.set(p.id, { x: (nx - 0.5) * SPREAD, y: (ny - 0.5) * SPREAD });
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

    return { animate, focusOn, getIds, addPathSegment, clearPath, resize, setCameraZ, setDriftTarget, morphTo, enterDisperse, exitDisperse }
}

export default app;
