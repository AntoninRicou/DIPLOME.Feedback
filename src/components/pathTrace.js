import * as THREE from 'three';

const DEFAULT_COLOR = 0x88ccff;
const LINE_Z = 0.005;
const GLOW_Z = 0.003;
const GLOW_FACTOR = 2.4;
const GLOW_OPACITY = 0.55;
const GLOW_CAPACITY = 128;

// Ghost path — transient hover-feedback segment from the active central
// image to whichever related image the user is currently hovering. Warm
// beige (matches the system palette — history-strip `.current` step,
// contribute-button bloom) so it reads against both gradient and black
// backdrops. Solid translucent line. Appears instant on hover, fades
// out over ~150ms on hover-leave (driven by GHOST_FADE_RATE).
const GHOST_COLOR = 0xf9ecd0;
const GHOST_OPACITY = 0.6;
const GHOST_FADE_RATE = 16;
const GHOST_Z = 0.004;

const GLOW_VS = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
`;
const GLOW_FS = /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uEdge;
    void main() {
        float d = distance(vUv, vec2(0.5));
        float ring = exp(-pow((d - uEdge) * 9.0, 2.0));
        float fade = 1.0 - smoothstep(0.4, 0.5, d);
        gl_FragColor = vec4(uColor, ring * fade * uOpacity);
    }
`;

export function createPathTrace({ scene, points }) {
    const segments = [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const glowMat = new THREE.ShaderMaterial({
        vertexShader: GLOW_VS,
        fragmentShader: GLOW_FS,
        uniforms: {
            uColor: { value: new THREE.Color(0xffffff) },
            uOpacity: { value: GLOW_OPACITY },
            uEdge: { value: 3.0 / (2.0 * GLOW_FACTOR) },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, GLOW_CAPACITY);
    glowMesh.count = 0;
    glowMesh.frustumCulled = false;
    scene.add(glowMesh);

    const tmpColor = new THREE.Color();
    const dummy = new THREE.Object3D();
    const visited = new Set();

    // Ghost-path mesh — one dashed line segment, hidden until setGhost
    // populates it. Allocated up-front so hover-in is allocation-free.
    const ghostGeometry = new THREE.BufferGeometry();
    ghostGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const ghostMaterial = new THREE.LineBasicMaterial({
        color: GHOST_COLOR,
        transparent: true,
        opacity: 0,
    });
    const ghostMesh = new THREE.Line(ghostGeometry, ghostMaterial);
    ghostMesh.frustumCulled = false;
    ghostMesh.visible = false;
    scene.add(ghostMesh);

    let ghostFromId = null;
    let ghostToId = null;
    let ghostOpacity = 0;
    let ghostTarget = 0;

    // Time-based fallback duration for segments on canvases whose camera
    // pan is suppressed (VIEW_4 hover-unzoom). Roughly matches the LERP
    // pan settle time in split state so panning and non-panning canvases
    // finish drawing the segment around the same wall-clock moment.
    const SEGMENT_DRAW_DURATION = 1.0;

    function addSegment(fromId, toId, color = DEFAULT_COLOR, useTimer = false) {
        if (!fromId || !toId) return;
        if (segments.length > 0) segments[segments.length - 1].progress = 1;
        segments.push({ fromId, toId, color, progress: 0, age: 0, useTimer });
    }

    function truncate(keepCount) {
        const safe = Math.max(0, Math.min(keepCount | 0, segments.length));
        if (safe === segments.length) return;
        segments.length = safe;
        if (segments.length > 0) segments[segments.length - 1].progress = 1;
        visited.clear();
        glowMesh.count = 0;
        glowMesh.instanceMatrix.needsUpdate = true;
    }

    function clear() {
        segments.length = 0;
        visited.clear();
        glowMesh.count = 0;
        glowMesh.instanceMatrix.needsUpdate = true;
        // Also wipe any ghost — boot/reset must leave no stale lines.
        ghostFromId = null;
        ghostToId = null;
        ghostOpacity = 0;
        ghostTarget = 0;
        ghostMaterial.opacity = 0;
        ghostMesh.visible = false;
    }

    function setGhost(fromId, toId) {
        // Empty pair clears — fade out, keep last endpoints so the line
        // fades in place rather than snapping to origin.
        if (!fromId || !toId) {
            ghostTarget = 0;
            return;
        }
        ghostFromId = fromId;
        ghostToId = toId;
        ghostTarget = 1;
        // Instant appear: snap opacity to full so the line is visible on
        // the same frame as the hover. Fade is only used on hover-out.
        ghostOpacity = 1;
        ghostMaterial.opacity = GHOST_OPACITY;
        ghostMesh.visible = true;
    }

    function clearGhost() {
        setGhost(null, null);
    }

    function tick(panProgress = 1, dt = 0) {
        if (segments.length > 0) {
            const last = segments[segments.length - 1];
            if (last.progress < 1) {
                if (last.useTimer) {
                    // Pan-suppressed canvas (VIEW_4 hover-unzoom): the
                    // camera isn't moving, so panProgress is pinned at 1
                    // and can't drive the draw. Animate the segment on
                    // its own clock instead so the line still visibly
                    // reaches the new image.
                    last.age += dt;
                    last.progress = Math.min(1, last.age / SEGMENT_DRAW_DURATION);
                } else {
                    last.progress = panProgress;
                }
            }
        }

        const posBuf = new Float32Array(segments.length * 6);
        const colBuf = new Float32Array(segments.length * 6);
        let n = 0;
        visited.clear();
        for (const s of segments) {
            const a = points.getPosition(s.fromId);
            const b = points.getPosition(s.toId);
            if (!a || !b) continue;
            const t = s.progress;
            const endX = a.x + (b.x - a.x) * t;
            const endY = a.y + (b.y - a.y) * t;
            posBuf[n] = a.x; posBuf[n + 1] = a.y; posBuf[n + 2] = LINE_Z;
            posBuf[n + 3] = endX; posBuf[n + 4] = endY; posBuf[n + 5] = LINE_Z;
            tmpColor.setHex(s.color);
            colBuf[n] = tmpColor.r; colBuf[n + 1] = tmpColor.g; colBuf[n + 2] = tmpColor.b;
            colBuf[n + 3] = tmpColor.r; colBuf[n + 4] = tmpColor.g; colBuf[n + 5] = tmpColor.b;
            n += 6;
            visited.add(s.fromId);
            if (t >= 0.999) visited.add(s.toId);
        }
        const posTrimmed = n === posBuf.length ? posBuf : posBuf.slice(0, n);
        const colTrimmed = n === colBuf.length ? colBuf : colBuf.slice(0, n);
        geometry.setAttribute('position', new THREE.BufferAttribute(posTrimmed, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colTrimmed, 3));
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.computeBoundingSphere();

        let g = 0;
        for (const id of visited) {
            if (g >= GLOW_CAPACITY) break;
            const p = points.getPosition(id);
            if (!p) continue;
            const base = Math.max(p.sx, p.sy) || 0.04;
            const size = base * GLOW_FACTOR;
            dummy.position.set(p.x, p.y, GLOW_Z);
            dummy.scale.set(size, size, 1);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            glowMesh.setMatrixAt(g, dummy.matrix);
            g++;
        }
        glowMesh.count = g;
        glowMesh.instanceMatrix.needsUpdate = true;

        // Ghost-path update. Position tracks the current camera-projected
        // points each tick (the camera may pan or the disperse field may
        // drift while the user is hovering), so the line stays glued to
        // the actual sprite positions.
        if (ghostMesh.visible) {
            const a = ghostFromId ? points.getPosition(ghostFromId) : null;
            const b = ghostToId ? points.getPosition(ghostToId) : null;
            if (a && b) {
                const arr = ghostGeometry.attributes.position.array;
                arr[0] = a.x; arr[1] = a.y; arr[2] = GHOST_Z;
                arr[3] = b.x; arr[4] = b.y; arr[5] = GHOST_Z;
                ghostGeometry.attributes.position.needsUpdate = true;
            } else {
                // One or both endpoints not in this canvas's dataset —
                // hide silently. Apps with mismatched data shouldn't
                // render half-paths.
                ghostMesh.visible = false;
            }
        }
        // Exponential ease toward target opacity. dt-driven so the fade
        // is frame-rate independent; appear is instant (snap in setGhost),
        // disappear is ~150ms at rate 16.
        if (ghostOpacity !== ghostTarget) {
            const k = dt > 0 ? 1 - Math.exp(-GHOST_FADE_RATE * dt) : 1;
            ghostOpacity += (ghostTarget - ghostOpacity) * k;
            ghostMaterial.opacity = ghostOpacity * GHOST_OPACITY;
            if (ghostTarget === 0 && ghostOpacity < 0.01) {
                ghostOpacity = 0;
                ghostMaterial.opacity = 0;
                ghostMesh.visible = false;
                ghostFromId = null;
                ghostToId = null;
            }
        }
    }

    return { addSegment, truncate, clear, tick, setGhost, clearGhost, get count() { return segments.length; } };
}
