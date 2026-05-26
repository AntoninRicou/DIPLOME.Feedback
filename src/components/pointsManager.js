import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
    attribute vec4 aUvRect;
    varying vec2 vUv;
    void main() {
        vUv = vec2(
            aUvRect.x + uv.x * aUvRect.z,
            aUvRect.y + (1.0 - uv.y) * aUvRect.w
        );
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    precision highp float;
    uniform sampler2D uAtlas;
    varying vec2 vUv;
    void main() {
        gl_FragColor = texture2D(uAtlas, vUv);
    }
`;

function createPointsManager({ scene, data, atlas, atlasTexture, spread = 5, thumbSize = 0.04, viewAspect = 1, canvasId = '?' }) {
    const count = data.points.length;
    const geometry = new THREE.PlaneGeometry(1, 1);

    const uvRect = new Float32Array(count * 4);
    const ids = new Array(count);
    const positions = new Array(count);
    const idToIndex = new Map();
    const dummy = new THREE.Object3D();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
        const p = data.points[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const scaleX = (spread * viewAspect) / rangeX;
    const scaleY = spread / rangeY;

    const material = new THREE.ShaderMaterial({
        uniforms: { uAtlas: { value: atlasTexture } },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    //mesh.visible = false;
    // mesh.frustumCulled = false; cacher

    let missing = 0;
    for (let i = 0; i < count; i++) {
        const p = data.points[i];
        const meta = atlas.images[p.id];
        ids[i] = p.id;
        idToIndex.set(p.id, i);

        const wx = (p.x - cx) * scaleX;
        const wy = (p.y - cy) * scaleY;

        if (!meta) {
            positions[i] = { x: wx, y: wy, sx: 0, sy: 0 };
            dummy.position.set(wx, wy, 0);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            missing++;
            continue;
        }

        const aspect = meta.aspect || 1;
        const sx = aspect >= 1 ? thumbSize : thumbSize * aspect;
        const sy = aspect >= 1 ? thumbSize / aspect : thumbSize;

        positions[i] = { x: wx, y: wy, sx, sy };
        dummy.position.set(wx, wy, 0);
        dummy.scale.set(sx, sy, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        uvRect[i * 4 + 0] = meta.imgU;
        uvRect[i * 4 + 1] = meta.imgV;
        uvRect[i * 4 + 2] = meta.imgUSize;
        uvRect[i * 4 + 3] = meta.imgVSize;
    }

    geometry.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(uvRect, 4));
    mesh.instanceMatrix.needsUpdate = true;

    if (missing) console.warn(`pointsManager: ${missing} points have no atlas entry`);

    scene.add(mesh);

    const GLOW_VS = /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    const GLOW_FS = /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
            float d = distance(vUv, vec2(0.5));
            float a = pow(1.0 - smoothstep(0.0, 0.5, d), 1.6);
            gl_FragColor = vec4(uColor, a * uOpacity);
        }
    `;

    const activeGlowMat = new THREE.ShaderMaterial({
        vertexShader: GLOW_VS,
        fragmentShader: GLOW_FS,
        uniforms: {
            uColor: { value: new THREE.Color(0xffffff) },
            uOpacity: { value: 1.0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const activeGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), activeGlowMat);
    activeGlow.visible = false;
    activeGlow.frustumCulled = false;
    scene.add(activeGlow);

    // Highlight presets per render state. Far-camera states (single, overview,
    // disperse) need the bigger preset because sprites are tiny on screen;
    // the close-camera split state reads fine with the original default
    // values. The active preset is driven by `setHighlightPreset(name)`,
    // which `stateManager.goTo` calls on every transition.
    const HIGHLIGHT_PRESETS = {
        default: { scale: 1.6, glow: 2.2 },
        big: { scale: 3.4, glow: 5.0 },
    };
    let activeHighlightScale = HIGHLIGHT_PRESETS.default.scale;
    let activeGlowFactor = HIGHLIGHT_PRESETS.default.glow;

    function setHighlightPreset(name) {
        const preset = HIGHLIGHT_PRESETS[name] || HIGHLIGHT_PRESETS.default;
        activeHighlightScale = preset.scale;
        activeGlowFactor = preset.glow;
    }
    // Time constant for the per-instance eased highlight transition. Higher
    // = faster (e.g. 8 reaches ~95% in ~375ms, 10 in ~300ms). Frame-rate
    // independent — applied via `1 - exp(-rate*dt)` inside the tick. Shared
    // across presets — only the magnitude differs by state, not the easing.
    const HIGHLIGHT_RATE = 9;
    // Per-instance highlight progress [0..1], lerped toward `highlightTargetT`.
    // 0 = un-highlighted (scale=1), 1 = fully highlighted (scale=HIGHLIGHT_SCALE).
    const highlightT = new Float32Array(count);
    const highlightTargetT = new Float32Array(count);
    // Only the in-flight indices get ticked each frame.
    const activeHighlights = new Set();
    // The currently-hovered instance (or -1). `lastPrimaryIndex` keeps the
    // glow anchored at the previous hover during its fade-out.
    let primaryHighlightIndex = -1;
    let lastPrimaryIndex = -1;

    function updateActiveGlow() {
        const anchorIndex = primaryHighlightIndex >= 0 ? primaryHighlightIndex : lastPrimaryIndex;
        if (anchorIndex < 0) {
            activeGlow.visible = false;
            return;
        }
        const v = highlightT[anchorIndex];
        if (v < 0.001) {
            activeGlow.visible = false;
            return;
        }
        const pos = positions[anchorIndex];
        if (!pos) {
            activeGlow.visible = false;
            return;
        }
        const e = easeInOutCubic(v);
        const base = Math.max(pos.sx, pos.sy) || 0.04;
        const size = base * activeHighlightScale * activeGlowFactor;
        activeGlow.position.set(pos.x, pos.y, 0.004);
        activeGlow.scale.set(size * e, size * e, 1);
        activeGlow.material.uniforms.uOpacity.value = e;
        activeGlow.visible = true;
    }

    const morphStart = positions.map(p => ({ x: p.x, y: p.y }));
    const morphTarget = positions.map(p => ({ x: p.x, y: p.y }));
    let morphT = 0;
    let morphDuration = 0;
    let morphing = false;

    const easeInOutCubic = t =>
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function setInstance(i, scaleMul, z) {
        const pos = positions[i];
        if (!pos) return;
        dummy.position.set(pos.x, pos.y, z);
        dummy.scale.set(pos.sx * scaleMul, pos.sy * scaleMul, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }

    function highlight(id) {
        const newIndex = id == null ? -1 : (idToIndex.has(id) ? idToIndex.get(id) : -1);
        if (newIndex === primaryHighlightIndex) return;
        // Previous primary (if any) starts easing back to 0.
        if (primaryHighlightIndex >= 0) {
            highlightTargetT[primaryHighlightIndex] = 0;
            activeHighlights.add(primaryHighlightIndex);
            lastPrimaryIndex = primaryHighlightIndex;
        }
        // New primary (if any) starts easing in to 1.
        if (newIndex >= 0) {
            highlightTargetT[newIndex] = 1;
            activeHighlights.add(newIndex);
        }
        primaryHighlightIndex = newIndex;
        const status = newIndex < 0 ? (id == null ? 'CLEARED' : 'NOT_FOUND') : 'CHANGED';
        console.log(`[highlight:${canvasId}] ${id} -> index ${newIndex} ${status}`);
    }

    function tickHighlights(dt) {
        if (activeHighlights.size === 0) return;
        const k = 1 - Math.exp(-HIGHLIGHT_RATE * dt);
        const toRemove = [];
        for (const i of activeHighlights) {
            const target = highlightTargetT[i];
            let v = highlightT[i] + (target - highlightT[i]) * k;
            if (Math.abs(v - target) < 0.0008) v = target;
            highlightT[i] = v;
            writeInstance(i);
            if (v === target && target === 0) toRemove.push(i);
        }
        for (const i of toRemove) activeHighlights.delete(i);
        mesh.instanceMatrix.needsUpdate = true;
    }

    function getPosition(id) {
        const i = idToIndex.get(id);
        return i == null ? null : positions[i];
    }

    function morphTo(positionsById, duration = 1) {
        for (let i = 0; i < count; i++) {
            morphStart[i].x = positions[i].x;
            morphStart[i].y = positions[i].y;
            const tp = positionsById.get(ids[i]);
            if (tp) {
                morphTarget[i].x = tp.x;
                morphTarget[i].y = tp.y;
            } else {
                morphTarget[i].x = positions[i].x;
                morphTarget[i].y = positions[i].y;
            }
        }
        morphT = 0;
        morphDuration = Math.max(0.001, duration);
        morphing = true;
    }

    const disperse = {
        active: false,
        phase: 'idle',
        burstElapsed: 0,
        driftElapsed: 0,
        cycleSpeed: 15,
        wanderDistance: 0.8,
        restore: new Map(),
        anchor: new Map(),
        per: [],
    };

    const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

    function writeInstance(i) {
        const e = easeInOutCubic(highlightT[i]);
        const scaleMul = 1 + (activeHighlightScale - 1) * e;
        const z = 0.01 * e;
        setInstance(i, scaleMul, z);
    }

    function enterDisperse({ rMax = 2.0, cycleSpeed = 15, wanderDistance = 0.8 } = {}) {
        morphing = false;
        disperse.active = true;
        disperse.phase = 'burst';
        disperse.burstElapsed = 0;
        disperse.driftElapsed = 0;
        disperse.cycleSpeed = cycleSpeed;
        disperse.wanderDistance = wanderDistance;
        disperse.restore = new Map();
        disperse.anchor = new Map();
        disperse.per = new Array(count);

        for (let i = 0; i < count; i++) {
            const id = ids[i];
            disperse.restore.set(`restore:${id}`, { x: positions[i].x, y: positions[i].y });

            const angle = Math.random() * Math.PI * 2;
            const r = rMax * Math.sqrt(Math.random());
            const spawnX = Math.cos(angle) * r;
            const spawnY = Math.sin(angle) * r;

            const fx1 = 0.5 + Math.random() * 1.5;
            const fx2 = 0.5 + Math.random() * 1.5;
            const px1 = Math.random() * Math.PI * 2;
            const px2 = Math.random() * Math.PI * 2;
            const fy1 = 0.5 + Math.random() * 1.5;
            const fy2 = 0.5 + Math.random() * 1.5;
            const py1 = Math.random() * Math.PI * 2;
            const py2 = Math.random() * Math.PI * 2;

            const baseX = Math.sin(px1) + Math.sin(px2);
            const baseY = Math.sin(py1) + Math.sin(py2);

            const delay = Math.random() * 0.14;
            const duration = 0.42 + Math.random() * 0.22;

            disperse.per[i] = {
                spawnX, spawnY, delay, duration,
                fx1, fx2, px1, px2, fy1, fy2, py1, py2,
                baseX, baseY,
            };

            positions[i].x = 0;
            positions[i].y = 0;
            writeInstance(i);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    function exitDisperse() {
        if (!disperse.active) return;
        disperse.active = false;
        disperse.phase = 'idle';
        for (let i = 0; i < count; i++) {
            const r = disperse.restore.get(`restore:${ids[i]}`);
            if (!r) continue;
            positions[i].x = r.x;
            positions[i].y = r.y;
            writeInstance(i);
        }
        mesh.instanceMatrix.needsUpdate = true;
        disperse.restore.clear();
        disperse.anchor.clear();
        disperse.per = [];
    }

    function tickDisperse(dt) {
        // Per-sprite burst↔drift dispatch: each sprite transitions to drift
        // the moment ITS OWN burst completes, with no global synchronization
        // gate. Avoids the "every sprite halts together while waiting for the
        // slowest, then every sprite resumes together" freeze frame that a
        // single phase switch produced. `disperse.burstElapsed` is the shared
        // time origin (start of enterDisperse); each sprite's `delay` and
        // `duration` define its individual burst window.
        disperse.burstElapsed += dt;
        const FADE_IN_SEC = 0.6;

        for (let i = 0; i < count; i++) {
            const p = disperse.per[i];
            const sinceStart = disperse.burstElapsed - p.delay;
            const burstProgress = Math.max(0, Math.min(1, sinceStart / p.duration));

            if (burstProgress < 1) {
                // Burst — unchanged from before. easeOutCubic to spawn position.
                const e = easeOutCubic(burstProgress);
                positions[i].x = p.spawnX * e;
                positions[i].y = p.spawnY * e;
                writeInstance(i);
                continue;
            }

            // Drift — this sprite has reached its spawn position. Anchor is
            // set lazily on the first drift frame so the global anchor sweep
            // (previously done when `phase` flipped) is no longer needed.
            let a = disperse.anchor.get(ids[i]);
            if (!a) {
                a = { x: p.spawnX, y: p.spawnY };
                disperse.anchor.set(ids[i], a);
            }

            // Per-sprite drift time + per-sprite fade-in. Amplitude ramps 0→1
            // over FADE_IN_SEC so drift velocity grows continuously from the
            // burst's zero-end velocity. Once past fade-in, drift is identical
            // to the steady-state behavior (wd = disperse.wanderDistance).
            const sinceBurstEnd = sinceStart - p.duration;
            const t = sinceBurstEnd / disperse.cycleSpeed;
            const fadeIn = Math.min(1, sinceBurstEnd / FADE_IN_SEC);
            const wd = disperse.wanderDistance * fadeIn;
            const dx = (Math.sin(p.fx1 * t + p.px1) + Math.sin(p.fx2 * t + p.px2) - p.baseX) * wd;
            const dy = (Math.sin(p.fy1 * t + p.py1) + Math.sin(p.fy2 * t + p.py2) - p.baseY) * wd;

            if (i === primaryHighlightIndex) {
                // Hover freeze: keep `positions[i]` exactly where it is so
                // the cursor doesn't lose the sprite mid-hover. The drift
                // identity `position = anchor + (dx, dy)` is preserved by
                // continuously back-solving the anchor — when the user
                // moves off, drift resumes from this position with no jump.
                a.x = positions[i].x - dx;
                a.y = positions[i].y - dy;
                writeInstance(i);
                continue;
            }

            positions[i].x = a.x + dx;
            positions[i].y = a.y + dy;
            writeInstance(i);
        }

        mesh.instanceMatrix.needsUpdate = true;
    }

    function tick(dt) {
        if (disperse.active) {
            tickDisperse(dt);
        } else if (morphing) {
            morphT += dt;
            const t = Math.min(1, morphT / morphDuration);
            const e = easeInOutCubic(t);
            for (let i = 0; i < count; i++) {
                positions[i].x = morphStart[i].x + (morphTarget[i].x - morphStart[i].x) * e;
                positions[i].y = morphStart[i].y + (morphTarget[i].y - morphStart[i].y) * e;
                writeInstance(i);
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (t >= 1) morphing = false;
        }
        // Always: advance the eased per-instance highlight transitions and
        // refresh the glow. Runs regardless of disperse/morph state so hover
        // animations are responsive in `single`, `split`, `overview` too.
        tickHighlights(dt);
        updateActiveGlow();
    }

    return { mesh, geometry, material, ids, positions, highlight, setHighlightPreset, getPosition, morphTo, tick, enterDisperse, exitDisperse };
}

export { createPointsManager };
