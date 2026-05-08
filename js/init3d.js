import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './scene.js';
import { createPhysicsWorld, placeCardsOnTable } from './physics.js';
import { Card } from './card.js';
import { CameraController } from './camera-controller.js';
import { InputController } from './input.js';
import { projects } from './data.js';
import { IframeOverlay } from './iframe-overlay.js';
import * as Modal from './modal.js';
import { Layout, CELL_SIZE } from './layout.js';

export async function init3d() {
    await RAPIER.init();

    const { scene, camera, webglRenderer, css3dRenderer } = createScene();
    const world = createPhysicsWorld();

    const iframeOverlay = new IframeOverlay();

    const cards = projects.map(p => {
        const card = new Card(p, world, iframeOverlay);
        scene.add(card.pivot);
        return card;
    });
    placeCardsOnTable(cards);

    const cameraController = new CameraController(camera, iframeOverlay);
    new InputController({
        camera,
        cards,
        cameraController,
        webglContainer: document.getElementById('webgl-container'),
    });

    Modal.onOpen(() => {
        cameraController.unfocus();
        iframeOverlay.setModalActive(true);
    });
    Modal.onClose(() => {
        iframeOverlay.setModalActive(false);
    });

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

    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 1 / 30);
        if (document.body.classList.contains('grid-mode')) return;
        world.step();
        for (const card of cards) card.update(dt);
        cameraController.update(dt);
        webglRenderer.render(scene, camera);
        css3dRenderer.render(scene, camera);
        iframeOverlay.update(camera);
    }
    animate();

    return { cards, cameraController, iframeOverlay };
}
