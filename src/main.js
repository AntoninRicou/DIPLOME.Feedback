
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
  const apps = [];
  const containers = [1, 2, 3, 4].map(n => document.getElementById(`container-${n}`));
  const stateManager = createStateManager({ containers, getApps: () => apps });
  const pathPlayer = createPathPlayer({ stepInterval: 2.5 });

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

    setupSocketBridge();
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