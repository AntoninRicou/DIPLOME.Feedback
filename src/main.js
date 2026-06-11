
import app from './app.js';
import { connect, on, send } from './api.js';
import { createCommands } from './commands.js';
import { createCommandsManager } from './commandsManager.js';
import { createStateManager } from './stateManager.js';
import { createPathPlayer } from './pathPlayer.js';
import { createMapWords } from './mapWords.js';
import { pickRandom as pickRandomColor } from './pathColors.js';
import './style.css';
function main() {
  console.log("Hello, World!");
  // `?embed=1` — iframe mode for interface_nuxt's VIEW-0. Boot directly into
  // `disperse` and skip the socket bridge so this instance is fully
  // independent from the standalone project window connected to the relay.
  const isEmbedded = new URLSearchParams(window.location.search).get('embed') === '1';
  // Embed mode bypasses the relay, so `set-canvas-bg` from interface_nuxt
  // never arrives — apply the day gradient inline so the disperse field
  // sits on the same backdrop as the rest of project's views.
  if (isEmbedded) {
    document.body.dataset.canvasBg = 'gradient';
    // Hover/picking is gated by the embedder (VIEW_2's phased hover): react to
    // NOTHING on hover until the parent posts `view0:enable-hover` (when the
    // "Explore…" prompt appears). The cursor stays VISIBLE throughout — it used
    // to be hidden until armed, but VIEW_2 now shows the mouse the whole time.
  } else {
    // Standalone window only. This instance runs fullscreen on the external
    // feedback screen, so any cursor over it means the operator has strayed off
    // the interface screen. Show a label pinned to the cursor telling them to
    // bring it back; hide it the moment the cursor leaves the window. Pure DOM
    // overlay — no relay, no state, no render-loop involvement.
    const hint = document.getElementById('cursor-hint');
    if (hint) {
      window.addEventListener('pointermove', (e) => {
        hint.style.left = `${e.clientX}px`;
        hint.style.top = `${e.clientY}px`;
        hint.classList.add('visible');
      });
      // Hide when the pointer leaves the page (back onto the interface screen).
      document.documentElement.addEventListener('mouseleave', () => {
        hint.classList.remove('visible');
      });
      window.addEventListener('blur', () => hint.classList.remove('visible'));
    }
  }
  const apps = [];
  const containers = [1, 2, 3, 4].map(n => document.getElementById(`container-${n}`));
  const stateManager = createStateManager({
    containers,
    getApps: () => apps,
    initial: isEmbedded ? 'disperse' : 'single',
  });
  let dispersePrimed = false;
  // Embed hover-gate: the parent posts `view0:enable-hover` when VIEW_2's
  // "Explore…" prompt appears. Until then picking is off (no local sprite glow,
  // no hover/click messages). The cursor is always visible regardless.
  let hoverArmed = false;
  let pickingEnabled = false;
  if (isEmbedded) {
    window.addEventListener('message', (e) => {
      if (e?.data?.type === 'view0:enable-hover') {
        hoverArmed = true;
      }
    });
  }
  // Map-words overlay (explore-single per-zone labels). Driven by set-map-words
  // + a per-frame update() below; reads the host canvas (apps[0]) for sprite
  // screen positions and the stateManager for the current map / morph state.
  const mapWords = createMapWords();
  const pathPlayer = createPathPlayer({
    stepInterval: 2.5,
    dwellTime: 1.0,
    arriveThreshold: 0.9,
    maxStepWait: 8,
    isSettled: (th) => apps.every(a => !a.isReady || a.object.getPanProgress() >= th),
  });

  pathPlayer.subscribe(({ prevId, id }) => {
    const color = prevId ? pickRandomColor() : null;
    apps.forEach(a => {
      if (!a.isReady) return;
      a.object.focusOn(id);
      if (prevId) a.object.addPathSegment(prevId, id, color);
    });
  });

  function setup() {
    console.log("Setting up the application...");
    stateManager.init();
    createApp(1, 'source');    // canvas-1 = tl = Source   (component_1)
    createApp(2, 'form');      // canvas-2 = tr = Form     (component_2)
    createApp(3, 'semantic');  // canvas-3 = bl = Semantic (component_3)
    createApp(4, 'time');      // canvas-4 = br = Time     (component_4)

    if (!isEmbedded) setupSocketBridge();
    animate();
  }

  function setupSocketBridge() {
    connect();
    const actions = createCommands(apps, stateManager, pathPlayer, mapWords);
    const manager = createCommandsManager(actions);
    manager.register(on);
    window.api = {
      send,
      run: manager.run,
      list: manager.list,
      state: stateManager,
    };
  }

  function createApp(number, mapType) {
    const container = document.getElementById(`container-${number}`);
    const id = `canvas-${number}`;
    const newApp = app({ container, id, mapType, state: {}, appIsReady: () => appIsReady(id) });
    apps.push({ object: newApp, id, isReady: false, mapType });
  }

  function appIsReady(id) {
    console.log(`App with id ${id} is ready.`);
    const app = apps.find(app => app.id === id);
    if (app) {
      app.isReady = true;
      console.log(`App ${id} is ready.`);
    }
  }

  let lastTime = performance.now();
  function animate() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    stateManager.tick(dt);
    pathPlayer.tick(dt);

    // Embed mode: stateManager was initialized into `disperse` directly, so
    // its `goTo` (which normally calls `enterDisperse` on canvas-1) never
    // ran. Prime the particle animation once canvas-1 reports ready, and
    // wire picking so a click forwards the picked image id to the embedder.
    if (isEmbedded && !dispersePrimed) {
      const host = apps[0];
      if (host && host.isReady && host.object.enterDisperse) {
        // Slightly larger disperse oval (both axes) so the spawning field
        // fills more of the VIEW_2 viewport. rMax scales X and Y together;
        // ovalX/ovalY keep the same wider-than-tall shape.
        host.object.enterDisperse({ rMax: 2.4, ovalX: 1.5, ovalY: 1.0 });
        // Embed mode bypasses stateManager.goTo (which is what normally sets
        // the highlight preset per state), so apply the 'big' preset here —
        // disperse is a far-camera state where small sprites need amplification.
        if (host.object.setHighlightPreset) host.object.setHighlightPreset('big');
        dispersePrimed = true;
        // Signal the embedder that the disperse burst has begun, so the
        // standalone project's overview reveal (mask fade-out) can fire in
        // sync with the spawning sprites instead of on a blind timer.
        window.parent.postMessage({ type: 'view0:dispersed' }, '*');
      }
    }
    // Picking (local sprite glow + hover/click messages) is enabled only once
    // the embedder arms hover (VIEW_2 phase 2 — the "Explore…" prompt). Before
    // that nothing reacts to hover at all (the cursor is still visible).
    if (isEmbedded && dispersePrimed && hoverArmed && !pickingEnabled) {
      const host = apps[0];
      if (host && host.object.enablePicking) {
        host.object.enablePicking({
          // Forgiving enough that images are easy to catch on the moving
          // disperse field. (Was 9px, which felt too twitchy — the cursor had
          // to land almost dead-centre on a sprite.) Still well under the 36px
          // default so it doesn't sweep in clearly-unrelated neighbours.
          hoverRadiusPx: 18,
          onHover(imageId, pos) {
            const payload = { type: 'view0:image-hover', imageId };
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
              payload.x = pos.x;
              payload.y = pos.y;
            }
            window.parent.postMessage(payload, '*');
          },
          onClick(imageId) {
            window.parent.postMessage({ type: 'view0:image-click', imageId }, '*');
          },
        });
        pickingEnabled = true;
      }
    }

    apps.forEach(app => {
      if (app.isReady) {
        app.object.animate(dt);
      }
    });

    // Reposition the explore-single map-words overlay against the host canvas's
    // live sprite positions. Standalone only (the embed has no single view).
    if (!isEmbedded) {
      const single = stateManager.state === 'single';
      mapWords.update(apps, single ? stateManager.singleMap : null, single && stateManager.singleSettled);
    }

    requestAnimationFrame(animate);
  }

  setup();

}
window.onload = main;