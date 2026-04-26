import * as THREE from 'three';

// Pointer interaction model:
//   We do NOT rely on CSS3DRenderer's DOM event routing (it fails through
//   transform-style:preserve-3d in many cases — see thoughts/mywebsite-v2-prototype-iteration.md).
//   Instead, every pointerdown on the document triggers a Three.js raycast
//   against per-card invisible hit planes. The hit point is mapped back into
//   the card's native DOM pixel space, and we resolve the actual interactive
//   element at that location (toggle button, github link, iframe, or the card
//   itself) and route accordingly.
//
//   Click           → focus camera on card
//   Double-click    → flip card
//   Hold + drag     → physics-spring drag
//   Background      → unfocus

const DRAG_THRESHOLD_PX = 6;
const DOUBLE_CLICK_MS = 260;
const TAP_MAX_MS = 400;

export class InputController {
    constructor({ camera, cards, cameraController }) {
        this.camera = camera;
        this.cards = cards;
        this.cameraController = cameraController;

        this._raycaster = new THREE.Raycaster();
        this._ndc = new THREE.Vector2();
        this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this._groundHit = new THREE.Vector3();
        this._hitPlanes = cards.map(c => c.hitPlane);

        this.lastClicks = new Map();
        this.activePointer = null; // { card, downX, downY, downTime, moved, pointerId, hitEl }
        this.bgPointer = null;     // { downX, downY, downTime }

        document.addEventListener('pointerdown', this._onPointerDown.bind(this), { capture: true });
        document.addEventListener('pointermove', this._onPointerMove.bind(this));
        document.addEventListener('pointerup',   this._onPointerUp.bind(this));
        document.addEventListener('pointercancel', this._onPointerUp.bind(this));
    }

    // --- helpers -----------------------------------------------------------

    _raycastCard(clientX, clientY) {
        this._ndc.x = (clientX / window.innerWidth) * 2 - 1;
        this._ndc.y = -(clientY / window.innerHeight) * 2 + 1;
        this._raycaster.setFromCamera(this._ndc, this.camera);
        const hits = this._raycaster.intersectObjects(this._hitPlanes, false);
        if (hits.length === 0) return null;
        const top = hits[0];
        return { card: top.object.userData.card, point: top.point };
    }

    _screenToGround(clientX, clientY) {
        this._ndc.x = (clientX / window.innerWidth) * 2 - 1;
        this._ndc.y = -(clientY / window.innerHeight) * 2 + 1;
        this._raycaster.setFromCamera(this._ndc, this.camera);
        this._raycaster.ray.intersectPlane(this._groundPlane, this._groundHit);
        return { x: this._groundHit.x, z: this._groundHit.z };
    }

    // --- event handlers ----------------------------------------------------

    _onPointerDown(ev) {
        // Clicks inside the iframe stage or the overlay toggle must reach the
        // iframe content / toggle button natively. Don't raycast or
        // preventDefault.
        if (ev.target.closest && ev.target.closest('#iframe-stage, #iframe-toggle-stage')) return;
        // Skip clicks on the UI overlay (filter buttons, search, etc), the
        // top nav, the grid fallback, and any open modal — these are real DOM
        // surfaces that own their own click handling and must not also raycast
        // a card behind them.
        if (ev.target.closest && ev.target.closest('#ui-overlay, #grid-view, #top-nav, #modal-root')) return;

        const hit = this._raycastCard(ev.clientX, ev.clientY);
        if (!hit) {
            this.bgPointer = { downX: ev.clientX, downY: ev.clientY, downTime: performance.now() };
            return;
        }

        const { card, point } = hit;
        const { face, px, py } = card.hitToLocalPixels(point);
        const hitEl = card.findElementAtPixels(face, px, py);

        // Ground-plane intersection at press time → used to compute the drag
        // offset so the grabbed point stays under the cursor while dragging.
        const ground = this._screenToGround(ev.clientX, ev.clientY);
        const cardPos = card.pivot.position;

        this.activePointer = {
            card,
            downX: ev.clientX,
            downY: ev.clientY,
            downTime: performance.now(),
            moved: false,
            pointerId: ev.pointerId,
            hitEl,
            dragOffset: { x: ground.x - cardPos.x, z: ground.z - cardPos.z },
        };

        ev.preventDefault();
    }

    _onPointerMove(ev) {
        if (!this.activePointer) return;
        const ap = this.activePointer;
        const dx = ev.clientX - ap.downX;
        const dy = ev.clientY - ap.downY;

        if (!ap.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
            ap.moved = true;
            ap.card.beginDrag(this._dragTarget(ev.clientX, ev.clientY, ap));
        }
        if (ap.moved) {
            ap.card.updateDragTarget(this._dragTarget(ev.clientX, ev.clientY, ap));
        }
    }

    _dragTarget(clientX, clientY, ap) {
        const g = this._screenToGround(clientX, clientY);
        return { x: g.x - ap.dragOffset.x, z: g.z - ap.dragOffset.z };
    }

    _onPointerUp(ev) {
        // Background tap → unfocus
        if (this.bgPointer) {
            const bp = this.bgPointer;
            this.bgPointer = null;
            const dx = ev.clientX - bp.downX;
            const dy = ev.clientY - bp.downY;
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX &&
                performance.now() - bp.downTime < TAP_MAX_MS) {
                this.cameraController.unfocus();
            }
            return;
        }

        if (!this.activePointer) return;
        const ap = this.activePointer;
        this.activePointer = null;

        if (ap.moved) {
            ap.card.endDrag();
            return;
        }

        // Stationary tap → re-raycast at the release position. The action only
        // fires if the release resolves to the SAME card AND SAME hit element
        // as the press. This makes accidental presses (drift onto/off of a
        // sub-element) cancel cleanly — pressing the toggle then sliding off
        // does nothing; pressing the toggle and lifting on the toggle fires.
        const releaseHit = this._raycastCard(ev.clientX, ev.clientY);
        if (!releaseHit || releaseHit.card !== ap.card) return;
        const r = ap.card.hitToLocalPixels(releaseHit.point);
        const releaseEl = ap.card.findElementAtPixels(r.face, r.px, r.py);
        if (releaseEl !== ap.hitEl) return;

        this._handleTap(ap.card, ap.hitEl);
    }

    _handleTap(card, hitEl) {
        // Toggle button → expand/compact toggle (does NOT focus the camera).
        if (hitEl.classList && hitEl.classList.contains('card-toggle')) {
            card.toggleExpanded();
            return;
        }

        // Anchor (back-face link, markdown link) → open the URL.
        if (hitEl.tagName === 'A') {
            const href = hitEl.getAttribute('href');
            if (href) window.open(href, '_blank', 'noopener');
            return;
        }
        if (hitEl.tagName === 'BUTTON') {
            hitEl.click();
            return;
        }

        // Default: card-level tap (focus / dblclick→flip).
        this._cardLevelTap(card);
    }

    _cardLevelTap(card) {
        const now = performance.now();
        const id = card.project.id;
        const last = this.lastClicks.get(id) || 0;
        if (now - last < DOUBLE_CLICK_MS) {
            card.toggleFlip();
            this.lastClicks.delete(id);
        } else {
            this.lastClicks.set(id, now);
            setTimeout(() => {
                if (this.lastClicks.get(id) === now) {
                    this.cameraController.focusOn(card);
                    this.lastClicks.delete(id);
                }
            }, DOUBLE_CLICK_MS + 10);
        }
    }
}
