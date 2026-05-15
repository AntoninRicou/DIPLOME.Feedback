import * as THREE from 'three';

const LINE_COLOR = 0x88ccff;
const LINE_Z = 0.005;

export function createPathTrace({ scene, points }) {
    const segments = [];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    const material = new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.9 });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    function addSegment(fromId, toId) {
        if (!fromId || !toId) return;
        segments.push({ fromId, toId });
    }

    function clear() {
        segments.length = 0;
    }

    function tick() {
        const buf = new Float32Array(segments.length * 6);
        let n = 0;
        for (const s of segments) {
            const a = points.getPosition(s.fromId);
            const b = points.getPosition(s.toId);
            if (!a || !b) continue;
            buf[n++] = a.x; buf[n++] = a.y; buf[n++] = LINE_Z;
            buf[n++] = b.x; buf[n++] = b.y; buf[n++] = LINE_Z;
        }
        const trimmed = n === buf.length ? buf : buf.slice(0, n);
        geometry.setAttribute('position', new THREE.BufferAttribute(trimmed, 3));
        geometry.attributes.position.needsUpdate = true;
        geometry.computeBoundingSphere();
    }

    return { addSegment, clear, tick, get count() { return segments.length; } };
}
