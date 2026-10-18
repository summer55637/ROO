import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const stage = document.getElementById('stage');
const status = document.getElementById('status');
const stats = document.getElementById('stats');
const modelInput = document.getElementById('model-file');
const gatInput = document.getElementById('gat-file');
const opacityInput = document.getElementById('grid-opacity');
const walkableInput = document.getElementById('show-walkable');
const blockedInput = document.getElementById('show-blocked');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b111b');
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xddeaff, 0x384252, 2.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
keyLight.position.set(300, 500, 250);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb6d5ff, 0.65);
fillLight.position.set(-300, 150, -250);
scene.add(fillLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const loader = new GLTFLoader();
const axes = new THREE.AxesHelper(10);
scene.add(axes);

let mapRoot = null;
let mapBounds = null;
let mapInfo = null;
let gatInfo = null;
let gridMesh = null;
let gridMaterial = null;
let gridGeometry = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function updateStats() {
  const parts = [];
  if (mapInfo) {
    parts.push('GLB：' + mapInfo.name);
    parts.push('場景範圍：約 ' + [mapInfo.size.x, mapInfo.size.y, mapInfo.size.z]
      .map(n => n.toFixed(1)).join(' × '));
  }
  if (gatInfo) {
    parts.push('GAT ' + gatInfo.version + '：' + gatInfo.width + ' × ' + gatInfo.height);
    parts.push('可走 ' + gatInfo.walkableCount + ' 格／阻擋 ' + gatInfo.blockedCount + ' 格');
    parts.push('水域標記 ' + gatInfo.waterCount + ' 格');
  }
  stats.textContent = parts.length ? parts.join('\n') : '尚未載入地圖';
}

function disposeObject(object) {
  object.traverse(node => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        for (const value of Object.values(material)) {
          if (value && value.isTexture) value.dispose();
        }
        material.dispose();
      });
    }
  });
}

function parseGatBuffer(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 14
    || String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'GRAT') {
    throw new Error('不是有效的 GAT 檔：找不到 GRAT 標頭。');
  }

  const major = view.getUint8(4);
  const minor = view.getUint8(5);
  if (major !== 1 || (minor !== 2 && minor !== 3)) {
    throw new Error('只支援 GAT 1.2／1.3；收到 ' + major + '.' + minor + '。');
  }

  const width = view.getUint32(6, true);
  const height = view.getUint32(10, true);
  const count = width * height;
  if (!width || !height || width > 8192 || height > 8192
    || !Number.isSafeInteger(count) || count > 1000000) {
    throw new Error('地圖尺寸無效或超過預覽工具的 100 萬格安全上限。');
  }
  const expectedBytes = 14 + count * 20;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error('GAT 長度不符：預期 ' + expectedBytes + ' bytes，收到 ' + buffer.byteLength + '。');
  }

  const cells = new Array(count);
  let walkableCount = 0;
  let waterCount = 0;
  for (let i = 0; i < count; i++) {
    const offset = 14 + i * 20;
    const terrainType = view.getUint16(offset + 16, true);
    const upperTerrainFlags = view.getUint16(offset + 18, true);
    const heights = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true),
    ];
    if (!heights.every(Number.isFinite)) {
      throw new Error('GAT 第 ' + i + ' 格含無效高度資料。');
    }
    const walkable = terrainType === 0 || terrainType === 2 || terrainType === 3
      || terrainType === 4 || terrainType === 6;
    const water = minor === 3 && (upperTerrainFlags & 0x8000) !== 0;
    if (walkable) walkableCount++;
    if (water) waterCount++;
    cells[i] = { terrainType, walkable, water, height: heights.reduce((a, b) => a + b, 0) / 4 };
  }

  return {
    version: major + '.' + minor,
    width,
    height,
    cells,
    walkableCount,
    blockedCount: count - walkableCount,
    waterCount,
  };
}

function clearGrid() {
  if (gridMesh) {
    scene.remove(gridMesh);
    gridMesh = null;
  }
  if (gridGeometry) {
    gridGeometry.dispose();
    gridGeometry = null;
  }
  if (gridMaterial) {
    gridMaterial.dispose();
    gridMaterial = null;
  }
}

function rebuildGrid() {
  clearGrid();
  if (!gatInfo || !mapRoot) {
    updateStats();
    return;
  }

  const showWalkable = walkableInput.checked;
  const showBlocked = blockedInput.checked;
  const visibleCells = gatInfo.cells.filter(cell => cell.walkable ? showWalkable : showBlocked);
  if (!visibleCells.length) {
    updateStats();
    return;
  }

  gridGeometry = new THREE.PlaneGeometry(0.92, 0.92);
  gridGeometry.rotateX(-Math.PI / 2);
  gridMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: Number(opacityInput.value) / 100,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  gridMesh = new THREE.InstancedMesh(gridGeometry, gridMaterial, visibleCells.length);
  gridMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < visibleCells.length; i++) {
    const cell = visibleCells[i];
    const index = gatInfo.cells.indexOf(cell);
    const x = index % gatInfo.width;
    const y = Math.floor(index / gatInfo.width);
    // ragx --world-scale 0.2 makes one GAT tile equal one world unit.
    // RO heights use the negative Y axis; convert to glTF's Y-up coordinates.
    const height = -cell.height * 0.2 + 0.06;
    transform.position.set(
      x - gatInfo.width / 2 + 0.5,
      height,
      gatInfo.height / 2 - y - 0.5
    );
    transform.updateMatrix();
    gridMesh.setMatrixAt(i, transform.matrix);
    if (cell.water) color.set('#4da6ff');
    else if (cell.walkable) color.set('#48d597');
    else if (cell.terrainType === 5) color.set('#ffc15b');
    else color.set('#ff626e');
    gridMesh.setColorAt(i, color);
  }
  gridMesh.instanceMatrix.needsUpdate = true;
  if (gridMesh.instanceColor) gridMesh.instanceColor.needsUpdate = true;
  scene.add(gridMesh);
  updateStats();
}

async function loadMapFile(file) {
  setStatus('正在載入 ' + file.name + '…');
  try {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
    if (mapRoot) {
      scene.remove(mapRoot);
      disposeObject(mapRoot);
    }
    mapRoot = gltf.scene;
    scene.add(mapRoot);
    mapRoot.updateMatrixWorld(true);
    mapBounds = new THREE.Box3().setFromObject(mapRoot);
    if (mapBounds.isEmpty()) throw new Error('GLB 沒有可顯示的模型。');

    const size = mapBounds.getSize(new THREE.Vector3());
    const center = mapBounds.getCenter(new THREE.Vector3());
    mapInfo = { name: file.name, size };
    const maxDimension = Math.max(size.x, size.y, size.z, 10);
    camera.near = Math.max(maxDimension / 10000, 0.01);
    camera.far = maxDimension * 50;
    camera.position.set(
      center.x + maxDimension * 0.85,
      center.y + maxDimension * 0.75,
      center.z + maxDimension * 0.85
    );
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.maxDistance = maxDimension * 20;
    controls.minDistance = Math.max(maxDimension * 0.01, 0.1);
    controls.update();
    axes.scale.setScalar(Math.max(maxDimension / 80, 0.1));
    setStatus('已載入 ' + file.name + '。載入同一地圖的 GAT 檔，可疊加通行格。');
    rebuildGrid();
  } catch (error) {
    setStatus('GLB 載入失敗：' + error.message, true);
    console.error(error);
  }
}

async function loadGatFile(file) {
  setStatus('正在解析 ' + file.name + '…');
  try {
    gatInfo = parseGatBuffer(await file.arrayBuffer());
    setStatus('已解析 ' + file.name + '。綠色可走、紅色阻擋、橘色懸崖、藍色水域。', false);
    rebuildGrid();
  } catch (error) {
    gatInfo = null;
    rebuildGrid();
    setStatus('GAT 解析失敗：' + error.message, true);
    console.error(error);
  }
}

modelInput.addEventListener('change', () => {
  const file = modelInput.files && modelInput.files[0];
  if (file) loadMapFile(file);
});
gatInput.addEventListener('change', () => {
  const file = gatInput.files && gatInput.files[0];
  if (file) loadGatFile(file);
});
opacityInput.addEventListener('input', () => {
  if (gridMaterial) gridMaterial.opacity = Number(opacityInput.value) / 100;
});
walkableInput.addEventListener('change', rebuildGrid);
blockedInput.addEventListener('change', rebuildGrid);

function resize() {
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(stage);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
