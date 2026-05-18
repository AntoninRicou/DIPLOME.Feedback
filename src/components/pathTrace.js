import * as THREE from 'three';

const DEFAULT_COLOR = 0x88ccff;
const LINE_Z = 0.005;
const GLOW_Z = 0.003;
const GLOW_FACTOR = 2.4;
const GLOW_OPACITY = 0.55;
const GLOW_CAPACITY = 128;

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

    function addSegment(fromId, toId, color = DEFAULT_COLOR) {
        if (!fromId || !toId) return;
        if (segments.length > 0) segments[segments.length - 1].progress = 1;
        segments.push({ fromId, toId, color, progress: 0 });
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
    }

    function tick(panProgress = 1) {
        if (segments.length > 0) {
            const last = segments[segments.length - 1];
            if (last.progress < 1) last.progress = panProgress;
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
    }

    return { addSegment, truncate, clear, tick, get count() { return segments.length; } };
}
