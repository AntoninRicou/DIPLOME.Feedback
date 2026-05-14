
import app from './app.js';
import './style.css';
function main() {
  console.log("Hello, World!");
  const apps = [];


  function setup() {
    console.log("Setting up the application...");
    createApp(1, 'form');


    animate();
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