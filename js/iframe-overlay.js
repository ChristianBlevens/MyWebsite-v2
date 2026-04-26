import * as THREE from 'three';
import { CARD_W, CARD_H, CARD_PX_W, CARD_PX_H } from './card.js';

const MAX_EXPANDED = 5;

// One iframe per card, all parented to a single stable top-level container
// (#iframe-stage). Iframes never reparent during normal operation — their DOM
// position is fixed for the lifetime of the page, and we just toggle visibility
// + reposition them each frame to track their card's screen rect. This avoids
// the iframe reload that occurs when an iframe is removed from / re-inserted
// into the document tree (visible as a black flash on real-site iframes).
//
// Positioning uses a 4-corner perspective transform (homography → CSS
// matrix3d), so the iframe perspective-tracks the card through any 3D
// orientation including mid-flip foreshortening.
//
// Visibility per frame:    expanded && faceUp && iframeUrl
// Pointer-events per frame: auto only when card is the focused card
// Cap:                     MAX_EXPANDED simultaneous expansions; expanding a
//                          new card while at the cap compacts the oldest.
//
// Shuffle exception: during shuffle, iframes are reparented into the CSS3D
// card DOM so the chaos motion looks correct. The black-flash and iframe
// state loss are masked by the shuffle motion. After the shuffle settles,
// iframes reattach to #iframe-stage and resume per-frame matrix3d tracking.
export class IframeOverlay {
    constructor() {
        this.stage = document.createElement('div');
        this.stage.id = 'iframe-stage';
        document.body.appendChild(this.stage);

        // Per-card floating toggle host — created lazily, lives in this
        // top-level container, positioned per frame to track its card. Always
        // visible (with native click) for any expanded+faceUp card so the
        // user can compact even when the iframe is interactive.
        this.toggleStage = document.createElement('div');
        this.toggleStage.id = 'iframe-toggle-stage';
        document.body.appendChild(this.toggleStage);

        this.cardIframes = new Map();   // card → iframe element
        this.cardToggles = new Map();   // card → toggle host element
        this.expandedOrder = [];        // expanded cards in age order (oldest first)
        this.focusedCard = null;
        this.shuffleMode = false;
        this.modalActive = false;

        this._tmpProj = new THREE.Vector3();
        this._corner = new THREE.Vector3();
        // Source corners are constant (the iframe / toggle-host's intrinsic
        // top-left, top-right, bottom-right, bottom-left in native pixels).
        this._srcCorners = [
            [0, 0], [CARD_PX_W, 0], [CARD_PX_W, CARD_PX_H], [0, CARD_PX_H],
        ];
    }

    registerCard(card) {
        // Stored implicitly via cardIframes once iframe is created. Nothing to
        // do at registration time — iframe is built lazily on first expand.
    }

    _ensureIframe(card) {
        let iframe = this.cardIframes.get(card);
        if (iframe) return iframe;
        if (!card.project.iframeUrl) return null;

        iframe = document.createElement('iframe');
        iframe.className = 'stage-iframe';
        iframe.loading = 'lazy';
        iframe.src = card.project.iframeUrl;
        iframe.setAttribute('sandbox',
            'allow-scripts allow-same-origin allow-forms allow-popups');
        iframe.style.display = 'none';
        this.stage.appendChild(iframe);
        this.cardIframes.set(card, iframe);
        return iframe;
    }

    _ensureToggle(card) {
        let host = this.cardToggles.get(card);
        if (host) return host;

        host = document.createElement('div');
        host.className = 'iframe-toggle-host';
        host.style.display = 'none';
        const btn = document.createElement('div');
        btn.className = 'card-toggle expanded';
        btn.innerHTML = '<div class="card-toggle-knob"></div>';
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            card.toggleExpanded();
        });
        host.appendChild(btn);
        this.toggleStage.appendChild(host);
        this.cardToggles.set(card, host);
        return host;
    }

    notifyExpanded(card) {
        const idx = this.expandedOrder.indexOf(card);
        if (idx >= 0) this.expandedOrder.splice(idx, 1);
        this.expandedOrder.push(card);
        // Cap enforcement: compact the oldest until we're under the cap.
        while (this.expandedOrder.length > MAX_EXPANDED) {
            const oldest = this.expandedOrder.shift();
            if (oldest !== card) oldest.compact();
        }
        this._ensureIframe(card);
        this._ensureToggle(card);
    }

    notifyCompacted(card) {
        const idx = this.expandedOrder.indexOf(card);
        if (idx >= 0) this.expandedOrder.splice(idx, 1);
    }

    setFocusedCard(card) {
        this.focusedCard = card;
    }

    // Gates iframe pointer-events globally. When a modal is open, no iframe
    // (even on the focused card) should steal events from the modal panel.
    setModalActive(active) {
        this.modalActive = active;
    }

    // Shuffle mode: temporarily reparent each expanded iframe into its card's
    // CSS3D DOM (.card-top), so it rotates / tumbles with the card naturally.
    // Iframe will reload (black flash, state loss) — acceptable cover during
    // shuffle's visual chaos.
    enterShuffleMode() {
        if (this.shuffleMode) return;
        this.shuffleMode = true;
        for (const [card, iframe] of this.cardIframes) {
            if (!card.expanded) continue;
            const cardTop = card.frontEl.querySelector('.card-top');
            if (!cardTop) continue;
            iframe.style.transform = '';
            iframe.style.left = '';
            iframe.style.top = '';
            iframe.style.position = 'absolute';
            iframe.style.inset = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.display = '';
            cardTop.appendChild(iframe);
        }
        // Hide overlay toggles during shuffle (iframe is now inside the card,
        // and the in-card .card-toggle remains hidden because expanded; that's
        // fine — the user isn't going to click anything mid-shuffle).
        for (const host of this.cardToggles.values()) host.style.display = 'none';
    }

    exitShuffleMode() {
        if (!this.shuffleMode) return;
        this.shuffleMode = false;
        for (const [card, iframe] of this.cardIframes) {
            if (iframe.parentElement !== this.stage) {
                iframe.style.position = 'absolute';
                iframe.style.inset = '';
                iframe.style.width = CARD_PX_W + 'px';
                iframe.style.height = CARD_PX_H + 'px';
                this.stage.appendChild(iframe);
            }
        }
    }

    // Called from animate() AFTER renders so pivot.matrixWorld is current.
    update(camera) {
        if (this.shuffleMode) return;

        for (const [card, iframe] of this.cardIframes) {
            const visible = card.expanded && card.faceUp;
            if (!visible) { iframe.style.display = 'none'; continue; }
            const dst = this._projectCardCorners(card, camera);
            this._applyMatrix3dTransform(iframe, dst);
            iframe.style.display = '';
            iframe.style.pointerEvents =
                (!this.modalActive && card === this.focusedCard) ? 'auto' : 'none';
        }

        for (const [card, host] of this.cardToggles) {
            const visible = card.expanded && card.faceUp;
            if (!visible) { host.style.display = 'none'; continue; }
            const dst = this._projectCardCorners(card, camera);
            this._applyMatrix3dTransform(host, dst);
            host.style.display = '';
        }
    }

    // Project the card's 4 plane corners (in pivot-local card-rectangle order:
    // top-left, top-right, bottom-right, bottom-left) into screen pixels.
    // Order matches _srcCorners so the homography maps source DOM corners
    // 1:1 onto these destination screen corners.
    //
    // Local-to-DOM mapping derivation: hitPlane has rotation.x = -π/2, so its
    // in-plane axes are pivot +X (= card-width axis) and pivot +Z. Front face
    // CSS3DObject with rotation.x = -π/2 maps element +Y → pivot -Z, so DOM-top
    // is at local Z = -halfH. → corner 0 (DOM top-left) is (-halfW, -halfH).
    _projectCardCorners(card, camera) {
        const w = window.innerWidth, h = window.innerHeight;
        const sx = card.scaleCurrent;
        const halfW = CARD_W * sx / 2;
        const halfH = CARD_H * sx / 2;
        const localCorners = [
            [-halfW, -halfH], [+halfW, -halfH], [+halfW, +halfH], [-halfW, +halfH],
        ];
        const dst = [];
        for (let i = 0; i < 4; i++) {
            this._corner.set(localCorners[i][0], 0, localCorners[i][1]);
            card.pivot.localToWorld(this._corner);
            this._tmpProj.copy(this._corner).project(camera);
            dst.push([
                (this._tmpProj.x * 0.5 + 0.5) * w,
                (1 - (this._tmpProj.y * 0.5 + 0.5)) * h,
            ]);
        }
        return dst;
    }

    _applyMatrix3dTransform(el, dstCorners) {
        const H = general2DProjection(this._srcCorners, dstCorners);
        // Normalize so H[2][2] = 1 (helps with floating-point precision).
        const k = 1 / H[8];
        for (let i = 0; i < 9; i++) H[i] *= k;
        // Lift 3×3 → 4×4 by inserting identity Z row/column. CSS matrix3d is
        // column-major: 16 values listed column-by-column.
        // 3×3 entries (row-major in H): a=H0 b=H1 c=H2 / d=H3 e=H4 f=H5 / g=H6 h=H7 i=H8
        // 4×4:  | a b 0 c |        column 0: a, d, 0, g
        //       | d e 0 f |        column 1: b, e, 0, h
        //       | 0 0 1 0 |        column 2: 0, 0, 1, 0
        //       | g h 0 i |        column 3: c, f, 0, i
        el.style.transform =
            `matrix3d(${H[0]},${H[3]},0,${H[6]},` +
            `${H[1]},${H[4]},0,${H[7]},` +
            `0,0,1,0,` +
            `${H[2]},${H[5]},0,${H[8]})`;
    }
}

// --- 3×3 matrix utilities and 2D projective transform (Jonas Wagner, 2013).
// Maps 4 source 2D points → 4 destination 2D points by composing two
// canonical-basis-to-quad mappings via the adjugate (cofactor transpose),
// avoiding an explicit linear solve. Returns a 9-element row-major matrix.

function adj(m) {
    return [
        m[4]*m[8] - m[5]*m[7], m[2]*m[7] - m[1]*m[8], m[1]*m[5] - m[2]*m[4],
        m[5]*m[6] - m[3]*m[8], m[0]*m[8] - m[2]*m[6], m[2]*m[3] - m[0]*m[5],
        m[3]*m[7] - m[4]*m[6], m[1]*m[6] - m[0]*m[7], m[0]*m[4] - m[1]*m[3],
    ];
}

function multmm(a, b) {
    const c = new Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let cij = 0;
            for (let k = 0; k < 3; k++) cij += a[3*i + k] * b[3*k + j];
            c[3*i + j] = cij;
        }
    }
    return c;
}

function multmv(m, v) {
    return [
        m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
        m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
        m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
    ];
}

function basisToPoints(p1, p2, p3, p4) {
    const m = [
        p1[0], p2[0], p3[0],
        p1[1], p2[1], p3[1],
        1,     1,     1,
    ];
    const v = multmv(adj(m), [p4[0], p4[1], 1]);
    return multmm(m, [
        v[0], 0,    0,
        0,    v[1], 0,
        0,    0,    v[2],
    ]);
}

function general2DProjection(src, dst) {
    const s = basisToPoints(src[0], src[1], src[2], src[3]);
    const d = basisToPoints(dst[0], dst[1], dst[2], dst[3]);
    return multmm(d, adj(s));
}
