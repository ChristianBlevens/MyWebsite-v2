import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './scene.js';
import { createPhysicsWorld } from './physics.js';
import { Card } from './card.js';
import { CameraController } from './camera-controller.js';
import { InputController } from './input.js';
import { setupUi } from './ui.js';
import { projects } from './data.js';
import { IframeOverlay } from './iframe-overlay.js';
import * as Modal from './modal.js';
import { openIntroModal } from './sections/intro.js';
import { setupNav } from './nav.js';
import { Layout, CELL_SIZE } from './layout.js';

// Rapier loads its WASM asynchronously; wait for that before building the world.
await RAPIER.init();

const { scene, camera, webglRenderer, css3dRenderer } = createScene();
const world = createPhysicsWorld();

const iframeOverlay = new IframeOverlay();

const cards = projects.map(p => {
    const card = new Card(p, world, iframeOverlay);
    scene.add(card.pivot);
    return card;
});

const cameraController = new CameraController(camera, iframeOverlay);
const inputController = new InputController({
    camera,
    cards,
    cameraController,
    webglContainer: document.getElementById('webgl-container'),
});

setupUi({ cards, cameraController, iframeOverlay });
setupNav();

// Modal lifecycle hooks. Opening any modal unfocuses any focused card and
// gates iframe pointer-events off so a live iframe can't steal events from
// the modal panel. Closing restores normal table input.
Modal.onOpen(() => {
    cameraController.unfocus();
    iframeOverlay.setModalActive(true);
});
Modal.onClose(() => {
    iframeOverlay.setModalActive(false);
});

// On viewport-driven layout changes, clamp any card whose physics body now
// sits outside the new walls (e.g. landscape→portrait shrinks the X axis,
// so cards near the old +X wall would now be embedded in the new wall).
// Without this, physics resolves them over a few jittery frames; clamping
// makes the transition instant.
Layout.onChange(() => {
    const margin = CELL_SIZE * 0.6;
    const xLimit = Math.max(0.1, Layout.playW / 2 - margin);
    const zLimit = Math.max(0.1, Layout.playD / 2 - margin);
    for (const card of cards) {
        const p = card.body.translation();
        const cx = Math.max(-xLimit, Math.min(xLimit, p.x));
        const cz = Math.max(-zLimit, Math.min(zLimit, p.z));
        if (cx !== p.x || cz !== p.z) {
            card.body.setTranslation({ x: cx, y: p.y, z: cz }, true);
            card.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            card.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
    }
});

// First-load: open the intro modal. Dismissing it teaches the click-off
// gesture used by every other modal and by card unfocus.
openIntroModal();

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 1 / 30);

    // While in grid view the entire 3D scene is hidden behind the grid
    // (z:5 > stage z:1/2). Skip physics, card updates, both renderers, and
    // the iframe overlay — that's where the per-frame CPU cost lives. The
    // rAF loop keeps running so we resume cleanly the moment grid closes;
    // the clock keeps ticking so dt stays small and physics doesn't get a
    // multi-second step on resume. Videos are paused/resumed by ui.js
    // open/closeGrid; iframe DOM is hidden in CSS via body.grid-mode.
    if (document.body.classList.contains('grid-mode')) return;

    world.step();

    for (const card of cards) card.update(dt);
    cameraController.update(dt);

    webglRenderer.render(scene, camera);
    css3dRenderer.render(scene, camera);
    iframeOverlay.update(camera);
}

animate();
