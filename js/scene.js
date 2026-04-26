import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { Layout, CELL_SIZE, BUFFER_CELLS, GRID_OFFSET, FOV } from './layout.js';

// Flat top-down camera. Because position is directly above the target, we must
// specify an explicit `up` vector perpendicular to the look direction — the default
// `up = (0,1,0)` is degenerate when looking straight down. `up = (0,0,-1)` makes
// world -Z appear as "up" on screen. Position.y is updated by Layout each resize.
export const DEFAULT_CAMERA = {
    position: new THREE.Vector3(0, Layout.cameraHeight, 0),
    lookAt: new THREE.Vector3(0, 0, 0),
    up: new THREE.Vector3(0, 0, -1),
};

export function createScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d10);

    const camera = new THREE.PerspectiveCamera(
        FOV,
        window.innerWidth / window.innerHeight,
        0.1,
        500
    );
    camera.up.copy(DEFAULT_CAMERA.up);
    camera.position.copy(DEFAULT_CAMERA.position);
    camera.lookAt(DEFAULT_CAMERA.lookAt);

    const webglRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    webglRenderer.setSize(window.innerWidth, window.innerHeight);
    webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    webglRenderer.shadowMap.enabled = true;
    webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('webgl-container').appendChild(webglRenderer.domElement);

    const css3dRenderer = new CSS3DRenderer();
    css3dRenderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('css3d-container').appendChild(css3dRenderer.domElement);

    // Table mesh + grid are sized to playArea + buffer so the visual margin
    // (1 cell on each side, outside the walls) has a surface to render on.
    const tableMat = new THREE.MeshStandardMaterial({
        color: 0x2a1f15,
        roughness: 0.95,
        metalness: 0.0,
    });
    const gridMat = new THREE.LineBasicMaterial({ color: 0x3a2a1e });

    let table = null;
    let grid = null;
    function rebuildVisuals() {
        if (table) {
            scene.remove(table);
            table.geometry.dispose();
        }
        if (grid) {
            scene.remove(grid);
            grid.geometry.dispose();
        }

        // Table mesh = the "yellow area", sized to the bounding box (playArea
        // inside the walls). Outside the walls is just the dark scene
        // background — the 1-cell visual buffer there shows grid lines only.
        table = new THREE.Mesh(new THREE.PlaneGeometry(Layout.playW, Layout.playD), tableMat);
        table.rotation.x = -Math.PI / 2;
        table.receiveShadow = true;
        scene.add(table);

        // Grid extends well past the viewport on every side so a grid edge is
        // never visible at any aspect. Lines offset by GRID_OFFSET cells so
        // the yellow-zone boundary (at integer multiples of CELL_SIZE from
        // origin on the long axis) cuts through the middle of cells, never
        // coinciding with a grid line.
        const gridSpan = Math.max(Layout.visibleW, Layout.visibleD) * 3;
        grid = buildRectangularGrid(gridSpan, gridSpan, CELL_SIZE, GRID_OFFSET, gridMat);
        grid.position.y = 0.01;
        scene.add(grid);
    }
    rebuildVisuals();

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(15, 40, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);

    function updateShadowBounds() {
        // Shadow camera covers the play area + buffer so cards near the
        // edges still cast shadows on any aspect ratio.
        const buf = CELL_SIZE * BUFFER_CELLS;
        const halfW = Layout.playW / 2 + buf;
        const halfD = Layout.playD / 2 + buf;
        key.shadow.camera.left   = -halfW;
        key.shadow.camera.right  =  halfW;
        key.shadow.camera.top    =  halfD;
        key.shadow.camera.bottom = -halfD;
        key.shadow.camera.updateProjectionMatrix();
    }
    updateShadowBounds();

    const rim = new THREE.DirectionalLight(0x6688ff, 0.25);
    rim.position.set(-20, 20, -15);
    scene.add(rim);

    function applyLayout() {
        DEFAULT_CAMERA.position.y = Layout.cameraHeight;
        rebuildVisuals();
        updateShadowBounds();
    }
    Layout.onChange(applyLayout);

    window.addEventListener('resize', () => {
        Layout.recompute(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        webglRenderer.setSize(window.innerWidth, window.innerHeight);
        css3dRenderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, webglRenderer, css3dRenderer };
}

// Custom rectangular grid (THREE.GridHelper is square only). Lines are placed
// at (i + offsetCells) * cellSize relative to world origin. With offsetCells =
// 0.5, lines sit at ±0.5*cell, ±1.5*cell, … so the yellow-zone boundaries
// (which live at integer multiples of cell from origin) fall in the middle
// of cells, never on grid lines. Span is symmetric around origin.
function buildRectangularGrid(totalW, totalD, cellSize, offsetCells, material) {
    const halfW = totalW / 2;
    const halfD = totalD / 2;
    const off = offsetCells * cellSize;
    const positions = [];
    // Lines parallel to Z axis (vertical lines), spaced along X.
    const iMinX = Math.ceil((-halfW - off) / cellSize);
    const iMaxX = Math.floor(( halfW - off) / cellSize);
    for (let i = iMinX; i <= iMaxX; i++) {
        const x = i * cellSize + off;
        positions.push(x, 0, -halfD, x, 0, halfD);
    }
    // Lines parallel to X axis (horizontal lines), spaced along Z.
    const iMinZ = Math.ceil((-halfD - off) / cellSize);
    const iMaxZ = Math.floor(( halfD - off) / cellSize);
    for (let i = iMinZ; i <= iMaxZ; i++) {
        const z = i * cellSize + off;
        positions.push(-halfW, 0, z, halfW, 0, z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geom, material);
}
