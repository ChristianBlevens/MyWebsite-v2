// Single source of truth for viewport-driven world dimensions.
//
// The world is parameterized by viewport ASPECT RATIO only — pixel resolution
// affects rendering sharpness (devicePixelRatio + canvas size) but never the
// 3D scene's geometry. So the same aspect ratio always produces the same
// grid count, play area, and card layout, independent of resolution.
//
// CELL_SIZE is constant. Camera height adapts so that the *longer* visible
// axis always fits exactly (CELLS_ON_LONG_AXIS + 2*BUFFER_CELLS) cells —
// the shorter axis gets a non-integer cell count derived from the aspect.
// Reference setup: 16:9 viewport at h=REFERENCE_CAMERA_HEIGHT yields a
// visible long axis of (2*h*tan(fov/2))*aspect ≈ 81 world units, divided
// into 22 cells (20 yellow + 2 buffer) → CELL_SIZE ≈ 3.68.
//
// Walls hug the yellow zone exactly (1 cell of margin to the viewport on
// every side). The grid is offset by half a cell in both X and Z so that
// the yellow zone's boundaries never coincide with grid lines.

import { projects } from './data.js';

const FOV_DEG = 45;
const FOV_RAD = FOV_DEG * Math.PI / 180;

export const REFERENCE_CAMERA_HEIGHT = 55;
export const REFERENCE_ASPECT = 16 / 9;
export const CELLS_ON_LONG_AXIS = 20;
export const BUFFER_CELLS = 1;
export const CARD_CELLS_W = 2;
export const CARD_CELLS_H = 3;

// Half-cell offset so the yellow zone's boundary never falls exactly on a
// grid line in either X or Z. Grid lines sit at (i + 0.5)*CELL_SIZE.
export const GRID_OFFSET = 0.5;

// At reference aspect+height, the visible long-axis span fits exactly
// (CELLS_ON_LONG_AXIS + 2*BUFFER_CELLS) cells. CELL_SIZE is fixed across all
// viewports — camera height varies so this stays true at non-reference aspects.
const REFERENCE_VISIBLE_LONG = 2 * REFERENCE_CAMERA_HEIGHT * Math.tan(FOV_RAD / 2)
                              * REFERENCE_ASPECT;
export const CELL_SIZE = REFERENCE_VISIBLE_LONG / (CELLS_ON_LONG_AXIS + 2 * BUFFER_CELLS);

// Camera-height denominator: h = CAMERA_HEIGHT_FACTOR / max(1, aspect).
// Derived so that, at aspect = REFERENCE_ASPECT, h = REFERENCE_CAMERA_HEIGHT.
const CAMERA_HEIGHT_FACTOR = REFERENCE_CAMERA_HEIGHT * REFERENCE_ASPECT;

// Compact card size scales with project count. REFERENCE_COUNT is the
// project count this scaling was tuned against; at that count, COMPACT_SCALE
// equals REFERENCE_SCALE. sqrt scaling means each card's world area tracks
// 1/N (the natural packing relationship), so adding more cards shrinks them
// and removing cards grows them. Bounded so extreme counts can't produce
// absurd sizes.
//
// Expanded size is intentionally NOT scaled by this — card.js compensates
// by setting EXPANDED_SCALE to a value that cancels COMPACT_SCALE out, so
// the absolute world size of an expanded card is independent of N.
const REFERENCE_COUNT = 38;
const REFERENCE_SCALE = 0.85;
export const COMPACT_SCALE = Math.min(1.5, Math.max(0.5,
    REFERENCE_SCALE * Math.sqrt(REFERENCE_COUNT / Math.max(1, projects.length))
));

export const CARD_W = CARD_CELLS_W * CELL_SIZE * COMPACT_SCALE;
export const CARD_H = CARD_CELLS_H * CELL_SIZE * COMPACT_SCALE;
export const CARD_T = 0.3;

// Card DOM authored at high pixel resolution then downscaled by CSS_BASE_SCALE
// in the CSS3D matrix so focus zoom stays sharp without re-rasterizing. PX_PER_UNIT
// is chosen so CARD_PX_W stays at the same authoring resolution we used before
// the scaling refactor (1260px wide), regardless of CARD_W's new value.
export const CARD_PX_W = 1260;
export const CARD_PX_H = Math.round(CARD_PX_W * (CARD_H / CARD_W));
export const PX_PER_UNIT = CARD_PX_W / CARD_W;
export const CSS_BASE_SCALE = 1 / PX_PER_UNIT;

export const FOV = FOV_DEG;

const _listeners = new Set();

export const Layout = {
    // Filled in by recompute(). Initial values are placeholders.
    aspect: 1,
    cameraHeight: REFERENCE_CAMERA_HEIGHT,
    visibleW: 0,
    visibleD: 0,
    cellsX: CELLS_ON_LONG_AXIS,
    cellsZ: CELLS_ON_LONG_AXIS,
    playW: 0,
    playD: 0,
    ceilingY: REFERENCE_CAMERA_HEIGHT,
    wallHeight: REFERENCE_CAMERA_HEIGHT,

    recompute(width, height) {
        const aspect = width / height;
        // Camera height adapts so the longer visible axis always equals
        // exactly (CELLS_ON_LONG_AXIS + 2*BUFFER_CELLS) cells = 22*CELL_SIZE.
        //   landscape (aspect ≥ 1): long = width → h = FACTOR / aspect.
        //   portrait  (aspect < 1): long = depth → h = FACTOR.
        const h = CAMERA_HEIGHT_FACTOR / Math.max(1, aspect);
        const visibleD = 2 * h * Math.tan(FOV_RAD / 2);
        const visibleW = visibleD * aspect;

        // Yellow zone: viewport minus exactly 1 cell on every side. Walls hug
        // its boundary. The short-axis count is generally non-integer; only
        // the long axis is guaranteed to be exactly CELLS_ON_LONG_AXIS.
        const playW = Math.max(0.1, visibleW - 2 * BUFFER_CELLS * CELL_SIZE);
        const playD = Math.max(0.1, visibleD - 2 * BUFFER_CELLS * CELL_SIZE);
        const cellsX = playW / CELL_SIZE;
        const cellsZ = playD / CELL_SIZE;

        this.aspect = aspect;
        this.cameraHeight = h;
        this.visibleW = visibleW;
        this.visibleD = visibleD;
        this.cellsX = cellsX;
        this.cellsZ = cellsZ;
        this.playW = playW;
        this.playD = playD;
        this.ceilingY = h;
        this.wallHeight = h;

        for (const fn of _listeners) fn(this);
    },

    onChange(fn) {
        _listeners.add(fn);
        return () => _listeners.delete(fn);
    },
};

// Expose card pixel size + cell size to CSS via custom properties. These are
// set once (constants don't change after init) so CSS rules referencing the
// stage-iframe and iframe-toggle-host sizes don't drift from JS.
{
    const root = document.documentElement;
    root.style.setProperty('--card-px-w', CARD_PX_W + 'px');
    root.style.setProperty('--card-px-h', CARD_PX_H + 'px');
}

// Initial recompute so importers see populated values. main.js wires the
// resize handler that calls recompute() on viewport changes.
Layout.recompute(window.innerWidth, window.innerHeight);
