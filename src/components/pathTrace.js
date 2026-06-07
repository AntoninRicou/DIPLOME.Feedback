import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

const DEFAULT_COLOR = 0x88ccff;
const LINE_Z = 0.005;
// Core path line thickness in CSS pixels. Plain WebGL lines ignore linewidth
// on most desktop GPUs (clamped to 1px), so the path core is drawn with a
// fat-line material (LineSegments2) whose width this controls. Bump for a
// thicker path. The white glow trail (below) is independent and unchanged.
const PATH_LINEWIDTH = 1.6;
const GLOW_Z = 0.003;
const GLOW_FACTOR = 2.4;
const GLOW_OPACITY = 0.55;
const GLOW_CAPACITY = 128;
// White glow trail recoloured to warm beige (the "white path" → f9ecd0).
const GLOW_COLOR = 0xf9ecd0;

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
    // Fat-line core (LineSegments2) so the path thickness (PATH_LINEWIDTH) is
    // honoured on desktop WebGL (plain WebGL lines clamp to 1px). The geometry
    // buffers are pre-allocated ONCE at MAX_SEGMENTS capacity and updated
    // in-place each tick (writing into posArr/colArr + bumping the interleaved
    // buffers' versions, then setting geometry.instanceCount = live segments).
    // Recreating the attributes every frame (setPositions per tick) left only
    // the first segment rendering — this in-place pattern draws all of them.
    // `resolution` must track the canvas pixel size for correct screen-space
    // width — seeded here, kept current via setResolution() (app.js init + resize).
    const MAX_SEGMENTS = 64;
    const posArr = new Float32Array(MAX_SEGMENTS * 6); // xyz,xyz per segment
    const colArr = new Float32Array(MAX_SEGMENTS * 6); // rgb,rgb per segment
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(posArr);
    geometry.setColors(colArr);
    geometry.instanceCount = 0;
    const posBuffer = geometry.getAttribute('instanceStart').data;      // shared start/end
    const colBuffer = geometry.getAttribute('instanceColorStart').data; // shared start/end
    const material = new LineMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        linewidth: PATH_LINEWIDTH,
    });
    material.resolution.set(window.innerWidth, window.innerHeight);
    const mesh = new LineSegments2(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);

    const glowMat = new THREE.ShaderMaterial({
        vertexShader: GLOW_VS,
        fragmentShader: GLOW_FS,
        uniforms: {
            uColor: { value: new THREE.Color(GLOW_COLOR) },
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
    const SEGMENT_DRAW_DURATION = 2.0; // doubled from 1.0 — slower path draw

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

        // Write every segment's endpoints + colour straight into the
        // pre-allocated fat-line buffers, then grow instanceCount to match.
        let n = 0;
        visited.clear();
        for (const s of segments) {
            if (n >= MAX_SEGMENTS * 6) break;
            const a = points.getPosition(s.fromId);
            const b = points.getPosition(s.toId);
            if (!a || !b) continue;
            const t = s.progress;
            const endX = a.x + (b.x - a.x) * t;
            const endY = a.y + (b.y - a.y) * t;
            posArr[n] = a.x; posArr[n + 1] = a.y; posArr[n + 2] = LINE_Z;
            posArr[n + 3] = endX; posArr[n + 4] = endY; posArr[n + 5] = LINE_Z;
            tmpColor.setHex(s.color);
            colArr[n] = tmpColor.r; colArr[n + 1] = tmpColor.g; colArr[n + 2] = tmpColor.b;
            colArr[n + 3] = tmpColor.r; colArr[n + 4] = tmpColor.g; colArr[n + 5] = tmpColor.b;
            n += 6;
            visited.add(s.fromId);
            if (t >= 0.999) visited.add(s.toId);
        }
        posBuffer.needsUpdate = true;
        colBuffer.needsUpdate = true;
        geometry.instanceCount = n / 6;
        mesh.visible = n > 0;

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

    // Keep the fat-line material's resolution in sync with the canvas pixel
    // size so PATH_LINEWIDTH renders at the intended screen thickness.
    function setResolution(width, height) {
        if (width > 0 && height > 0) material.resolution.set(width, height);
    }

    // Fade the path line + glow to invisible over `durationSec` seconds.
    // Driven by the `path-fade-out` directive (Start over). The opacity
    // values are restored to their defaults when `clear()` is next called
    // (on boot-handshake path-clear) so a fresh session starts at full opacity.
    let fadeTarget = null; // { duration, elapsed, fromLine, fromGlow } or null
    const BASE_LINE_OPACITY = 0.9;
    const BASE_GLOW_OPACITY = GLOW_OPACITY;

    function fadeOut(durationSec = 0.6) {
        fadeTarget = {
            duration: durationSec,
            elapsed: 0,
            fromLine: material.opacity,
            fromGlow: glowMat.uniforms.uOpacity.value,
        };
    }

    // Hook into tick — advance fade tween each frame.
    const _originalTick = tick;
    function tickWithFade(panProgress = 1, dt = 0) {
        _originalTick(panProgress, dt);
        if (!fadeTarget) return;
        fadeTarget.elapsed += dt;
        const t = Math.min(1, fadeTarget.elapsed / fadeTarget.duration);
        const e = t * (2 - t); // ease-out — matches CSS ease-out on #map-words / .explore-map-label
        material.opacity = fadeTarget.fromLine * (1 - e);
        glowMat.uniforms.uOpacity.value = fadeTarget.fromGlow * (1 - e);
        if (t >= 1) fadeTarget = null;
    }

    // Restore default opacities on clear so a fresh session starts correctly.
    const _originalClear = clear;
    function clearWithOpacityReset() {
        _originalClear();
        material.opacity = BASE_LINE_OPACITY;
        glowMat.uniforms.uOpacity.value = BASE_GLOW_OPACITY;
        fadeTarget = null;
    }

    return { addSegment, truncate, clear: clearWithOpacityReset, tick: tickWithFade, fadeOut, setGhost, clearGhost, setResolution, get count() { return segments.length; } };
}
