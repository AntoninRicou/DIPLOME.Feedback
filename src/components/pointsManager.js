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

function createPointsManager({ scene, data, atlas, atlasTexture, spread = 5, thumbSize = 0.04 }) {
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

    const material = new THREE.ShaderMaterial({
        uniforms: { uAtlas: { value: atlasTexture } },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;

    let missing = 0;
    for (let i = 0; i < count; i++) {
        const p = data.points[i];
        const meta = atlas.images[p.id];
        ids[i] = p.id;
        idToIndex.set(p.id, i);

        const nx = (p.x - minX) / rangeX;
        const ny = (p.y - minY) / rangeY;
        const wx = (nx - 0.5) * spread;
        const wy = (ny - 0.5) * spread;

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

    const HIGHLIGHT_SCALE = 1.6;
    const ACTIVE_GLOW_FACTOR = 2.2;
    let highlighted = -1;

    function updateActiveGlow() {
        if (highlighted < 0) {
            activeGlow.visible = false;
            return;
        }
        const pos = positions[highlighted];
        if (!pos) {
            activeGlow.visible = false;
            return;
        }
        const base = Math.max(pos.sx, pos.sy) || 0.04;
        const size = base * HIGHLIGHT_SCALE * ACTIVE_GLOW_FACTOR;
        activeGlow.position.set(pos.x, pos.y, 0.004);
        activeGlow.scale.set(size, size, 1);
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
        if (highlighted >= 0) setInstance(highlighted, 1, 0);
        const i = idToIndex.has(id) ? idToIndex.get(id) : -1;
        if (i >= 0) setInstance(i, HIGHLIGHT_SCALE, 0.01);
        highlighted = i;
        mesh.instanceMatrix.needsUpdate = true;
        updateActiveGlow();
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
        const scaleMul = i === highlighted ? HIGHLIGHT_SCALE : 1;
        const z = i === highlighted ? 0.01 : 0;
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
        if (disperse.phase === 'burst') {
            disperse.burstElapsed += dt;
            let allDone = true;
            for (let i = 0; i < count; i++) {
                const p = disperse.per[i];
                const raw = (disperse.burstElapsed - p.delay) / p.duration;
                const progress = Math.max(0, Math.min(1, raw));
                if (progress < 1) allDone = false;
                const e = easeOutCubic(progress);
                positions[i].x = p.spawnX * e;
                positions[i].y = p.spawnY * e;
                writeInstance(i);
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (allDone) {
                for (let i = 0; i < count; i++) {
                    disperse.anchor.set(ids[i], { x: positions[i].x, y: positions[i].y });
                }
                disperse.phase = 'drift';
                disperse.driftElapsed = 0;
            }
            return;
        }
        if (disperse.phase === 'drift') {
            disperse.driftElapsed += dt;
            const t = disperse.driftElapsed / disperse.cycleSpeed;
            const wd = disperse.wanderDistance;
            for (let i = 0; i < count; i++) {
                const p = disperse.per[i];
                const a = disperse.anchor.get(ids[i]);
                if (!a) continue;
                const dx = (Math.sin(p.fx1 * t + p.px1) + Math.sin(p.fx2 * t + p.px2) - p.baseX) * wd;
                const dy = (Math.sin(p.fy1 * t + p.py1) + Math.sin(p.fy2 * t + p.py2) - p.baseY) * wd;
                positions[i].x = a.x + dx;
                positions[i].y = a.y + dy;
                writeInstance(i);
            }
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    function tick(dt) {
        if (disperse.active) {
            tickDisperse(dt);
            updateActiveGlow();
            return;
        }
        if (!morphing) return;
        morphT += dt;
        const t = Math.min(1, morphT / morphDuration);
        const e = easeInOutCubic(t);
        for (let i = 0; i < count; i++) {
            positions[i].x = morphStart[i].x + (morphTarget[i].x - morphStart[i].x) * e;
            positions[i].y = morphStart[i].y + (morphTarget[i].y - morphStart[i].y) * e;
            writeInstance(i);
        }
        mesh.instanceMatrix.needsUpdate = true;
        updateActiveGlow();
        if (t >= 1) morphing = false;
    }

    return { mesh, geometry, material, ids, highlight, getPosition, morphTo, tick, enterDisperse, exitDisperse };
}

export { createPointsManager };
