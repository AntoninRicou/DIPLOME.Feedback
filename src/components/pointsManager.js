import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
    attribute vec4 aUvRect;
    attribute float aOpacity;
    varying vec2 vUv;
    varying float vOpacity;
    void main() {
        vUv = vec2(
            aUvRect.x + uv.x * aUvRect.z,
            aUvRect.y + (1.0 - uv.y) * aUvRect.w
        );
        vOpacity = aOpacity;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    precision highp float;
    uniform sampler2D uAtlas;
    varying vec2 vUv;
    varying float vOpacity;
    void main() {
        vec4 c = texture2D(uAtlas, vUv);
        gl_FragColor = vec4(c.rgb, c.a * vOpacity);
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
        // transparent so the per-instance `aOpacity` (used to dim non-marked
        // sprites to 80% in the explore-single view) actually blends. depthWrite
        // stays default (true) so coplanar sprite occlusion ordering is unchanged
        // for fully-opaque (aOpacity = 1) sprites.
        transparent: true,
    });

    // Per-instance opacity (default 1). Driven by setMarkDim() to dim the
    // non-marked sprites in the explore-single view — see setMarkDim/applyMarkDim.
    const opacities = new Float32Array(count).fill(1);

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
    geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opacities, 1));
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
    // Glow halo colour — a radial GRADIENT from a bright white core out to the
    // blueish-grey rotate-text stroke colour (`--rotate-panel-bg` ≈ #afb4bc) at
    // the rim. The white core keeps the additive "enlighten" effect; the rim
    // gives the halo the blue-grey cast. Tune GLOW_CORE / GLOW_EDGE to taste.
    const GLOW_CORE_COLOR = 0xdde2ec; // cool light blue-grey centre (a touch greyer than near-white, still lights)
    const GLOW_EDGE_COLOR = 0xa6acba; // blueish-grey body/rim (matches --rotate-panel-bg family)
    const GLOW_FS = /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uColor;      // bright white core
        uniform vec3 uColorEdge;  // blueish-grey rim
        uniform float uOpacity;
        void main() {
            float d = distance(vUv, vec2(0.5));
            // Lower exponent → broader, stronger glow (slower falloff).
            float a = pow(1.0 - smoothstep(0.0, 0.5, d), 1.3);
            // ONE smooth ramp across the whole glow (no hard white core / ring):
            // cool near-white centre easing continuously into the blue-grey body.
            float t = smoothstep(0.0, 0.5, d);
            // Mild boost keeps the glow strong while NOT re-whitening the
            // (now greyer) centre back to a clamped pure white.
            vec3 col = mix(uColor, uColorEdge, t) * 1.08;
            gl_FragColor = vec4(col, a * uOpacity);
        }
    `;

    // Two independent glow halos: `focusGlow` follows the persistent focus
    // highlight (the active central image), `hoverGlow` follows the transient
    // hover highlight. Separate meshes (each with its own uOpacity uniform) so
    // the centre can keep glowing while a hovered sprite glows at the same
    // time — the per-instance sprite scale (highlightT[]) already supports
    // multiple lit sprites; the single halo mesh was the only thing forcing
    // one-glow-at-a-time, so it's split in two here.
    function makeGlowMesh() {
        const mat = new THREE.ShaderMaterial({
            vertexShader: GLOW_VS,
            fragmentShader: GLOW_FS,
            uniforms: {
                uColor: { value: new THREE.Color(GLOW_CORE_COLOR) },
                uColorEdge: { value: new THREE.Color(GLOW_EDGE_COLOR) },
                uOpacity: { value: 1.0 },
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        mesh.visible = false;
        mesh.frustumCulled = false;
        scene.add(mesh);
        return mesh;
    }
    const focusGlow = makeGlowMesh();
    const hoverGlow = makeGlowMesh();

    // Highlight presets per render state. Far-camera states (single, overview,
    // disperse) need the bigger preset because sprites are tiny on screen;
    // the close-camera split state reads fine with the original default
    // values. The active preset is driven by `setHighlightPreset(name)`,
    // which `stateManager.goTo` calls on every transition.
    const HIGHLIGHT_PRESETS = {
        default: { scale: 1.4, glow: 1.8 },
        // `big` drives the far-camera hover highlight (single / overview /
        // disperse) — including the VIEW_2 interface-hover → project sprite.
        // Bumped a bit bigger so the hovered image reads more clearly.
        big: { scale: 3.4, glow: 3.4 },
    };
    let activeHighlightScale = HIGHLIGHT_PRESETS.default.scale;
    let activeGlowFactor = HIGHLIGHT_PRESETS.default.glow;
    // The preset scale/glow can be EASED to its new value (over `duration`)
    // instead of snapped. The VIEW_4 hover zoom/unzoom passes its tween
    // duration so the sprite preset switch stays in sync with the cameraZ
    // tween — without this, the highlighted (centered) sprite popped in size
    // the instant a canvas started zooming/unzooming. State transitions
    // (`goTo`) still snap (duration 0), since they're masked/instant.
    let presetScaleFrom = activeHighlightScale;
    let presetScaleTo = activeHighlightScale;
    let presetGlowFrom = activeGlowFactor;
    let presetGlowTo = activeGlowFactor;
    let presetT = 1;
    let presetDuration = 0;

    function setHighlightPreset(name, duration = 0) {
        const preset = HIGHLIGHT_PRESETS[name] || HIGHLIGHT_PRESETS.default;
        if (duration > 0) {
            // Ease from the CURRENT (possibly mid-ease) values to the target.
            presetScaleFrom = activeHighlightScale;
            presetGlowFrom = activeGlowFactor;
            presetScaleTo = preset.scale;
            presetGlowTo = preset.glow;
            presetT = 0;
            presetDuration = duration;
        } else {
            activeHighlightScale = preset.scale;
            activeGlowFactor = preset.glow;
            presetScaleTo = preset.scale;
            presetGlowTo = preset.glow;
            presetT = 1;
            presetDuration = 0;
        }
    }

    // Advance the eased preset transition (no-op once settled). Run every frame
    // from tick() before the highlight write/glow so the eased scale is current.
    function tickPreset(dt) {
        if (presetT >= 1 || presetDuration <= 0) return;
        presetT = Math.min(1, presetT + dt / presetDuration);
        const e = easeInOutCubic(presetT);
        activeHighlightScale = presetScaleFrom + (presetScaleTo - presetScaleFrom) * e;
        activeGlowFactor = presetGlowFrom + (presetGlowTo - presetGlowFrom) * e;
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
    // Two highlight tracks. `focusIndex` is the persistent highlight on the
    // active central image (set via `setFocus`, driven by `focus(id)` on the
    // wire). `hoverIndex` is the transient hover highlight (set via `setHover`,
    // driven by `set-highlight`). A sprite is lit (eased toward scale 1) when
    // it is EITHER index, so the centre keeps glowing while a hovered sprite
    // also glows. The `last*` indices keep each halo anchored during fade-out.
    let focusIndex = -1;
    let hoverIndex = -1;
    let lastFocusIndex = -1;
    let lastHoverIndex = -1;
    const litSet = new Set();
    // Persistent multi-highlight set (`set-marks`). Every marked index is
    // lit (scale-up via the shared highlightT machinery) for as long as it
    // stays marked — independent of the single focus/hover tracks. Used by
    // the overview "circle of images" to light the whole contributed path
    // at once instead of just the last selected image.
    const markSet = new Set();

    // Extra hover emphasis on top of the mark scale. When a MARKED sprite is
    // hovered (the explore-others circle: every path image is marked, so they
    // all sit at the same big scale), a plain glow doesn't make the hovered one
    // stand out. `hoverT` eases an additional scale boost + a top z-lift onto
    // the hovered sprite so it grows above the others, the way a hovered sprite
    // reads in VIEW_2 (where it's the only lit one). Scoped to marked sprites,
    // so VIEW_2 and every non-marked hover are unchanged.
    const hoverT = new Float32Array(count);
    const hoverTargetT = new Float32Array(count);
    const HOVER_EXTRA_SCALE = 0.5; // hovered marked sprite → mark scale × 1.5

    function idToIdx(id) {
        return id == null ? -1 : (idToIndex.has(id) ? idToIndex.get(id) : -1);
    }

    // Recompute per-instance targets from the desired focus/hover pair plus
    // the persistent mark set: ease toward 1 for indices that are (still) lit
    // by any track, toward 0 for ones dropping out. Shared by
    // setFocus/setHover/setMarks so the tracks never clobber each other on
    // the shared highlightTargetT array.
    function applyLit(nextFocus, nextHover) {
        const next = new Set(markSet);
        if (nextFocus >= 0) next.add(nextFocus);
        if (nextHover >= 0) next.add(nextHover);
        const prevHover = hoverIndex;
        const changed = [];
        for (const i of litSet) {
            if (!next.has(i)) { highlightTargetT[i] = 0; activeHighlights.add(i); changed.push(i); }
        }
        for (const i of next) {
            if (!litSet.has(i)) { highlightTargetT[i] = 1; activeHighlights.add(i); changed.push(i); }
        }
        // Hover-emphasis target: the new hover sprite eases its boost in, the
        // old one eases it out. Tracked independently of lit membership so a
        // marked sprite (always lit) still gains/loses the boost on hover.
        if (prevHover !== nextHover) {
            if (prevHover >= 0) { hoverTargetT[prevHover] = 0; activeHighlights.add(prevHover); changed.push(prevHover); }
            if (nextHover >= 0) { hoverTargetT[nextHover] = 1; activeHighlights.add(nextHover); changed.push(nextHover); }
        }
        // Instant hover-out: when the transient hover sprite is released (or the
        // cursor jumps to another sprite) and it isn't held lit by focus or
        // marks, snap its scale + glow to 0 immediately instead of easing — the
        // VIEW_2 disperse hover felt laggy lingering on fade-out. Focus/mark
        // releases still ease via tickHighlights (this only touches the
        // just-released hover index).
        if (prevHover >= 0 && prevHover !== nextHover && prevHover !== nextFocus && !markSet.has(prevHover)) {
            highlightT[prevHover] = 0;
            highlightTargetT[prevHover] = 0;
            hoverT[prevHover] = 0;
            hoverTargetT[prevHover] = 0;
            activeHighlights.delete(prevHover);
            writeInstance(prevHover);
        }
        if (focusIndex >= 0 && nextFocus !== focusIndex) lastFocusIndex = focusIndex;
        if (hoverIndex >= 0 && nextHover !== hoverIndex) lastHoverIndex = hoverIndex;
        focusIndex = nextFocus;
        hoverIndex = nextHover;
        litSet.clear();
        for (const i of next) litSet.add(i);
        // Immediate write — `writeInstance` reads the just-updated
        // hoverIndex/focusIndex/targets, so the z lift applies on the
        // SAME render frame as the hover event, not the next tick. The
        // scale still eases via tickHighlights (next tick), but z is
        // binary so landing it instantly removes the one-frame "is it
        // above? is it below?" race.
        if (changed.length > 0) {
            for (const i of changed) writeInstance(i);
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    function setFocus(id) {
        const idx = idToIdx(id);
        if (idx === focusIndex) return;
        applyLit(idx, hoverIndex);
    }
    function setHover(id) {
        const idx = idToIdx(id);
        if (idx === hoverIndex) return;
        applyLit(focusIndex, idx);
    }
    // Persistently light a set of ids (the contributed path in overview).
    // Marks supersede the single focus track: focus is cleared so every
    // marked image reads equally — no extra filled focus halo on the last
    // one. An in-flight hover is preserved so it still overlays. Pass an
    // empty array to clear all marks.
    function setMarks(idList) {
        markSet.clear();
        if (Array.isArray(idList)) {
            for (const id of idList) {
                const idx = idToIdx(id);
                if (idx >= 0) markSet.add(idx);
            }
        }
        applyLit(-1, hoverIndex);
        // Re-apply the mark-dim so the newly-marked sprites read at full opacity
        // and the rest stay dimmed (e.g. when centring a different explorer
        // circle, which calls setMarks again with a new id set).
        if (markDimActive) applyMarkDim();
        // Drop the lingering focus anchor so the focus glow doesn't keep
        // painting the previously-focused image brighter than its peers.
        lastFocusIndex = -1;
    }

    // Mark-dim: in the explore-single view, dim every NON-marked sprite to
    // MARK_DIM_OPACITY so the marked (circle/path) images stand out. Active is
    // toggled by setMarkDim; recomputed whenever the mark set changes (setMarks).
    // Cleared (all back to 1) on Start over via setMarkDim(false).
    let markDimActive = false;
    const MARK_DIM_OPACITY = 0.6;
    function applyMarkDim() {
        for (let i = 0; i < count; i++) {
            opacities[i] = markDimActive && !markSet.has(i) ? MARK_DIM_OPACITY : 1;
        }
        geometry.attributes.aOpacity.needsUpdate = true;
    }
    function setMarkDim(active) {
        markDimActive = !!active;
        applyMarkDim();
    }

    function updateGlow(glowMesh, anchorIndex) {
        if (anchorIndex < 0) { glowMesh.visible = false; return; }
        const v = highlightT[anchorIndex];
        if (v < 0.001) { glowMesh.visible = false; return; }
        const pos = positions[anchorIndex];
        if (!pos) { glowMesh.visible = false; return; }
        const e = easeInOutCubic(v);
        const base = Math.max(pos.sx, pos.sy) || 0.04;
        const size = base * activeHighlightScale * activeGlowFactor;
        glowMesh.position.set(pos.x, pos.y, 0.004);
        glowMesh.scale.set(size * e, size * e, 1);
        glowMesh.material.uniforms.uOpacity.value = e;
        glowMesh.visible = true;
    }
    function updateActiveGlow() {
        const fa = focusIndex >= 0 ? focusIndex : lastFocusIndex;
        let ha = hoverIndex;
        if (ha < 0) {
            // Hover released. Keep the halo on the last-hovered sprite only
            // while it's actually fading out (scale easing toward 0). A
            // hovered sprite that is also MARKED never fades — its scale
            // stays pinned — so its hover halo would otherwise linger
            // forever. Suppress it the moment hover is released.
            ha = (lastHoverIndex >= 0 && !litSet.has(lastHoverIndex)) ? lastHoverIndex : -1;
        }
        updateGlow(focusGlow, fa);
        // Hide the hover halo when it coincides with the focus halo so the
        // overlap doesn't read as a single double-bright blob.
        updateGlow(hoverGlow, (ha >= 0 && ha !== fa) ? ha : -1);
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

    // Backward-compatible alias for the transient hover track. Existing
    // callers — the `set-highlight` wire handler and the iframe's
    // `enablePicking` hover — call `highlight`; routing them to the hover
    // track means they no longer disturb the persistent focus glow.
    function highlight(id) {
        setHover(id);
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
            // Ease the hover-emphasis boost on the same clock.
            const ht = hoverTargetT[i];
            let hv = hoverT[i] + (ht - hoverT[i]) * k;
            if (Math.abs(hv - ht) < 0.0008) hv = ht;
            hoverT[i] = hv;
            writeInstance(i);
            // Stop ticking only when BOTH tracks have settled at rest.
            if (v === target && target === 0 && hv === ht && ht === 0) toRemove.push(i);
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
        let scaleMul = 1 + (activeHighlightScale - 1) * e;
        // Extra hover emphasis — only for a MARKED sprite that's hovered (the
        // explore-others circle). Grows it past the uniform mark scale so the
        // hovered image stands out; non-marked hovers are unaffected. The flag
        // is true on hover-in (target set) through fade-out (eased value > 0),
        // so the z-lift lands instantly while the scale still eases.
        const markedHover = markSet.has(i) && (hoverTargetT[i] > 0 || hoverT[i] > 0.01);
        if (markedHover) scaleMul *= 1 + HOVER_EXTRA_SCALE * easeInOutCubic(hoverT[i]);
        // z lift is binary, NOT eased — instant on hover/focus set,
        // held through fade-out. Hover ranks STRICTLY above focus so a
        // hovered sprite that overlaps spatially with the focused
        // central image surfaces unambiguously (both at z=0.01 left
        // their render order undefined). Identification:
        //   active focus = focusIndex, or lastFocusIndex during its fade-out;
        //   active hover = hoverIndex, or lastHoverIndex during its fade-out.
        const lifted = highlightTargetT[i] > 0 || highlightT[i] > 0.01;
        let z = 0;
        if (lifted) {
            const isFocus = i === focusIndex || (focusIndex < 0 && i === lastFocusIndex);
            z = isFocus ? 0.01 : 0.02;
        }
        // A hovered marked sprite rises ABOVE the other marks (0.02) so it's
        // never occluded by a neighbouring path image.
        if (markedHover) z = 0.03;
        setInstance(i, scaleMul, z);
    }

    function enterDisperse({ rMax = 2.0, cycleSpeed = 15, wanderDistance = 0.8, ovalX = 1.4, ovalY = 1.0 } = {}) {
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

            // Spawn positions sampled on an ellipse (ovalX, ovalY = 1 ⇒ circle).
            // Defaults to ovalX = 1.4 / ovalY = 1.0 ⇒ a moderately wider-than-
            // tall cloud, matching typical landscape viewports. Caller can
            // override by passing { ovalX, ovalY } at enterDisperse time.
            const angle = Math.random() * Math.PI * 2;
            const r = rMax * Math.sqrt(Math.random());
            const spawnX = Math.cos(angle) * r * ovalX;
            const spawnY = Math.sin(angle) * r * ovalY;

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
        // Window over which drift amplitude ramps from 0 to full. Chosen
        // longer than the average burst duration so drift is already
        // substantially active by the time a sprite lands at its spawn
        // position — there is no perceptual gap between "arriving" and
        // "wandering". Effectively this dissolves the burst↔drift phase
        // boundary into one continuous motion.
        const DRIFT_RAMP_SEC = 0.7;

        for (let i = 0; i < count; i++) {
            const p = disperse.per[i];
            const sinceStart = disperse.burstElapsed - p.delay;
            const burstProgress = Math.max(0, Math.min(1, sinceStart / p.duration));

            // ── Drift offset — computed every frame from sprite spawn ──
            // Drift time origin is the sprite's burst start (not its arrival
            // at spawn). The amplitude smoothstep ramps from 0 over
            // DRIFT_RAMP_SEC, so during the early part of burst the sprite
            // moves nearly straight outward; as the ramp climbs the sprite
            // begins to curve, and by the time burst ends, drift is most of
            // its way to full amplitude. Sprites therefore never "stop and
            // then start moving" — they smoothly evolve from radial-outward
            // motion into wander, with continuous velocity and acceleration.
            const drift_t = sinceStart / disperse.cycleSpeed;
            const driftRampRaw = Math.max(0, Math.min(1, sinceStart / DRIFT_RAMP_SEC));
            const driftRamp = driftRampRaw * driftRampRaw * (3 - 2 * driftRampRaw);
            const wd = disperse.wanderDistance * driftRamp;
            const dx = (Math.sin(p.fx1 * drift_t + p.px1) + Math.sin(p.fx2 * drift_t + p.px2) - p.baseX) * wd;
            const dy = (Math.sin(p.fy1 * drift_t + p.py1) + Math.sin(p.fy2 * drift_t + p.py2) - p.baseY) * wd;

            if (burstProgress < 1) {
                // Burst phase — radial outward motion + the live drift offset.
                // easeOutCubic still drives the radial component, but the
                // sprite is no longer travelling in a pure straight line
                // toward spawn; the drift offset bends the path continuously
                // and is already in motion when burst arrives.
                const e = easeOutCubic(burstProgress);
                positions[i].x = p.spawnX * e + dx;
                positions[i].y = p.spawnY * e + dy;
                writeInstance(i);
                continue;
            }

            // Settled — drift around anchor (which equals the spawn point).
            // Anchor is set lazily on the first frame post-arrival.
            let a = disperse.anchor.get(ids[i]);
            if (!a) {
                a = { x: p.spawnX, y: p.spawnY };
                disperse.anchor.set(ids[i], a);
            }

            if (i === hoverIndex) {
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
        // Always: advance the eased preset transition + per-instance highlight
        // transitions and refresh the glow. Runs regardless of disperse/morph
        // state so hover animations are responsive in `single`, `split`,
        // `overview` too. tickPreset first so the eased scale is current when
        // the highlighted sprites are re-written this frame.
        tickPreset(dt);
        tickHighlights(dt);
        updateActiveGlow();
    }

    return { mesh, geometry, material, ids, positions, highlight, setFocus, setHover, setMarks, setMarkDim, setHighlightPreset, getPosition, morphTo, tick, enterDisperse, exitDisperse };
}

export { createPointsManager };
