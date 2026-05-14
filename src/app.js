import * as THREE from 'three';
import { loadMapData } from './mapData.js';

function app({ container, id, mapType, state, appIsReady }) {
    console.log("App initialized");
    let canvas, scene, camera, renderer, data;
    const { clientWidth: width, clientHeight: height } = container;


    async function setup() {
        canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        container.appendChild(canvas);
        window.addEventListener('resize', onResize);

        data = await loadMapData(mapType);
        createScene();
        appIsReady(id);
    }

    function createScene() {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
        camera.position.z = 5;
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(width, height, false);
    }

    function onResize() {
        const { clientWidth: width, clientHeight: height } = container;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
    }

    function update() { }

    function animate() {
        renderer.render(scene, camera);
    }

    setup();

    return { animate }
}

export default app;
