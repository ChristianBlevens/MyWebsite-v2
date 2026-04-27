import RAPIER from '@dimforge/rapier3d-compat';
import { Layout, CELL_SIZE, BUFFER_CELLS, CARD_W, CARD_H, CARD_T } from './layout.js';

// Physics world in cm-ish units. Table is the XZ plane at Y=0. Bounds (ground,
// walls, ceiling) are derived from Layout and rebuilt whenever the viewport
// aspect changes — walls always hug the play area exactly so cards cannot
// drift outside the visible viewport region.

export function createPhysicsWorld() {
    const world = new RAPIER.World({ x: 0, y: -30, z: 0 });
    world.timestep = 1 / 60;

    const bounds = { ground: null, walls: [], ceiling: null };
    rebuildBounds(world, bounds);

    Layout.onChange(() => rebuildBounds(world, bounds));

    return world;
}

function rebuildBounds(world, bounds) {
    if (bounds.ground)  world.removeRigidBody(bounds.ground);
    for (const w of bounds.walls) world.removeRigidBody(w);
    if (bounds.ceiling) world.removeRigidBody(bounds.ceiling);
    bounds.walls.length = 0;

    const W = Layout.playW;
    const D = Layout.playD;
    const wallH = Layout.wallHeight;
    const wallT = 0.5;
    // Ground extends past the walls under the visual buffer cells so the
    // table mesh + grid overlay don't float over void.
    const buf = CELL_SIZE * BUFFER_CELLS;

    // Ground — thin static cuboid whose top face sits at Y=0.
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(W / 2 + buf, 0.1, D / 2 + buf)
            .setTranslation(0, -0.1, 0)
            .setFriction(0.3)
            .setRestitution(0.05),
        ground
    );
    bounds.ground = ground;

    // Edge walls hug the play area exactly. Cards stay inside playArea →
    // stay inside the camera's overview viewport.
    const wallSpecs = [
        { t: [ W/2 + wallT/2, wallH/2, 0 ],          s: [wallT/2, wallH/2, D/2 + wallT] },
        { t: [-W/2 - wallT/2, wallH/2, 0 ],          s: [wallT/2, wallH/2, D/2 + wallT] },
        { t: [ 0, wallH/2,  D/2 + wallT/2 ],         s: [W/2 + wallT, wallH/2, wallT/2] },
        { t: [ 0, wallH/2, -D/2 - wallT/2 ],         s: [W/2 + wallT, wallH/2, wallT/2] },
    ];
    for (const w of wallSpecs) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(...w.s).setTranslation(...w.t).setFriction(0.1),
            body
        );
        bounds.walls.push(body);
    }

    // Ceiling at camera height — cards can't fly above the camera.
    const ceiling = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(W / 2 + buf, 0.1, D / 2 + buf)
            .setTranslation(0, Layout.ceilingY, 0)
            .setFriction(0.1),
        ceiling
    );
    bounds.ceiling = ceiling;
}

// Returns a dynamic rigid body with a cuboid collider. Mass forced to 1 regardless of size.
// CCD is enabled so fast-moving cards (during shuffle) can't tunnel through thin walls.
export function createCardBody(world, width, height, thickness) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
        .setLinearDamping(0.4)
        .setAngularDamping(0.6)
        .setCanSleep(true)
        .setCcdEnabled(true);
    const body = world.createRigidBody(desc);

    const volume = width * thickness * height;
    const density = 1 / volume; // mass = density * volume = 1
    world.createCollider(
        RAPIER.ColliderDesc.cuboid(width / 2, thickness / 2, height / 2)
            .setFriction(0.3)
            .setRestitution(0.05)
            .setDensity(density),
        body
    );
    return body;
}

// Lower Y bound only — if a card somehow escapes (wall tunneling, weird physics),
// it'll fall, and when it passes below this height we teleport it back to the table.
export const BOUNDS = {
    yMin: -2,
};

// Initial placement of all cards on the table. Random-looking positions and
// yaws within bounds, but with a minimum center-to-center distance enforced
// via Bridson's Poisson-disk algorithm so cards don't pile on top of each
// other at boot. If the play area can't fit N samples at the requested
// radius, the radius is shrunk and the algorithm re-runs — guaranteeing
// termination on tight viewports at the cost of slight overlap there.
//
// Yaw is stratified across [-YAW_MAX, +YAW_MAX]: the range is split into N
// equal bins, one yaw is drawn uniformly within each bin, and the bins are
// shuffled across cards. With ~30 cards a uniform Math.random() draw shows
// visible clusters at the limits by chance; stratification guarantees the
// full range is evenly covered while still looking random within each bin.
// YAW_MAX stays inside the readable 180° window so every card's text reads
// top-to-bottom on the screen.
const YAW_MAX = (110 / 2) * Math.PI / 180; // ±55° → 110° total
export function placeCardsOnTable(cards) {
    const N = cards.length;
    if (N === 0) return;

    const margin = CELL_SIZE * 1.5;
    const W = Math.max(0.1, Layout.playW - margin * 2);
    const D = Math.max(0.1, Layout.playD - margin * 2);

    // Initial separation. Card is CARD_W × CARD_H; this radius keeps cards
    // visually distinct with breathing room. Shrunk on retry if N points
    // won't fit. Bridson is run to completion (fills the play area) and the
    // result is randomly subsampled to N so points cover the whole area
    // instead of clustering around the algorithm's seed point.
    let r = CARD_W * 1.5;
    let positions = null;
    for (let attempt = 0; attempt < 8; attempt++) {
        const sampled = bridsonSample(W, D, r);
        if (sampled.length >= N) {
            for (let i = sampled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [sampled[i], sampled[j]] = [sampled[j], sampled[i]];
            }
            positions = sampled.slice(0, N);
            break;
        }
        r *= 0.85;
    }
    // Last-resort: pure random fill (this only triggers on absurdly small
    // play areas where even r → 0 wouldn't fit; cards may overlap visibly).
    if (!positions) {
        positions = [];
        for (let i = 0; i < N; i++) {
            positions.push({
                x: (Math.random() - 0.5) * W,
                z: (Math.random() - 0.5) * D,
            });
        }
    }

    const yaws = stratifiedYaws(N, YAW_MAX);

    for (let i = 0; i < N; i++) {
        const { x, z } = positions[i];
        const yaw = yaws[i];
        cards[i].body.setTranslation({ x, y: CARD_T / 2 + 0.05, z }, true);
        const halfYaw = yaw / 2;
        cards[i].body.setRotation(
            { x: 0, y: Math.sin(halfYaw), z: 0, w: Math.cos(halfYaw) },
            true
        );
    }
}

function stratifiedYaws(N, yawMax) {
    const binWidth = (2 * yawMax) / N;
    const yaws = new Array(N);
    for (let i = 0; i < N; i++) {
        yaws[i] = -yawMax + (i + Math.random()) * binWidth;
    }
    for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [yaws[i], yaws[j]] = [yaws[j], yaws[i]];
    }
    return yaws;
}

// Bridson's fast Poisson-disk sampler (SIGGRAPH 2007). Samples a W × D
// rectangle centered at the origin so points lie in [-W/2, W/2] × [-D/2, D/2].
// Runs until the active list is exhausted (the area is fully packed at
// radius r). Caller subsamples the result to its desired count. O(N) via a
// background grid of cell size r/sqrt(2).
function bridsonSample(W, D, r) {
    const k = 30; // candidate attempts per active point — Bridson's default
    const cellSize = r / Math.SQRT2;
    const gridW = Math.ceil(W / cellSize);
    const gridD = Math.ceil(D / cellSize);
    const grid = new Array(gridW * gridD).fill(-1);
    const samples = [];
    const active = [];

    const toGrid = (x, z) => {
        const gx = Math.floor((x + W / 2) / cellSize);
        const gz = Math.floor((z + D / 2) / cellSize);
        return [gx, gz];
    };
    const inBounds = (x, z) =>
        x >= -W / 2 && x <= W / 2 && z >= -D / 2 && z <= D / 2;
    const farEnough = (x, z) => {
        const [gx, gz] = toGrid(x, z);
        const x0 = Math.max(0, gx - 2), x1 = Math.min(gridW - 1, gx + 2);
        const z0 = Math.max(0, gz - 2), z1 = Math.min(gridD - 1, gz + 2);
        for (let zi = z0; zi <= z1; zi++) {
            for (let xi = x0; xi <= x1; xi++) {
                const idx = grid[zi * gridW + xi];
                if (idx === -1) continue;
                const s = samples[idx];
                const dx = s.x - x, dz = s.z - z;
                if (dx * dx + dz * dz < r * r) return false;
            }
        }
        return true;
    };
    const addSample = (x, z) => {
        const [gx, gz] = toGrid(x, z);
        const idx = samples.length;
        samples.push({ x, z });
        grid[gz * gridW + gx] = idx;
        active.push(idx);
    };

    addSample((Math.random() - 0.5) * W, (Math.random() - 0.5) * D);

    while (active.length > 0) {
        const ai = Math.floor(Math.random() * active.length);
        const seed = samples[active[ai]];
        let placed = false;
        for (let attempt = 0; attempt < k; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = r * (1 + Math.random()); // annulus [r, 2r]
            const x = seed.x + Math.cos(angle) * radius;
            const z = seed.z + Math.sin(angle) * radius;
            if (inBounds(x, z) && farEnough(x, z)) {
                addSample(x, z);
                placed = true;
            }
        }
        if (!placed) active.splice(ai, 1);
    }

    return samples;
}

// Random spawn anywhere on the play area, used for the safety-teleport when
// an escaped card falls below the floor. Margin scales with cell size so
// cards never spawn flush against the wall.
export function randomSpawnPos() {
    const margin = CELL_SIZE * 1.5;
    const W = Math.max(0.1, Layout.playW - margin * 2);
    const D = Math.max(0.1, Layout.playD - margin * 2);
    return {
        x: (Math.random() - 0.5) * W,
        y: 2 + Math.random() * 3,
        z: (Math.random() - 0.5) * D,
    };
}
