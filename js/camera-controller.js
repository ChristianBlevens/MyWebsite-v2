import * as THREE from 'three';
import { DEFAULT_CAMERA } from './scene.js';
import { CARD_W, CARD_H } from './layout.js';

const _domTop = new THREE.Vector3();
const FOCUS_BUFFER = 1.1;  // 10% padding on the limiting axis

export class CameraController {
    constructor(camera, iframeOverlay = null) {
        this.camera = camera;
        this.iframeOverlay = iframeOverlay;
        this.mode = 'overview';
        this.focusCard = null;
        this.lerp = 6;

        this.targetPosition = new THREE.Vector3().copy(DEFAULT_CAMERA.position);
        this.targetLookAt = new THREE.Vector3().copy(DEFAULT_CAMERA.lookAt);
        this.targetUp = new THREE.Vector3().copy(DEFAULT_CAMERA.up);

        this._tmpQuat = new THREE.Quaternion();
        this._tmpMatrix = new THREE.Matrix4();
        this._currentLookAt = new THREE.Vector3().copy(DEFAULT_CAMERA.lookAt);
        this._currentUp = new THREE.Vector3().copy(DEFAULT_CAMERA.up);
    }

    focusOn(card) {
        // Drop any previously-focused card back to textured (unless it's
        // expanded — expanded cards always stay in css3d for the iframe).
        if (this.focusCard && this.focusCard !== card) {
            this.focusCard.setFocused(false);
        }
        this.focusCard = card;
        this.mode = 'focused';
        this.iframeOverlay?.setFocusedCard(card);
        card.setFocused(true);
    }

    unfocus() {
        const prev = this.focusCard;
        this.focusCard = null;
        this.mode = 'overview';
        this.iframeOverlay?.setFocusedCard(null);
        prev?.setFocused(false);
    }

    _computeFocusTarget() {
        const card = this.focusCard;
        if (!card) return;

        const cardPos = card.pivot.position;
        const scale = card.scaleCurrent;
        const fovRad = this.camera.fov * Math.PI / 180;
        const tanHalfFov = Math.tan(fovRad / 2);
        const aspect = this.camera.aspect;

        // The vertical viewport region usable for framing the card is
        // (viewport height - top-nav height): the card centers in the strip
        // between the nav's bottom edge and the viewport's bottom edge.
        // Horizontal usable region is the full viewport width.
        const navEl = document.getElementById('top-nav');
        const navH = navEl ? navEl.getBoundingClientRect().height : 0;
        const vpH = window.innerHeight;
        const verticalUsableFrac = Math.max(0.1, 1 - navH / vpH);

        // Camera height needed so the card fits the limiting axis with
        // FOCUS_BUFFER padding. Card local size is CARD_W × CARD_H; head-on
        // framing means CARD_H aligns with screen-Y, CARD_W with screen-X.
        const hForHeight = (CARD_H * scale * FOCUS_BUFFER)
                          / (2 * tanHalfFov * verticalUsableFrac);
        const hForWidth  = (CARD_W * scale * FOCUS_BUFFER)
                          / (2 * tanHalfFov * aspect);
        const height = Math.max(hForHeight, hForWidth);

        // Camera "up" tracks the visible face's DOM-top direction in world.
        // Front face DOM-top = pivot-local -Z; back face DOM-top = pivot-local +Z
        // (after the body's 180° X-flip both still point pivot -Z in world,
        //  hence using the pre-flip pivot-local axis below). Avoids the YXZ
        //  Euler ambiguity that flipped the up vector after a card flip.
        _domTop.set(0, 0, card.faceUp ? -1 : +1).applyQuaternion(card.pivot.quaternion);
        _domTop.y = 0;
        if (_domTop.lengthSq() < 1e-6) _domTop.set(0, 0, -1);
        else _domTop.normalize();

        // Shift the focal point along +up so the card lands centered in the
        // usable strip (below the nav) instead of the geometric viewport
        // center. World shift for a navH/2 screen-pixel offset at the chosen
        // camera height: navH * h * tan(fov/2) / vpH.
        const shiftWorld = navH * height * tanHalfFov / vpH;
        const focusX = cardPos.x + _domTop.x * shiftWorld;
        const focusZ = cardPos.z + _domTop.z * shiftWorld;

        this.targetPosition.set(focusX, cardPos.y + height, focusZ);
        this.targetLookAt.set(focusX, cardPos.y, focusZ);
        this.targetUp.copy(_domTop);
    }

    _computeOverviewTarget() {
        this.targetPosition.copy(DEFAULT_CAMERA.position);
        this.targetLookAt.copy(DEFAULT_CAMERA.lookAt);
        this.targetUp.copy(DEFAULT_CAMERA.up);
    }

    update(dt) {
        if (this.mode === 'focused') this._computeFocusTarget();
        else this._computeOverviewTarget();

        const t = Math.min(1, dt * this.lerp);
        this.camera.position.lerp(this.targetPosition, t);
        this._currentLookAt.lerp(this.targetLookAt, t);
        this._currentUp.lerp(this.targetUp, t).normalize();

        this.camera.up.copy(this._currentUp);
        this._tmpMatrix.lookAt(this.camera.position, this._currentLookAt, this._currentUp);
        this._tmpQuat.setFromRotationMatrix(this._tmpMatrix);
        this.camera.quaternion.slerp(this._tmpQuat, t);
    }
}
