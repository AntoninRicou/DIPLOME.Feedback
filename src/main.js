
import app from './app.js';
import { connect, on, send } from './api.js';
import { createCommands } from './commands.js';
import { createCommandsManager } from './commandsManager.js';
import { createStateManager } from './stateManager.js';
import { createPathPlayer } from './pathPlayer.js';
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
  if (isEmbedded) document.body.dataset.canvasBg = 'gradient';
  const apps = [];
  const containers = [1, 2, 3, 4].map(n => document.getElementById(`container-${n}`));
  const stateManager = createStateManager({
    containers,
    getApps: () => apps,
    initial: isEmbedded ? 'disperse' : 'single',
  });
  let dispersePrimed = false;
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
    createApp(1, 'projection_2d');
    createApp(2, 'umap_book');
    createApp(3, 'umap_subjects_embeddings');
    createApp(4, 'umap_random');

    if (!isEmbedded) setupSocketBridge();
    animate();
  }

  function setupSocketBridge() {
    connect();
    const actions = createCommands(apps, stateManager, pathPlayer);
    const manager = createCommandsManager(actions);
    manager.register(on);
    window.api = {
      send,
      run: manager.run,
      list: manager.list,
      state: stateManager,
    };
  }

  function createApp(number, mapType = 'form') {
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
        host.object.enterDisperse();
        // Embed mode bypasses stateManager.goTo (which is what normally sets
        // the highlight preset per state), so apply the 'big' preset here —
        // disperse is a far-camera state where small sprites need amplification.
        if (host.object.setHighlightPreset) host.object.setHighlightPreset('big');
        host.object.enablePicking({
          // Tighter than the 36px default — VIEW_2's spawn-on-enter
          // preview was firing on too many adjacent sprites at once
          // because the picker grabbed any sprite within a fat radius.
          // 18px keeps it generous for fast disperse motion without
          // sweeping in unrelated neighbours.
          hoverRadiusPx: 9,
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
        dispersePrimed = true;
      }
    }

    apps.forEach(app => {
      if (app.isReady) {
        app.object.animate(dt);
      }
    });

    requestAnimationFrame(animate);
  }

  setup();

}
window.onload = main;