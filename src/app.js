import * as THREE from 'three';
import { loadMapData } from './mapData.js';
import { createPointsManager } from './components/pointsManager.js';
import { createPathTrace } from './components/pathTrace.js';

const SPREAD = 5;
const dataCache = new Map();

const easeInOutCubic = t =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function app({ container, id, mapType, state, appIsReady }) {
    console.log("App initialized");
    let canvas, scene, camera, renderer, data, points, pathTrace;
    let targetX = 0, targetY = 0;
    let panStartDist = 0;
    let panProgress = 1;
    // When set, animate() ignores LERP and time-tweens camera.position.{x,y}
    // from `fromX/Y` to `toX/Y` over `duration`. Used by `set-canvas-zoom` so
    // the per-canvas lateral pan finishes in lockstep with the cameraZ tween
    // (instead of LERP's slow exponential tail leaving the camera drifting
    // for seconds after the zoom completes).
    let positionTween = null;
    const LERP = 0.015;
    const { clientWidth: width, clientHeight: height } = container;
    const viewAspect = window.innerWidth / window.innerHeight;


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
        if (pendingHighlightPreset && points.setHighlightPreset) {
            points.setHighlightPreset(pendingHighlightPreset);
        }
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
        if (positionTween) {
            positionTween.t = Math.min(1, positionTween.t + dt / positionTween.duration);
            const e = easeInOutCubic(positionTween.t);
            camera.position.x = positionTween.fromX + (positionTween.toX - positionTween.fromX) * e;
            camera.position.y = positionTween.fromY + (positionTween.toY - positionTween.fromY) * e;
            panProgress = positionTween.t;
            if (positionTween.t >= 1) {
                positionTween = null;
                panStartDist = 0;
            }
        } else {
            camera.position.x += (targetX - camera.position.x) * LERP;
            camera.position.y += (targetY - camera.position.y) * LERP;
            if (panStartDist > 1e-4) {
                const dx = targetX - camera.position.x;
                const dy = targetY - camera.position.y;
                const remaining = Math.hypot(dx, dy);
                panProgress = Math.max(0, Math.min(1, 1 - remaining / panStartDist));
            } else {
                panProgress = 1;
            }
        }
        if (points) points.tick(dt);
        if (pathTrace) pathTrace.tick(panProgress);
        renderer.render(scene, camera);
    }

    function focusOn(pointId, { pan = true, panDuration = 0 } = {}) {
        if (!points) {
            console.log(`[focusOn:${id}] SKIP ${pointId} — points not ready`);
            return;
        }
        const pos = points.getPosition(pointId);
        if (!pos) {
            console.log(`[focusOn:${id}] SKIP ${pointId} — id not in dataset`);
            return;
        }
        // `pan: false` is used to suppress camera motion while keeping the
        // perceptual highlight. Set by `commands.focusOnId` when the active
        // render state is `overview` — overview is read-only on the spatial
        // side, so focus messages must not retarget the camera.
        // `panDuration > 0` opts into a time-based positionTween instead of
        // the LERP-based exponential pan. Used by `set-canvas-zoom` so the
        // lateral pan finishes together with the cameraZ tween — eliminates
        // the post-zoom drift caused by LERP's asymptotic tail.
        if (pan) {
            const prevX = targetX, prevY = targetY;
            targetX = pos.x;
            targetY = pos.y;
            if (panDuration > 0) {
                positionTween = {
                    fromX: camera.position.x,
                    fromY: camera.position.y,
                    toX: pos.x,
                    toY: pos.y,
                    t: 0,
                    duration: panDuration,
                };
                panStartDist = 0;
                panProgress = 0;
            } else {
                positionTween = null;
                panStartDist = Math.hypot(pos.x - camera.position.x, pos.y - camera.position.y);
                panProgress = panStartDist > 1e-4 ? 0 : 1;
            }
            const changed = targetX !== prevX || targetY !== prevY;
            console.log(`[focusOn:${id}] ${pointId} target ${changed ? 'CHANGED' : 'unchanged'} (${prevX.toFixed(3)},${prevY.toFixed(3)}) -> (${targetX.toFixed(3)},${targetY.toFixed(3)}) panDuration=${panDuration}`);
        } else {
            console.log(`[focusOn:${id}] ${pointId} highlight-only (pan suppressed)`);
        }
        // Persistent focus track — the active central image stays glowing
        // until the next focus(id) or a state transition (resetFocus). The
        // transient hover halo (set-highlight) is independent and overlays.
        points.setFocus(pointId);
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

    function truncatePath(keepCount) {
        if (pathTrace) pathTrace.truncate(keepCount);
    }

    function clearPath() {
        if (pathTrace) pathTrace.clear();
    }

    function resetFocus() {
        targetX = 0;
        targetY = 0;
        panStartDist = 0;
        panProgress = 1;
        // Clear both tracks on a state transition so neither the persistent
        // focus glow nor a stale hover halo survives into the new state.
        if (points && points.setFocus) points.setFocus(null);
        if (points && points.setHover) points.setHover(null);
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

    function highlight(pointId) {
        if (points) points.highlight(pointId);
    }

    // Preset can be set by stateManager.goTo before this app's points have
    // finished loading. Cache the latest name; setup() will apply it once
    // points exists, so the preset survives the boot race.
    let pendingHighlightPreset = null;
    function setHighlightPreset(name) {
        pendingHighlightPreset = name;
        if (points && points.setHighlightPreset) points.setHighlightPreset(name);
    }

    let pickingEnabled = false;
    function enablePicking({ onHover, onClick, hoverRadiusPx = 36 } = {}) {
        if (pickingEnabled || !points || !canvas) return;
        pickingEnabled = true;
        let lastHoverIndex = -1;
        const projected = new THREE.Vector3();

        // Screen-space proximity pick. Sprites in `disperse` are tiny and
        // wandering, so pixel-exact raycasting is brittle. We instead pick
        // the nearest sprite within `hoverRadiusPx` of the cursor in screen
        // pixels — generous enough that a fast-moving target stays grabbable.
        function hitInstance(event) {
            if (!points || !points.positions) return -1;
            const rect = canvas.getBoundingClientRect();
            const mx = event.clientX - rect.left;
            const my = event.clientY - rect.top;
            const positions = points.positions;
            const count = positions.length;
            let bestIndex = -1;
            let bestDist = hoverRadiusPx * hoverRadiusPx;
            for (let i = 0; i < count; i++) {
                const p = positions[i];
                if (!p || (p.sx === 0 && p.sy === 0)) continue;
                projected.set(p.x, p.y, 0).project(camera);
                if (projected.z < -1 || projected.z > 1) continue;
                const sx = (projected.x * 0.5 + 0.5) * rect.width;
                const sy = (1 - (projected.y * 0.5 + 0.5)) * rect.height;
                const dx = sx - mx;
                const dy = sy - my;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestDist) {
                    bestDist = d2;
                    bestIndex = i;
                }
            }
            return bestIndex;
        }

        function setHover(i) {
            if (i === lastHoverIndex) return;
            lastHoverIndex = i;
            const id = i >= 0 ? points.ids[i] : null;
            points.highlight(id);
            canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
            if (typeof onHover === 'function') onHover(id);
        }

        canvas.addEventListener('pointermove', (event) => {
            setHover(hitInstance(event));
        });

        canvas.addEventListener('pointerleave', () => {
            setHover(-1);
        });

        canvas.addEventListener('click', () => {
            // Reuse the live hover index rather than re-picking on click.
            // The hover index drives the DOM centered preview, the in-canvas
            // highlight, and the standalone-project halo — keying the click
            // off the same value guarantees the picked id matches what the
            // user is visually pointing at.
            if (lastHoverIndex < 0) return;
            if (typeof onClick === 'function') onClick(points.ids[lastHoverIndex]);
        });
    }

    setup();

    return { animate, focusOn, getIds, addPathSegment, truncatePath, clearPath, resetFocus, resize, setCameraZ, setDriftTarget, morphTo, enterDisperse, exitDisperse, enablePicking, highlight, setHighlightPreset, getPanProgress }
}

export default app;
