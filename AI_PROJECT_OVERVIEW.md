# MyWebsite v2 — AI Project Overview

> **Purpose.** High-level orientation for AI agents working on this project. Describes WHAT exists and WHY (techniques, patterns, architecture). Does NOT list specific variable names, function signatures, or config values — read the referenced source files for those.

> **Document Philosophy:**
> This document provides high-level understanding and points to source files for details. It should describe WHAT exists and WHY (techniques, patterns, architecture) but NOT list specific variable names, function signatures, or config values. When AI needs implementation details, it should read the referenced source files.

---

## What this is

A from-scratch rebuild of the personal portfolio site `christianblevens.me` as a 3D, physics-driven trading-card portfolio. Projects are physical cards on a virtual table; the user can drag, flip, expand, focus, shuffle, search, and filter them. Live project demos run inside the cards as iframes.

Live in `/workspace/MyWebsite-v2/`, side-by-side with the v1 project.

---

## Phase status

- **Phase 1 — Card-table prototype:** complete.
- **Phase 2 — Site shell (top nav, modals, intro, help):** complete.
- **Phase 2.5 — Responsive scaling pass:** complete. World geometry is aspect-ratio-driven via `js/layout.js`; cards, walls, ceiling, grid, and camera height all derive from a single recompute.
- **Phase 3 — Port the existing 24 projects:** ready to start (unlocked by Phase 2.5). Source: v1 `js/projects.js`. Restructure directly into `js/data.js` shape — no adapter.
- **Phase 4 — Add new projects + self-host migration:** not started.
- **Phase 5 — Resume rewrite:** deferred. Phase 2 ships the v1 Google Doc embed.

The master plan is in `/workspace/.claude/thoughts/mywebsite-overhaul.md`. Completed Phase 1 / Phase 2 / scaling-pass scratchpads are in `/workspace/.claude/thoughts/completed/`.

---

## Stack and constraints

- **Vanilla ES modules. Zero build step.** Deploy = copy static files behind nginx.
- **CDN import map** for dependencies — no `node_modules`, no bundler.
- **Three.js, dual-renderer setup:** WebGLRenderer for the table/lighting, CSS3DRenderer for the cards (so cards are real DOM with real text/iframes). WebGL canvas sits on top with `pointer-events: none` so the layers compose correctly.
- **Rapier3D (compat build)** for physics. Cards are dynamic rigid bodies; table, walls, and ceiling are static.
- **markdown-it** for runtime markdown rendering on card backs.

Everything is authored at a high pixel resolution (the cards) and downscaled into world units, so focus zoom stays sharp without re-rasterizing.

---

## Architectural pillars

### 1. Cards as full physics bodies, always

A card is never "removed" from the simulation. Filtering makes it translucent but it stays a physical body. Flipping animates the body's rotation directly. Expanding scales the visual AND the collider in lockstep — without the latter, expanded cards would visually intersect without colliding. Focused cards are not pinned; the camera tracks them and physics is allowed to jostle them.

### 2. Pointer routing via Three.js raycast, NOT CSS3D events

CSS3DRenderer's `cameraElement` has a documented event-routing blind spot under `transform-style: preserve-3d` (mrdoob/three.js#26583). Native DOM events on cards do not work reliably. Instead, every document-level pointer event is raycast against an invisible per-card hit-plane mesh; the hit point is converted to card-local pixel coordinates; then a manual element-resolution scan finds which interactive descendant (toggle, link, button) was hit.

Two independent code paths use this:
- The card-level interactions (drag, flip, focus, expand) — all driven by raycast.
- Iframes need real native events, so they do NOT participate in raycast — see pillar 3.

See `js/input.js` and the hit-plane / pixel-mapping code in `js/card.js`.

### 3. Iframe overlay — never reparent

Iframes used to live inside CSS3D card DOM. Reparenting an iframe (to switch between contexts) **reloads** it — black flash, lost scroll position, lost JS state. To eliminate that, every card's iframe lives in a single stable top-level container (`#iframe-stage`) for the lifetime of the page. Each frame, the overlay projects the card's screen rect and applies a 2D `translate + rotate(z) + scale(x,y)` transform so the iframe visually sits on top of the card.

Consequences and policies:
- **Iframes are always-on-top of all cards.** This is intentional. Expansion is a deliberate action, the LRU cap holds it to a small number, and z-ordering by physics depth would flicker constantly. Treat this as a feature, not a bug.
- **Per-card floating "compact" toggles** live in a sibling top-level container so they remain natively clickable while the iframe is interactive.
- **Per-frame visibility gate:** iframe visible iff card is expanded AND face-up. (Pointer events on iframe: only when the card is the focused card.)
- **Perspective tracking via 4-corner homography → CSS `matrix3d`:** the iframe perspective-tracks the card through any 3D orientation including mid-flip foreshortening. Math uses Jonas Wagner's basis-mapping technique (compose source-quad and dest-quad mappings via the adjugate, no linear solve).
- **Shuffle exception:** during shuffle, iframes are temporarily reparented into the CSS3D card DOM so they tumble with the card. The reload flash and iframe state loss are masked by the chaos. Re-attached to `#iframe-stage` after the shuffle settles.

See `js/iframe-overlay.js`.

### 4. LRU cap on simultaneous expansions

Live iframes are expensive. The overlay caps simultaneous expanded cards and compacts the oldest when the cap is exceeded. The user is never stopped from expanding; the system silently rotates the working set.

### 5. Camera that follows the card's visible face

The camera is always top-down (no rolling/side views). When focused on a card, its position, height, and vertical-axis rotation animate to frame the card head-on. The camera's "up" is derived from the card body's rotation applied to the visible face's local vector — front face uses one axis, back face uses the inverted axis — so flipped cards aren't framed upside-down. Avoiding Euler-angle ambiguity here was a non-trivial fix.

Focus *framing* is viewport-aware: the height required to fit the card is computed separately for the vertical and horizontal axes (using `CARD_W`/`CARD_H` from layout, `camera.fov`, `camera.aspect`), and the camera takes the larger of the two so both dimensions fit with `FOCUS_BUFFER` (10%) padding on the limiting axis. The vertical usable region excludes the top-nav strip — the camera's lookAt is shifted along the card's DOM-top direction so the card centers in the band between the nav's bottom edge and the viewport's bottom edge, not the geometric viewport center. There is no fixed `[minHeight, maxHeight]` clamp; the formula already produces the minimum height needed at any aspect.

See `js/camera-controller.js`.

### 6. Independent systems, opt-in via components

Each system (physics, input, camera, iframe overlay, UI, scene) operates on its own data and communicates through clearly-typed handles (the card object, the body, registered overlays). New systems should follow the same pattern: define their own data, query the entities they care about, do not reach into other systems' internals.

### 7. Modal shell with hook-based input precedence

Auxiliary site content (Me / Contact / Comments / Resume) lives in a single reusable modal shell. One modal at a time — opening a second swaps content, never stacks. Backdrop click and ESC dismiss; clicks inside the panel do not. The modal exposes `onOpen` / `onClose` hooks that the rest of the system subscribes to:

- The camera-controller listens and unfocuses any focused card on open, so opening a modal can't leave a card mid-zoom.
- The iframe overlay listens and gates iframe `pointer-events` to `none` while any modal is open, so a live iframe sitting under the modal panel can't steal events.
- The input controller's raycast skip-list includes `#modal-root` and `#top-nav` (along with `#ui-overlay`, `#grid-view`, `#iframe-stage`, `#iframe-toggle-stage`), so clicks on real DOM chrome surfaces don't double-fire as card raycasts.

This decouples modal sections from the table — sections don't import or know about the camera, physics, or iframe overlay. They just build content elements and call `Modal.open`.

The panel sizes itself to its content (no fixed width), capped by `max-width`. Sections must therefore set an explicit width on their content root or the panel collapses around the iframe/intrinsic content size. A `wide: true` flag bumps `max-width` to a wider variant for content that benefits from more horizontal room (currently used by the resume).

### 8. Intro modal as gesture tutorial

The intro modal auto-opens on first load and contains the bio + headshot + autoplaying banner video. Below the panel sits a controls cheat sheet (every card gesture and UI control) and a "Click anywhere to dismiss" button. Dismissing teaches the click-off gesture every other modal and the card focus/unfocus flow share. The `?` button in the bottom-right reopens the intro as the help/orientation surface — there is no separate help system. There is no auto-fade timer (was deliberately rejected: would yank itself away mid-read).

The "Me" nav button reopens the same intro modal — it doubles as the about page, eliminating that duplicate section.

### 9. Top nav as a glassy strip

The top nav is a fixed full-width strip pinned to the top of the viewport, sibling to (not inside) `#ui-overlay`. Tabs are centered, light-blue tinted, sitting on a thin semi-translucent gradient background with a small backdrop blur — the strip reads as chrome but the table grid is still visible behind it. `#ui-overlay` carries top padding so its search/filter row clears the strip.

### 10. Aspect-driven world layout via `js/layout.js`

The 3D scene is parameterized purely by viewport ASPECT RATIO; pixel resolution affects rendering sharpness only. `js/layout.js` is the single source of truth for every viewport-driven dimension and exposes a `Layout.onChange(fn)` event.

Constants (never change): `CELL_SIZE` (≈3.68 world units), `CARD_W/H/T` (= 2× and 3× cell), `CARD_PX_W/H` (1260 × 1890, 2:3 authoring), `CSS_BASE_SCALE`. Cards are physically the same size at every aspect — what changes is how many fit, where the walls are, and the camera height.

Per recompute (live values): `cameraHeight`, `visibleW/D`, `playW/D`, `cellsX/Z`, `ceilingY`, `wallHeight`. Camera height adapts so the *longer* visible axis always equals exactly `(CELLS_ON_LONG_AXIS + 2·BUFFER_CELLS) · CELL_SIZE` — i.e., the long axis of the yellow zone is always exactly 20 cells, on every aspect, with a 1-cell visual margin to the viewport edge. The shorter axis gets a non-integer cell count derived from the aspect.

Walls hug the yellow zone exactly (cards literally cannot drift outside the camera's overview frustum). The yellow-zone edge sits at integer multiples of `CELL_SIZE` from origin on the long axis; the grid is offset by `0.5 · CELL_SIZE` in both X and Z so grid lines never coincide with the yellow boundary on either axis. The grid mesh spans 3× the larger viewport dimension so its edge is never visible. The visible "yellow area" (table mesh) is sized exactly to playArea — outside the walls is dark scene background with grid lines floating on it.

Subscribers (`scene.js` for table+grid+camera height+shadow bounds, `physics.js` for ground+walls+ceiling, `main.js` for clamping cards back inside shrunk walls) all listen on `Layout.onChange`. The window-resize handler in `scene.js` calls `Layout.recompute(...)` first, then updates camera aspect and renderers.

CSS gets the constant `--card-px-w` / `--card-px-h` set on `:root` at module init, so `.stage-iframe` and `.iframe-toggle-host` size in lockstep with the JS card-pixel constants without drift.

---

## File map (entry points only — read each for detail)

```
/workspace/MyWebsite-v2/
├── index.html              — import map, stage container, UI overlay scaffolding,
│                             EmailJS + markdown-it CDN tags
├── css/styles.css          — all styles. Card internals are authored at the high-res scale.
└── js/
    ├── main.js             — bootstrap: world, scene, cards, overlays, camera,
    │                          input, modal hooks, nav, intro auto-open, animate loop
    ├── layout.js           — single source of truth for aspect-driven world dims:
    │                          CELL_SIZE, CARD_W/H, camera height, playArea, etc.
    │                          Exposes Layout.onChange(fn) for live recompute.
    ├── scene.js            — Three.js scene + dual renderer setup; listens to Layout
    ├── physics.js          — Rapier world; ground/walls/ceiling rebuilt on Layout change
    ├── card.js             — Card class. Owns DOM faces, hit plane, body, scale/flip state
    ├── camera-controller.js — focused/overview modes, face-aware up vector
    ├── input.js            — document-level pointer handlers driving raycast
    ├── iframe-overlay.js   — per-card iframe + floating toggle (no-reparent stage),
    │                          matrix3d perspective tracking, shuffle reparent exception,
    │                          modal-active gating
    ├── ui.js               — search, filter, shuffle, reset view, grid toggle, ? help
    ├── modal.js            — single shared modal shell (panel + hint slot, ESC,
    │                          backdrop dismiss, onOpen/onClose hooks)
    ├── nav.js              — top nav: Me · Contact · Comments · Resume
    ├── sections/
    │   ├── intro.js        — bio + headshot + banner video + controls cheat sheet
    │   ├── contact.js      — EmailJS contact form
    │   ├── comments.js     — drop-in self-hosted comments embed script
    │   └── resume.js       — Google Doc preview iframe + PDF download link
    └── data.js             — sample project records (5 entries, will grow in Phase 3)
```

---

## What this project deliberately does NOT have

- No framework (no React, no Vue, no Alpine).
- No build step (no Vite, no Webpack, no TypeScript compile).
- No CSS framework (no Tailwind).
- No animation library (no GSAP).
- No project modal — the focused card (with flip) replaces all modal-style detail views.
- No "card leaves the simulation" state — ever.
- No backwards-compatibility code paths. This is a greenfield rewrite.

---

## Known active work

- **Phase 3 — port the existing 24 v1 projects.** Source: `/workspace/MyWebsite/js/projects.js`. Restructure directly into `js/data.js` shape during the copy — no adapter / mapper layer. v1 GitHub Pages URLs continue working until Phase 4.
- **Phase 4 — self-host migration.** Move iframed projects from `christianblevens.github.io/<project>/` to `christianblevens.me/<slug>/` (vanity paths). Update URL strings in `data.js` and section files in one pass; no architecture changes needed.
- **Phase 5 — resume rewrite.** Phase 2 ships the existing Google Doc embed; Phase 5 replaces with a final version.

## External integrations (current URLs — change on Phase 4 self-host migration)

- Headshot: `i.imgur.com/z7NBCHn.jpeg` (intro modal, will move to self-host)
- Banner video: `i.imgur.com/IAGSnvD.mp4` (intro modal background)
- EmailJS: public key + service/template IDs in `js/sections/contact.js`. Mailbox: `christianblevensroot@gmail.com`.
- Comments: `christianblevens.me/comments/embed.js` (already self-hosted). Embed script aborts without `data-page-id` — must match v1's `"ChristianBlevens"` so threads persist.
- Resume: Google Doc id `1purg7IyVGjn9Mu3oNINaXV6l9QY-MBYi_blIqYnCzNM`. `/preview` for embed, `/export?format=pdf` for download. Iframe uses `aspect-ratio: 8.5/11` (US letter) and renders natively at the panel width — no CSS scale, no blur.

## Notes for AI agents working in this repo

- Project-wide operational rules live in `/workspace/.claude/CLAUDE.md`. Read them.
- Active scratchpads in `/workspace/.claude/thoughts/` track current investigations and decisions. Read the relevant one before proposing changes. Completed scratchpads are archived under `completed/`.
- Investigate root causes before proposing fixes; never guess. If a fix attempt fails, stop and research rather than swapping approaches.
- Don't reparent iframes outside the documented shuffle exception.
- Don't try to "fix" CSS3D pointer routing.
- Don't reintroduce a project modal.
- Don't add backwards-compatibility scaffolding.
- Don't add a separate "About" section — the intro modal (opened via "Me" nav or `?` button) is the about page.
- Don't write a project-data adapter for Phase 3 — restructure `projects.js` directly.
- Don't hard-code world dimensions (card size, table size, camera height, wall positions). Read from `js/layout.js`. If a new system needs to react to viewport changes, subscribe via `Layout.onChange(fn)` rather than reading `window.innerWidth` directly.
- Shuffle impulses are intentionally biased: 90% random direction + 10% toward the play-area center. Don't "fix" this back to pure random — the bias keeps cards from piling up against the walls over repeated shuffles.
