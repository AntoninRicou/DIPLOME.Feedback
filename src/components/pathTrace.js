import * as THREE from 'three';

const DEFAULT_COLOR = 0x88ccff;
const LINE_Z = 0.005;

export function createPathTrace({ scene, points }) {
    const segments = [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const tmpColor = new THREE.Color();

    function addSegment(fromId, toId, color = DEFAULT_COLOR) {
        if (!fromId || !toId) return;
        if (segments.length > 0) segments[segments.length - 1].progress = 1;
        segments.push({ fromId, toId, color, progress: 0 });
    }

    function clear() {
        segments.length = 0;
    }

    function tick(panProgress = 1) {
        if (segments.length > 0) {
            const last = segments[segments.length - 1];
            if (last.progress < 1) last.progress = panProgress;
        }

        const posBuf = new Float32Array(segments.length * 6);
        const colBuf = new Float32Array(segments.length * 6);
        let n = 0;
        for (const s of segments) {
            const a = points.getPosition(s.fromId);
            const b = points.getPosition(s.toId);
            if (!a || !b) continue;
            const t = s.progress;
            const endX = a.x + (b.x - a.x) * t;
            const endY = a.y + (b.y - a.y) * t;
            posBuf[n] = a.x;     posBuf[n + 1] = a.y;     posBuf[n + 2] = LINE_Z;
            posBuf[n + 3] = endX; posBuf[n + 4] = endY;   posBuf[n + 5] = LINE_Z;
            tmpColor.setHex(s.color);
            colBuf[n] = tmpColor.r; colBuf[n + 1] = tmpColor.g; colBuf[n + 2] = tmpColor.b;
            colBuf[n + 3] = tmpColor.r; colBuf[n + 4] = tmpColor.g; colBuf[n + 5] = tmpColor.b;
            n += 6;
        }
        const posTrimmed = n === posBuf.length ? posBuf : posBuf.slice(0, n);
        const colTrimmed = n === colBuf.length ? colBuf : colBuf.slice(0, n);
        geometry.setAttribute('position', new THREE.BufferAttribute(posTrimmed, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colTrimmed, 3));
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.computeBoundingSphere();
    }

    return { addSegment, clear, tick, get count() { return segments.length; } };
}
