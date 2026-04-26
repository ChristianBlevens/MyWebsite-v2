import * as THREE from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCardBody, BOUNDS, randomSpawnPos } from './physics.js';
import {
    Layout,
    CARD_W, CARD_H, CARD_T,
    CARD_PX_W, CARD_PX_H,
    CSS_BASE_SCALE,
    CELL_SIZE,
} from './layout.js';
import {
    renderFrontStaticCanvas,
    renderFrontBottomTextCanvas,
    renderTogglePillCanvas,
    getGenericBackCanvas,
    TOGGLE_RECT,
    TOP_REGION_FRACTION,
    BORDER_RADIUS as CANVAS_BORDER_RADIUS,
} from './card-texture.js';

// Card dimensions and authoring resolution come from layout.js (derived from
// the global cell size). Re-exported here so existing imports from card.js
// (e.g. iframe-overlay.js) keep working.
export { CARD_W, CARD_H, CARD_T, CARD_PX_W, CARD_PX_H };

export const EXPANDED_SCALE = 2.2;

// Scratch objects reused across updates to avoid per-frame allocation.
const _flipAxis = new THREE.Vector3(1, 0, 0);
const _flipDelta = new THREE.Quaternion();
const _slerpOut = new THREE.Quaternion();
const _bodyUp = new THREE.Vector3(0, 1, 0);
const _upOut = new THREE.Vector3();

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Animated thumbnails are MP4 (imgur auto-transcodes uploaded GIFs to MP4
// at the same URL, just with the extension swapped). MP4 is hardware-decoded
// where GIF is JS/canvas-decoded — orders of magnitude cheaper on mobile.
// Static thumbnails stay as <img>.
function isVideoUrl(url) {
    return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url || '');
}

function thumbnailMarkup(url) {
    if (!url) return '';
    if (isVideoUrl(url)) {
        return `<video class="card-thumbnail" src="${escapeHtml(url)}" muted loop autoplay playsinline preload="metadata"></video>`;
    }
    return `<img class="card-thumbnail" src="${escapeHtml(url)}" alt="">`;
}

// Geometry for the video plane at the top of a video-thumbnail card. Top
// corners are rounded to match the canvas-clipped border radius on the rest
// of the card faces; bottom corners are square (they butt up against the
// text region below). Custom UVs map vertex (x,y) to (0..1, 0..1) over the
// shape's bounding box so the VideoTexture stretches exactly across it.
function buildRoundedTopPlane(width, height, radius) {
    const w2 = width / 2;
    const h2 = height / 2;
    const r = Math.min(radius, Math.min(width, height) / 2);

    const shape = new THREE.Shape();
    shape.moveTo(-w2 + r, +h2);
    shape.lineTo(+w2 - r, +h2);
    shape.quadraticCurveTo(+w2, +h2, +w2, +h2 - r);
    shape.lineTo(+w2, -h2);
    shape.lineTo(-w2, -h2);
    shape.lineTo(-w2, +h2 - r);
    shape.quadraticCurveTo(-w2, +h2, -w2 + r, +h2);

    const geom = new THREE.ShapeGeometry(shape);
    // ShapeGeometry uses raw vertex coords as UVs by default — remap to
    // [0..1] over the bbox so the texture stretches like a PlaneGeometry.
    const pos = geom.getAttribute('position');
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        uvs[i * 2]     = (pos.getX(i) + w2) / width;
        uvs[i * 2 + 1] = (pos.getY(i) + h2) / height;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return geom;
}

export class Card {
    constructor(project, world, iframeOverlay = null) {
        this.project = project;
        this.world = world;
        this.iframeOverlay = iframeOverlay;

        // Expand state
        this.expanded = false;
        this.scaleCurrent = 1;

        // Filter state
        this.filteredOut = false;

        // Flip animation state
        this.flipping = false;
        this.flipT = 0;
        this.flipDuration = 0.45;
        this.flipStartQuat = new THREE.Quaternion();
        this.flipEndQuat = new THREE.Quaternion();

        // Drag state
        this.dragTarget = null;
        this.dragging = false;

        this.faceUp = true;
        this._descriptionRendered = false;

        // Hysteresis state for pivot transform writes — see update() step 4.
        this._lastTrX = 0; this._lastTrY = 0; this._lastTrZ = 0;
        this._lastRtX = 0; this._lastRtY = 0; this._lastRtZ = 0; this._lastRtW = 1;
        this._pivotInited = false;
        this._prevFaceUp = null;

        // Two representations:
        //   'textured' — WebGL plane meshes with baked CanvasTextures (and
        //                VideoTexture for animated thumbnails). Default state
        //                for compact, unfocused cards. Cheap on mobile because
        //                each card is one (or a few) WebGL draw calls instead
        //                of a 1260×1890 GPU compositor layer.
        //   'css3d'    — live DOM via CSS3DObject. Used only while the card is
        //                focused or expanded — i.e. when the user is actually
        //                reading text / clicking links / using a live iframe.
        // Swapped by _setRepresentation() based on focus/expand state.
        this.representation = 'textured';
        this._isFocused = false;

        // DOM: two separate face elements (used in 'css3d' representation)
        this.frontEl = this._buildFrontEl();
        this.backEl = this._buildBackEl();

        // CSS3DObjects: one per face, positioned on either side of the card body.
        // Hidden initially — only shown when representation === 'css3d'.
        // Faces are INSET inside the body (at body-top - 0.001 and
        // body-bottom + 0.001) rather than extended outside it. The textured
        // representation (below) shares this convention so the back mesh
        // never dips below the floor when the card rests on it (which would
        // otherwise cause depth-buffer fighting with the table mesh).
        this.frontObj = new CSS3DObject(this.frontEl);
        this.frontObj.position.set(0, +CARD_T / 2 - 0.001, 0);
        this.frontObj.rotation.x = -Math.PI / 2;
        this.frontObj.scale.setScalar(CSS_BASE_SCALE);
        this.frontObj.visible = false;

        this.backObj = new CSS3DObject(this.backEl);
        this.backObj.position.set(0, -CARD_T / 2 + 0.001, 0);
        this.backObj.rotation.x = +Math.PI / 2;
        this.backObj.scale.setScalar(CSS_BASE_SCALE);
        this.backObj.visible = false;

        this.pivot = new THREE.Group();
        this.pivot.add(this.frontObj);
        this.pivot.add(this.backObj);

        // Textured-plane representation (WebGL meshes parented to pivot).
        this.frontMeshes = [];
        this.frontVideo = null;
        this._buildTexturedFront();
        this._buildTexturedBack();

        // Invisible hit-plane (raycast target). Lies flat in card-local space,
        // matches card width/depth. Parented to pivot so it tracks position,
        // rotation, and (via scale) the expansion state.
        const hitGeom = new THREE.PlaneGeometry(CARD_W, CARD_H);
        const hitMat = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.hitPlane = new THREE.Mesh(hitGeom, hitMat);
        this.hitPlane.rotation.x = -Math.PI / 2;
        this.hitPlane.userData.card = this;
        this.pivot.add(this.hitPlane);

        // Physics body
        this.body = createCardBody(world, CARD_W, CARD_H, CARD_T);

        this.iframeOverlay?.registerCard(this);

        // Random starting pose on the table — bounded to the play area minus
        // a small margin so cards don't spawn flush against a wall.
        const margin = CELL_SIZE * 1.5;
        const startX = (Math.random() - 0.5) * Math.max(0.1, Layout.playW - margin * 2);
        const startZ = (Math.random() - 0.5) * Math.max(0.1, Layout.playD - margin * 2);
        const startYaw = (Math.random() - 0.5) * 0.8;
        this.body.setTranslation({ x: startX, y: CARD_T / 2 + 0.05, z: startZ }, true);
        const halfYaw = startYaw / 2;
        this.body.setRotation(
            { x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) },
            true
        );
    }

    _buildFrontEl() {
        const el = document.createElement('div');
        el.className = 'card card-front-only face-up';
        el.style.width = CARD_PX_W + 'px';
        el.style.height = CARD_PX_H + 'px';
        el.dataset.projectId = this.project.id;
        el.dataset.face = 'front';
        // Iframe is NOT in this DOM — IframeOverlay owns one iframe per card,
        // parented to a stable top-level container. The card just shows the
        // thumbnail when compact; when expanded, the overlay's iframe sits
        // visually on top of this empty card-top.
        // Toggle pill is only meaningful on cards with a live iframe (it
        // expands the card so the iframe is usable). Non-iframe cards omit it
        // entirely — there's nothing to toggle to.
        const toggleHtml = this.project.iframeUrl
            ? `<div class="card-toggle" data-action="toggle" title="Toggle live view">
                   <div class="card-toggle-knob"></div>
               </div>`
            : '';
        el.innerHTML = `
            ${toggleHtml}
            <div class="card-top">
                ${thumbnailMarkup(this.project.thumbnail)}
            </div>
            <div class="card-bottom">
                <h3 class="card-title">${escapeHtml(this.project.title)}</h3>
                <p class="card-summary">${escapeHtml(this.project.summary)}</p>
                <div class="card-tags">
                    ${(this.project.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
                </div>
            </div>
        `;
        return el;
    }

    _buildBackEl() {
        const el = document.createElement('div');
        el.className = 'card card-back-only';
        el.style.width = CARD_PX_W + 'px';
        el.style.height = CARD_PX_H + 'px';
        el.dataset.projectId = this.project.id;
        el.dataset.face = 'back';
        const toggleHtml = this.project.iframeUrl
            ? `<div class="card-toggle" data-action="toggle" title="Toggle live view">
                   <div class="card-toggle-knob"></div>
               </div>`
            : '';
        el.innerHTML = `
            ${toggleHtml}
            <h3 class="card-title">${escapeHtml(this.project.title)}</h3>
            <div class="card-description"></div>
            <div class="card-tags">
                ${(this.project.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
            </div>
            <div class="card-links">
                ${this.project.liveUrl
                    ? `<a class="card-link card-live" href="${escapeHtml(this.project.liveUrl)}" target="_blank" rel="noopener">Open Live</a>`
                    : ''}
                ${this.project.github
                    ? `<a class="card-link card-github" href="${escapeHtml(this.project.github)}" target="_blank" rel="noopener">GitHub</a>`
                    : ''}
            </div>
        `;
        return el;
    }

    allElements() {
        return [this.frontEl, this.backEl];
    }

    // --- Textured representation -----------------------------------------

    _buildTexturedFront() {
        const project = this.project;
        const isVideo = project.thumbnail && /\.(mp4|webm|mov)(?:[?#]|$)/i.test(project.thumbnail);

        // Group wrapper so scale.setScalar(scaleCurrent) on the group scales
        // both the geometry and the relative positions of partial-sized planes
        // (video case) consistently. Without the wrapper, scaling individual
        // meshes would scale their geometry but not their offset positions.
        this.frontGroup = new THREE.Group();
        this.pivot.add(this.frontGroup);

        if (isVideo) {
            // Top region: VideoTexture plane (GPU-direct from <video>, no
            // per-frame canvas re-upload). Sized to the top 55% of the card.
            const video = document.createElement('video');
            video.src = project.thumbnail;
            video.muted = true;
            video.loop = true;
            video.autoplay = true;
            video.playsInline = true;
            video.crossOrigin = 'anonymous';
            video.preload = 'auto';
            // Mobile autoplay needs the muted+playsinline combo plus a play()
            // call. The promise rejection (e.g., suspended audio context) is
            // silently swallowed; user can resume by interacting with the page.
            video.play().catch(() => {});
            this.frontVideo = video;

            const videoTex = new THREE.VideoTexture(video);
            videoTex.colorSpace = THREE.SRGBColorSpace;
            videoTex.minFilter = THREE.LinearFilter;
            const videoMat = new THREE.MeshBasicMaterial({
                map: videoTex, side: THREE.FrontSide,
            });
            const topH = CARD_H * TOP_REGION_FRACTION;
            // Convert canvas-pixel border radius → world units so the rounded
            // top corners line up with the canvas-clipped rounded shape on
            // the textPlane (and on the static-card / back textures).
            const cornerR = (CANVAS_BORDER_RADIUS / CARD_PX_W) * CARD_W;
            const topGeom = buildRoundedTopPlane(CARD_W, topH, cornerR);
            const topPlane = new THREE.Mesh(topGeom, videoMat);
            topPlane.rotation.x = -Math.PI / 2;
            // Plane geometry's local +Y maps (after rotation.x=-π/2) to pivot -Z.
            // The top-of-card sits at pivot Z = -CARD_H/2; centering the
            // video plane there means its center is at Z = -CARD_H/2 + topH/2.
            topPlane.position.set(0, +CARD_T / 2 - 0.003, -CARD_H / 2 + topH / 2);
            this.frontMeshes.push(topPlane);

            // Text region: full-card-sized canvas, transparent above the text
            // so the video plane shows through. Drawn at +0.002 in Y to layer
            // above the video plane (no bleed where they could overlap at the
            // 55%/45% seam thanks to the matching geometry sizes, but the
            // small offset prevents z-fighting).
            const textCanvas = renderFrontBottomTextCanvas(project);
            const textTex = new THREE.CanvasTexture(textCanvas);
            textTex.colorSpace = THREE.SRGBColorSpace;
            const textMat = new THREE.MeshBasicMaterial({
                map: textTex, transparent: true, alphaTest: 0.01,
                side: THREE.FrontSide,
            });
            const textPlane = new THREE.Mesh(
                new THREE.PlaneGeometry(CARD_W, CARD_H), textMat);
            textPlane.rotation.x = -Math.PI / 2;
            textPlane.position.set(0, +CARD_T / 2 - 0.002, 0);
            this.frontMeshes.push(textPlane);

            // Toggle pill overlay (only for cards with iframeUrl). Separate
            // plane because we can't composite onto a VideoTexture.
            if (project.iframeUrl) {
                const pillCanvas = renderTogglePillCanvas(project);
                const pillTex = new THREE.CanvasTexture(pillCanvas);
                pillTex.colorSpace = THREE.SRGBColorSpace;
                const pillMat = new THREE.MeshBasicMaterial({
                    map: pillTex, transparent: true, alphaTest: 0.01,
                    side: THREE.FrontSide,
                });
                const pillPlane = new THREE.Mesh(
                    new THREE.PlaneGeometry(CARD_W, CARD_H), pillMat);
                pillPlane.rotation.x = -Math.PI / 2;
                pillPlane.position.set(0, +CARD_T / 2 - 0.001, 0);
                this.frontMeshes.push(pillPlane);
            }
        } else {
            // Single composited canvas — bg + thumbnail (if any) + text + toggle
            // + border, all in one texture. Cards with no thumbnail get the
            // dark placeholder background in the top region for free.
            const canvas = renderFrontStaticCanvas(project, null);
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            const mat = new THREE.MeshBasicMaterial({
                map: tex, transparent: true, alphaTest: 0.01,
                side: THREE.FrontSide,
            });
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(CARD_W, CARD_H), mat);
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(0, +CARD_T / 2 - 0.002, 0);
            this.frontMeshes.push(plane);

            // Async thumbnail load: when the image arrives, redraw the canvas
            // with the thumbnail composited in and mark the texture dirty.
            if (project.thumbnail) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const fresh = renderFrontStaticCanvas(project, img);
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(fresh, 0, 0);
                    tex.needsUpdate = true;
                };
                img.src = project.thumbnail;
            }
        }

        for (const m of this.frontMeshes) this.frontGroup.add(m);
    }

    _buildTexturedBack() {
        const canvas = getGenericBackCanvas();
        // The back is identical for every card → share one texture instance.
        if (!Card._sharedBackTexture) {
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            Card._sharedBackTexture = tex;
        }
        const mat = new THREE.MeshBasicMaterial({
            map: Card._sharedBackTexture, transparent: true, alphaTest: 0.01,
            side: THREE.FrontSide,
        });
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(CARD_W, CARD_H), mat);
        plane.rotation.x = +Math.PI / 2;
        plane.position.set(0, -CARD_T / 2 + 0.002, 0);

        this.backGroup = new THREE.Group();
        this.backGroup.add(plane);
        this.pivot.add(this.backGroup);
        this.backMesh = plane;
    }

    // Swap between textured (default) and css3d (focused or expanded). Cheap:
    // toggles .visible flags; both representations stay parented to the pivot.
    _setRepresentation(mode) {
        if (this.representation === mode) return;
        this.representation = mode;
        const css3d = (mode === 'css3d');
        if (this.frontGroup) this.frontGroup.visible = !css3d;
        if (this.backGroup) this.backGroup.visible = !css3d;
        this.frontObj.visible = css3d;
        this.backObj.visible = css3d;
        // Pause the video element when CSS3D takes over — saves the decoder
        // doing work for a texture that isn't being sampled.
        if (this.frontVideo) {
            if (css3d) this.frontVideo.pause();
            else this.frontVideo.play().catch(() => {});
        }
        // Symmetric handling for the live-DOM <video> shown in css3d mode.
        // Built with autoplay, but the element is display:none until the
        // CSS3DObject becomes visible — Chromium's autoplay policy defers
        // playback in that state and does not retry on visibility flip,
        // leaving the video frozen on its first decoded frame.
        const domVideo = this.frontEl.querySelector('video.card-thumbnail');
        if (domVideo) {
            if (css3d) domVideo.play().catch(() => {});
            else domVideo.pause();
        }
    }

    // Called by CameraController when this card becomes / stops being focused.
    setFocused(focused) {
        this._isFocused = focused;
        if (focused) this._setRepresentation('css3d');
        else if (!this.expanded) this._setRepresentation('textured');
    }

    // Convert a world-space raycast hit point on this card's hit-plane into
    // (face, element, px, py) where px/py are in the rendered DOM card's
    // native pixel coordinate space (CARD_PX_W × CARD_PX_H).
    //
    // Mapping derivation: hitPlane is parented to pivot with rotation.x=-π/2,
    // so its normal is pivot-local +Y and the in-plane axes are pivot-local
    // X (= card-width axis) and Z (= card-height axis). Front face element
    // (rotation.x=-π/2, position +Y) has its DOM "top" pointing pivot -Z and
    // its DOM "right" pointing pivot +X. Back face is mirrored horizontally
    // (DOM "right" → pivot -X) like the back of a real card.
    hitToLocalPixels(worldHitPoint) {
        const local = this.pivot.worldToLocal(worldHitPoint.clone());
        // Divide by scaleCurrent because the hitPlane mesh scales with
        // expansion — without this, expanded cards overflow the [0..1] range.
        const s = this.scaleCurrent || 1;
        const u = (local.x / s + CARD_W / 2) / CARD_W;     // 0..1 along pivot +X
        const v = (local.z / s + CARD_H / 2) / CARD_H;     // 0..1 along pivot +Z

        const face = this.faceUp ? 'front' : 'back';
        const el = this.faceUp ? this.frontEl : this.backEl;
        // Front element rotation.x = -π/2 maps DOM-top (element +Y) → pivot -Z
        //   → v=0 (local.z = -H/2) is DOM-top. py = v.
        //   DOM-right (element +X) → pivot +X → u=1 is DOM-right. px = u.
        // Back element rotation.x = +π/2 maps DOM-top (element +Y) → pivot +Z
        //   → v=1 (local.z = +H/2) is DOM-top. py = 1 - v (inverted).
        //   DOM-right (element +X) → pivot +X (same as front, no mirror). px = u.
        const pyNorm = (face === 'back') ? (1 - v) : v;
        return {
            face,
            el,
            px: u * CARD_PX_W,
            py: pyNorm * CARD_PX_H,
        };
    }

    // Walk the chosen face's known interactive descendants and return the
    // deepest one whose layout box contains (px, py). Falls back to the root
    // face element (which means "card-level click").
    findElementAtPixels(face, px, py) {
        // Textured (compact) cards have no live DOM — there is no offsetLeft/
        // offsetWidth to read. The only interactable region is the toggle pill
        // on iframe-capable cards' front face, hit-tested against the same
        // hardcoded rect used to draw it.
        if (this.representation === 'textured') {
            if (face === 'front' && this.project.iframeUrl) {
                if (px >= TOGGLE_RECT.x && px < TOGGLE_RECT.x + TOGGLE_RECT.w
                    && py >= TOGGLE_RECT.y && py < TOGGLE_RECT.y + TOGGLE_RECT.h) {
                    if (!this._fakeToggleEl) this._fakeToggleEl = {
                        classList: { contains: (c) => c === 'card-toggle' },
                        tagName: 'DIV',
                    };
                    return this._fakeToggleEl;
                }
            }
            if (!this._fakeRootEl) this._fakeRootEl = {
                classList: { contains: () => false },
                tagName: 'DIV',
            };
            return this._fakeRootEl;
        }
        // CSS3D (focused / expanded): walk the live DOM as before.
        const root = face === 'front' ? this.frontEl : this.backEl;
        const candidates = root.querySelectorAll(
            '.card-toggle, a, button'
        );
        for (const el of candidates) {
            let x = 0, y = 0;
            let cur = el;
            while (cur && cur !== root) {
                x += cur.offsetLeft;
                y += cur.offsetTop;
                cur = cur.offsetParent;
            }
            if (px >= x && px < x + el.offsetWidth &&
                py >= y && py < y + el.offsetHeight) {
                return el;
            }
        }
        return root;
    }

    _computeFaceUp() {
        // Rotate the body's local +Y by the body quaternion; if resulting world Y > 0, front is up.
        const r = this.body.rotation();
        _upOut.copy(_bodyUp).applyQuaternion({ x: r.x, y: r.y, z: r.z, w: r.w });
        return _upOut.y > 0;
    }

    toggleExpanded() {
        this.expanded = !this.expanded;

        // Sync knob position on both face toggles so the switch state is
        // visible regardless of which side the user just looked at.
        for (const root of [this.frontEl, this.backEl]) {
            root.querySelector('.card-toggle')?.classList.toggle('expanded', this.expanded);
        }
        // .expanded class on frontEl now only hides the in-card toggle (the
        // floating overlay toggle replaces it). No layout reflow.
        this.frontEl.classList.toggle('expanded', this.expanded);

        if (this.expanded) {
            this.iframeOverlay?.notifyExpanded(this);
            // Expanded cards always need live DOM (iframe overlay + interactive
            // back face when flipped).
            this._setRepresentation('css3d');
        } else {
            this.iframeOverlay?.notifyCompacted(this);
            // Drop back to textured unless we're still the focused card.
            if (!this._isFocused) this._setRepresentation('textured');
        }
    }

    // Force-compact (used by the overlay's expansion-cap eviction).
    compact() {
        if (this.expanded) this.toggleExpanded();
    }

    toggleFlip() {
        if (this.flipping) return;

        // Lazy-render markdown on first flip to back
        if (this.faceUp && !this._descriptionRendered && window.markdownit) {
            const md = window.markdownit({ html: false, linkify: true });
            this.backEl.querySelector('.card-description').innerHTML = md.render(this.project.description || '');
            this._descriptionRendered = true;
        }

        this.flipping = true;
        this.flipT = 0;

        // Freeze physics during the flip animation.
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

        const r = this.body.rotation();
        this.flipStartQuat.set(r.x, r.y, r.z, r.w);
        // 180° rotation applied in body-local X
        _flipDelta.setFromAxisAngle(_flipAxis, Math.PI);
        this.flipEndQuat.copy(this.flipStartQuat).multiply(_flipDelta);
    }

    setFilteredOut(out) {
        if (out === this.filteredOut) return;
        this.filteredOut = out;
        this.frontEl.classList.toggle('filtered-out', out);
        this.backEl.classList.toggle('filtered-out', out);
        // Also dim the textured plane materials. CSS rule covers the css3d
        // representation; this covers the textured representation.
        const dim = out ? 0.25 : 1;
        const apply = (mesh) => {
            if (!mesh || !mesh.material) return;
            mesh.material.transparent = true;
            mesh.material.opacity = dim;
        };
        for (const m of this.frontMeshes) apply(m);
        apply(this.backMesh);
    }

    beginDrag(targetXZ) {
        if (this.flipping) return;
        this.dragTarget = { x: targetXZ.x, z: targetXZ.z };
        this.dragging = true;
        this.body.wakeUp();
        this.frontEl.classList.add('dragging');
        this.backEl.classList.add('dragging');
    }

    updateDragTarget(targetXZ) {
        if (!this.dragging) return;
        this.dragTarget = { x: targetXZ.x, z: targetXZ.z };
    }

    endDrag() {
        this.dragging = false;
        this.dragTarget = null;
        this.frontEl.classList.remove('dragging');
        this.backEl.classList.remove('dragging');
        const av = this.body.angvel();
        this.body.setAngvel({ x: 0, y: av.y * 0.3, z: 0 }, true);
    }

    applyShuffleImpulse(strength = 1) {
        if (this.flipping || this.dragging) return;
        this.body.wakeUp();
        // Mass is fixed at 1; linearDamping is constant so visible travel
        // distance scales with impulse 1:1. Scaling impulse by scaleCurrent²
        // (instead of just ×scaleCurrent) makes expanded cards travel
        // noticeably farther than compact ones rather than just "the same
        // relative to their own size." Torque uses the same factor — cuboid
        // moment of inertia for fixed mass scales with size², so torque²
        // preserves angular velocity at scale.
        const s = strength * this.scaleCurrent * this.scaleCurrent;
        // 90% random direction + 10% bias toward the play-area center, so
        // shuffles tend to converge cards toward the middle rather than
        // sticking everything against the walls.
        const pos = this.body.translation();
        const distXZ = Math.hypot(pos.x, pos.z);
        const cx = distXZ > 1e-3 ? -pos.x / distXZ : 0;
        const cz = distXZ > 1e-3 ? -pos.z / distXZ : 0;
        const rx = Math.random() - 0.5;
        const rz = Math.random() - 0.5;
        const dirX = 0.9 * rx + 0.1 * cx;
        const dirZ = 0.9 * rz + 0.1 * cz;
        this.body.applyImpulse({
            x: dirX * 50 * s,
            y: (8 + Math.random() * 18) * s,
            z: dirZ * 50 * s,
        }, true);
        this.body.applyTorqueImpulse({
            x: (Math.random() - 0.5) * 10 * s,
            y: (Math.random() - 0.5) * 10 * s,
            z: (Math.random() - 0.5) * 10 * s,
        }, true);
    }

    update(dt) {
        // 1. Flip animation — drive the body's rotation directly.
        if (this.flipping) {
            this.flipT += dt / this.flipDuration;
            const t = Math.min(1, this.flipT);
            const eased = t * t * (3 - 2 * t);
            _slerpOut.copy(this.flipStartQuat).slerp(this.flipEndQuat, eased);
            this.body.setRotation(
                { x: _slerpOut.x, y: _slerpOut.y, z: _slerpOut.z, w: _slerpOut.w },
                true
            );
            // Arc lift so the card rises off the table mid-flip
            const baseY = CARD_T / 2 + 0.05;
            const pos = this.body.translation();
            this.body.setTranslation(
                { x: pos.x, y: baseY + Math.sin(eased * Math.PI) * 2.0, z: pos.z },
                true
            );
            this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            if (t >= 1) {
                this.flipping = false;
            }
        }
        // 2. Spring drag — push the body toward the pointer target with bounded velocity.
        else if (this.dragging && this.dragTarget) {
            const p = this.body.translation();
            const dx = this.dragTarget.x - p.x;
            const dz = this.dragTarget.z - p.z;
            const kP = 18;
            const maxSpeed = 50;
            let vx = dx * kP;
            let vz = dz * kP;
            const speed = Math.hypot(vx, vz);
            if (speed > maxSpeed) {
                const s = maxSpeed / speed;
                vx *= s; vz *= s;
            }
            this.body.setLinvel({ x: vx, y: 0, z: vz }, true);
            // Keep card flat while dragging
            const av = this.body.angvel();
            this.body.setAngvel({ x: 0, y: av.y * 0.85, z: 0 }, true);
        }

        // 3. Smooth scale (expansion toggle)
        const scaleTarget = this.expanded ? EXPANDED_SCALE : 1;
        this.scaleCurrent += (scaleTarget - this.scaleCurrent) * Math.min(1, dt * 6);
        this.frontObj.scale.setScalar(CSS_BASE_SCALE * this.scaleCurrent);
        this.backObj.scale.setScalar(CSS_BASE_SCALE * this.scaleCurrent);
        this.hitPlane.scale.setScalar(this.scaleCurrent);
        // Textured planes are authored in real-world units, so scaling the
        // group directly with scaleCurrent (no CSS_BASE_SCALE factor) gives
        // them the same expansion behavior as the css3d representation.
        if (this.frontGroup) this.frontGroup.scale.setScalar(this.scaleCurrent);
        if (this.backGroup) this.backGroup.scale.setScalar(this.scaleCurrent);
        this.body.collider(0).setHalfExtents({
            x: (CARD_W / 2) * this.scaleCurrent,
            y: CARD_T / 2,
            z: (CARD_H / 2) * this.scaleCurrent,
        });

        // 4. Sync pivot to physics body. Safety check: if a card has somehow
        // escaped and fallen below the floor, teleport it back to a random spot
        // on the table with zero velocity. Only the lower Y bound matters —
        // walls + CCD + ceiling handle everything else.
        let tr = this.body.translation();
        if (tr.y < BOUNDS.yMin) {
            const p = randomSpawnPos();
            this.body.setTranslation(p, true);
            this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            tr = this.body.translation();
        }
        const rt = this.body.rotation();
        // Hysteresis: Rapier bodies in mutual contact never reach sleep
        // threshold, so translation()/rotation() jitter at ~1e-6 every frame.
        // Propagating that to pivot → CSS3DRenderer rewrites matrix3d → GPU
        // layer paint-invalidates every frame. Skip the write when both
        // deltas are sub-visible.
        const dx = tr.x - this._lastTrX;
        const dy = tr.y - this._lastTrY;
        const dz = tr.z - this._lastTrZ;
        const posDeltaSq = dx * dx + dy * dy + dz * dz;
        const rotDot = rt.x * this._lastRtX + rt.y * this._lastRtY
                     + rt.z * this._lastRtZ + rt.w * this._lastRtW;
        const POS_THRESH_SQ = 5e-4 * 5e-4;
        const ROT_DOT_THRESH = 0.9999999;
        if (!this._pivotInited
            || posDeltaSq > POS_THRESH_SQ
            || Math.abs(rotDot) < ROT_DOT_THRESH) {
            this.pivot.position.set(tr.x, tr.y, tr.z);
            this.pivot.quaternion.set(rt.x, rt.y, rt.z, rt.w);
            this._lastTrX = tr.x; this._lastTrY = tr.y; this._lastTrZ = tr.z;
            this._lastRtX = rt.x; this._lastRtY = rt.y;
            this._lastRtZ = rt.z; this._lastRtW = rt.w;
            this._pivotInited = true;
        }

        // 5. Face-up tracking + pointer-events gating (counters CSS3DRenderer's inline 'auto' override)
        const nowFaceUp = this._computeFaceUp();
        this.faceUp = nowFaceUp;
        if (nowFaceUp !== this._prevFaceUp) {
            this.frontEl.style.pointerEvents = nowFaceUp ? 'auto' : 'none';
            this.backEl.style.pointerEvents  = nowFaceUp ? 'none' : 'auto';
            this.frontEl.classList.toggle('face-up', nowFaceUp);
            this.backEl.classList.toggle('face-up', !nowFaceUp);
            this._prevFaceUp = nowFaceUp;
        }
    }
}
