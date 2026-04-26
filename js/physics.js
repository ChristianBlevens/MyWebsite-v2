import RAPIER from '@dimforge/rapier3d-compat';
import { Layout, CELL_SIZE, BUFFER_CELLS } from './layout.js';

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

// Random spawn anywhere on the play area, used for initial placement and for
// the safety-teleport when an escaped card falls below the floor. Margin
// scales with cell size so cards never spawn flush against the wall.
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
