
import app from './app.js';
import { connect, on, send } from './api.js';
import { createCommands } from './commands.js';
import { createCommandsManager } from './commandsManager.js';
import './style.css';
function main() {
  console.log("Hello, World!");
  const apps = [];


  function setup() {
    console.log("Setting up the application...");
    createApp(1, 'projection_2d');
    createApp(2, 'umap_book');
    createApp(3, 'umap_subjects_embeddings');
    createApp(4, 'umap_random');

    setupSocketBridge();
    animate();
  }

  function setupSocketBridge() {
    connect();
    const actions = createCommands(apps);
    const manager = createCommandsManager(actions);
    manager.register(on);
    window.api = {
      send,
      run: manager.run,
      list: manager.list,
    };
  }

  function createApp(number, mapType = 'form') {
    const container = document.getElementById(`container-${number}`);
    const id = `canvas-${number}`;
    const newApp = app({ container, id, mapType, state: {}, appIsReady: () => appIsReady(id) });
    apps.push({ object: newApp, id, isReady: false });
  }

  function appIsReady(id) {
    console.log(`App with id ${id} is ready.`);
    const app = apps.find(app => app.id === id);
    if (app) {
      app.isReady = true;
      console.log(`App ${id} is ready.`);
    }
  }

  function animate() {
    apps.forEach(app => {
      if (app.isReady) {
        app.object.animate();
      }
    });

    requestAnimationFrame(animate);
  }

  setup();

}
window.onload = main;