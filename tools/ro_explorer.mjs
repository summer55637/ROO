import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const stage = document.getElementById('stage');
const status = document.getElementById('status');
const stats = document.getElementById('stats');
const modelInput = document.getElementById('model-file');
const gatInput = document.getElementById('gat-file');
const scaleInput = document.getElementById('world-scale');
const speedInput = document.getElementById('move-speed');
const speedValue = document.getElementById('speed-value');
const showCellsInput = document.getElementById('show-cells');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#090f18');
const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.touchAction = 'none';
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xddeaff, 0x384252, 2.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(250, 500, 300);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb6d5ff, 0.7);
fillLight.position.set(-300, 150, -250);
scene.add(fillLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);

const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const normalMatrix = new THREE.Matrix3();
const textureLoader = new THREE.TextureLoader();

let mapRoot = null;
let mapInfo = null;
let mapBounds = null;
let gatInfo = null;
let gridMesh = null;
let gridGeometry = null;
let gridMaterial = null;
let routeLine = null;
let targetRing = null;
let playerSprite = null;
let fallbackPlayer = null;
let currentCell = null;
let movementPath = null;
let pathIndex = 1;
let activeMapId = '';
let lastFrame = 0;
let worldScale = 0.2;

const axes = new THREE.AxesHelper(10);
axes.material.transparent = true;
axes.material.opacity = 0.4;
scene.add(axes);

const playerMaterial = new THREE.SpriteMaterial({
  color: 0xffffff,
  transparent: true,
  depthTest: true,
  depthWrite: false,
});
playerSprite = new THREE.Sprite(playerMaterial);
playerSprite.visible = false;
scene.add(playerSprite);

const fallbackMaterial = new THREE.MeshStandardMaterial({
  color: '#62e2ad',
  roughness: 0.55,
  metalness: 0.05,
});
fallbackPlayer = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.22, 0.8, 4, 8),
  fallbackMaterial
);
fallbackPlayer.visible = false;
scene.add(fallbackPlayer);

const ringMaterial = new THREE.MeshBasicMaterial({
  color: '#ffcf70',
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
});
targetRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.4, 28), ringMaterial);
targetRing.rotation.x = -Math.PI / 2;
targetRing.visible = false;
scene.add(targetRing);

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function mapIdFromName(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim().toLowerCase();
}

function safeScale() {
  const value = Number(scaleInput.value);
  return Number.isFinite(value) && value > 0 && value <= 10 ? value : null;
}

function tileSize() {
  return 5 * worldScale;
}

function parseGatBuffer(buffer, name) {
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
  const total = width * height;
  if (!width || !height || width > 8192 || height > 8192
    || !Number.isSafeInteger(total) || total > 4000000) {
    throw new Error('GAT 尺寸無效或超過 400 萬格安全上限。');
  }
  const expectedBytes = 14 + total * 20;
  if (buffer.byteLength !== expectedBytes) {
    throw new Error('GAT 長度不符：預期 ' + expectedBytes + ' bytes，收到 ' + buffer.byteLength + '。');
  }

  const walkable = new Uint8Array(total);
  const heights = new Float32Array(total);
  const terrainTypes = new Uint16Array(total);
  const water = new Uint8Array(total);
  let walkableCount = 0;
  for (let i = 0; i < total; i++) {
    const offset = 14 + i * 20;
    const terrainType = view.getUint16(offset + 16, true);
    const upperFlags = view.getUint16(offset + 18, true);
    const h0 = view.getFloat32(offset, true);
    const h1 = view.getFloat32(offset + 4, true);
    const h2 = view.getFloat32(offset + 8, true);
    const h3 = view.getFloat32(offset + 12, true);
    if (![h0, h1, h2, h3].every(Number.isFinite)) {
      throw new Error('GAT 第 ' + i + ' 格含無效高度資料。');
    }
    const canWalk = terrainType === 0 || terrainType === 2 || terrainType === 3
      || terrainType === 4 || terrainType === 6;
    terrainTypes[i] = terrainType;
    walkable[i] = canWalk ? 1 : 0;
    heights[i] = (h0 + h1 + h2 + h3) / 4;
    water[i] = minor === 3 && (upperFlags & 0x8000) !== 0 ? 1 : 0;
    if (canWalk) walkableCount++;
  }

  return {
    format: 'roo-walkmap-v1',
    mapId: mapIdFromName(name),
    name,
    version: major + '.' + minor,
    width,
    height,
    walkable,
    heights,
    terrainTypes,
    water,
    walkableCount,
    blockedCount: total - walkableCount,
  };
}

function removeGrid() {
  if (gridMesh) scene.remove(gridMesh);
  if (gridGeometry) gridGeometry.dispose();
  if (gridMaterial) gridMaterial.dispose();
  gridMesh = null;
  gridGeometry = null;
  gridMaterial = null;
}

function removeRoute() {
  if (routeLine) {
    scene.remove(routeLine);
    routeLine.geometry.dispose();
    routeLine.material.dispose();
    routeLine = null;
  }
  targetRing.visible = false;
}

function groundHeight(cell) {
  const idx = cell.y * gatInfo.width + cell.x;
  return -gatInfo.heights[idx] * worldScale;
}

function cellWorldPosition(cell, lift = 0) {
  const point = roMapWorldPointFromCell(gatInfo, cell.x, cell.y, worldScale);
  return new THREE.Vector3(point.x, groundHeight(cell) + tileSize() * lift, point.z);
}

function updatePlayerPosition() {
  if (!currentCell || !gatInfo) return;
  const pos = cellWorldPosition(currentCell, 1.0);
  playerSprite.position.copy(pos);
  playerSprite.scale.set(tileSize() * 1.0, tileSize() * 1.8, 1);
  fallbackPlayer.position.set(pos.x, groundHeight(currentCell) + tileSize() * 0.55, pos.z);
  fallbackPlayer.scale.setScalar(tileSize());
}

function makeGrid() {
  removeGrid();
  if (!showCellsInput.checked || !gatInfo || !mapRoot || mapInfo.mapId !== gatInfo.mapId) return;
  const total = gatInfo.width * gatInfo.height;
  if (total > 180000) {
    setStatus('這張地圖格子超過 18 萬；為保護效能，已停用通行格覆蓋，但角色仍會依 GAT 碰撞行走。');
    return;
  }

  const size = tileSize();
  gridGeometry = new THREE.PlaneGeometry(size * 0.92, size * 0.92);
  gridGeometry.rotateX(-Math.PI / 2);
  gridMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  gridMesh = new THREE.InstancedMesh(gridGeometry, gridMaterial, total);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < total; i++) {
    const x = i % gatInfo.width;
    const y = Math.floor(i / gatInfo.width);
    transform.position.set(
      (x + 0.5 - gatInfo.width / 2) * size,
      groundHeight({ x, y }) + size * 0.06,
      (gatInfo.height / 2 - y - 0.5) * size
    );
    transform.updateMatrix();
    gridMesh.setMatrixAt(i, transform.matrix);
    if (gatInfo.water[i]) color.set('#4da6ff');
    else if (gatInfo.walkable[i]) color.set('#48d597');
    else if (gatInfo.terrainTypes[i] === 5) color.set('#ffc15b');
    else color.set('#ff626e');
    gridMesh.setColorAt(i, color);
  }
  gridMesh.instanceMatrix.needsUpdate = true;
  if (gridMesh.instanceColor) gridMesh.instanceColor.needsUpdate = true;
  scene.add(gridMesh);
}

function savePosition() {
  if (!gatInfo || !currentCell) return;
  try {
    localStorage.setItem('roo_explorer_position_' + gatInfo.mapId, JSON.stringify(currentCell));
  } catch (error) {
    // 隱私模式或儲存被停用時，仍可正常探索。
  }
}

function startAtSavedOrCenter() {
  let start = null;
  try {
    const saved = JSON.parse(localStorage.getItem('roo_explorer_position_' + gatInfo.mapId) || 'null');
    if (saved && isRoMapCellWalkable(gatInfo, saved.x, saved.y)) start = saved;
  } catch (error) {
    start = null;
  }
  if (!start) {
    start = findNearestRoWalkableCell(
      gatInfo,
      Math.floor(gatInfo.width / 2),
      Math.floor(gatInfo.height / 2),
      64
    );
  }
  if (!start) throw new Error('地圖中心附近 64 格內找不到可行走的位置。');

  currentCell = { x: start.x, y: start.y };
  movementPath = null;
  pathIndex = 1;
  activeMapId = gatInfo.mapId;
  removeRoute();
  updatePlayerPosition();
  playerSprite.visible = true;
  fallbackPlayer.visible = playerMaterial.map == null;
  savePosition();
}

function updateRouteLine() {
  removeRoute();
  if (!movementPath || movementPath.length < 2) return;

  const points = movementPath.slice(Math.max(0, pathIndex - 1))
    .map(cell => cellWorldPosition(cell, 0.22));
  if (points.length > 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    routeLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: '#ffe18a',
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }));
    scene.add(routeLine);
  }
  const target = movementPath[movementPath.length - 1];
  targetRing.position.copy(cellWorldPosition(target, 0.1));
  targetRing.visible = true;
}

function finishOrRefreshScene() {
  if (gatInfo && mapRoot && mapInfo.mapId !== gatInfo.mapId) {
    removeGrid();
    removeRoute();
    playerSprite.visible = false;
    fallbackPlayer.visible = false;
    updateStats();
    setStatus('兩個檔案名稱不一致：GLB=' + mapInfo.mapId + '，GAT=' + gatInfo.mapId + '。請選同一張地圖。', true);
    return;
  }
  makeGrid();
  if (!gatInfo || !mapRoot) {
    removeRoute();
    playerSprite.visible = false;
    fallbackPlayer.visible = false;
    updateStats();
    return;
  }
  try {
    startAtSavedOrCenter();
    makeGrid();
    setStatus('地圖已就緒：點擊可走地面讓角色行走，障礙格會阻擋；拖曳旋轉、滾輪縮放。');
  } catch (error) {
    setStatus(error.message, true);
  }
  updateStats();
}

function updateStats() {
  const rows = [];
  if (mapInfo) {
    rows.push('GLB：' + mapInfo.name + '（' + mapInfo.mapId + '）');
    rows.push('場景大小：約 ' + [mapInfo.size.x, mapInfo.size.y, mapInfo.size.z].map(v => v.toFixed(1)).join(' × '));
  }
  if (gatInfo) {
    rows.push('GAT：' + gatInfo.name + '（' + gatInfo.mapId + '）');
    rows.push('版本 ' + gatInfo.version + '；尺寸 ' + gatInfo.width + ' × ' + gatInfo.height);
    rows.push('可走 ' + gatInfo.walkableCount + ' 格／阻擋 ' + gatInfo.blockedCount + ' 格');
  }
  rows.push('世界比例：' + worldScale + '；GAT 格寬 ' + tileSize().toFixed(2));
  if (currentCell) rows.push('目前格：(' + currentCell.x + ', ' + currentCell.y + ')');
  stats.textContent = rows.length ? rows.join('\n') : '尚未載入地圖';
}

function fitCamera() {
  if (!mapInfo) return;
  const maxDimension = Math.max(mapInfo.size.x, mapInfo.size.y, mapInfo.size.z, 10);
  camera.near = Math.max(maxDimension / 10000, 0.01);
  camera.far = maxDimension * 50;
  camera.position.set(maxDimension * 0.85, maxDimension * 0.75, maxDimension * 0.85);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.maxDistance = maxDimension * 20;
  controls.minDistance = Math.max(maxDimension * 0.01, 0.1);
  axes.scale.setScalar(Math.max(maxDimension / 80, 0.1));
  controls.update();
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

async function loadMapFile(file) {
  setStatus('正在載入 ' + file.name + '…');
  try {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
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
    mapInfo = { name: file.name, mapId: mapIdFromName(file.name), size };
    fitCamera();
    finishOrRefreshScene();
    if (!gatInfo) setStatus('已載入 GLB。請再選取同一張地圖的 GAT 檔，才能啟用碰撞與尋路。');
  } catch (error) {
    setStatus('GLB 載入失敗：' + error.message, true);
    console.error(error);
  }
}

async function loadGatFile(file) {
  setStatus('正在解析 ' + file.name + '…');
  try {
    gatInfo = parseGatBuffer(await file.arrayBuffer(), file.name);
    worldScale = safeScale();
    if (!worldScale) throw new Error('世界比例必須大於 0，且不可大於 10。');
    if (mapRoot && mapInfo && mapInfo.mapId !== gatInfo.mapId) {
      removeGrid();
      removeRoute();
      playerSprite.visible = false;
      fallbackPlayer.visible = false;
      updateStats();
      setStatus('兩個檔案名稱不一致：GLB=' + mapInfo.mapId + '，GAT=' + gatInfo.mapId + '。請選同一張地圖。', true);
      return;
    }
    finishOrRefreshScene();
  } catch (error) {
    gatInfo = null;
    removeGrid();
    removeRoute();
    updateStats();
    setStatus('GAT 解析失敗：' + error.message, true);
    console.error(error);
  }
}

function groundHitFromEvent(event) {
  if (!mapRoot || !gatInfo || !mapInfo || mapInfo.mapId !== gatInfo.mapId) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(mapRoot, true);
  for (const hit of hits) {
    if (!hit.face) continue;
    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (normal.y > 0.35) return hit;
  }
  return null;
}

function requestWalk(event) {
  if (!gatInfo || !mapRoot || !currentCell || mapInfo.mapId !== gatInfo.mapId) {
    setStatus('請先載入同一張地圖的 GLB 與 GAT。', true);
    return;
  }
  const hit = groundHitFromEvent(event);
  if (!hit) {
    setStatus('沒有點到可辨識的地面；請點擊地圖地板，而不是天空或牆面。');
    return;
  }

  let target = roMapCellFromWorldPoint(gatInfo, hit.point.x, hit.point.z, worldScale);
  if (!target) {
    setStatus('點擊位置在 GAT 地圖範圍之外。');
    return;
  }
  let snapped = false;
  if (!isRoMapCellWalkable(gatInfo, target.x, target.y)) {
    target = findNearestRoWalkableCell(gatInfo, target.x, target.y, 12);
    if (!target) {
      setStatus('附近 12 格內找不到可走地面。', true);
      return;
    }
    snapped = true;
  }

  const path = findRoPath(gatInfo, currentCell, target);
  if (!path) {
    setStatus('目的地與目前位置不相通；角色不會穿過障礙。', true);
    return;
  }
  movementPath = path;
  pathIndex = 1;
  if (path.length === 1) {
    movementPath = null;
    currentCell = { x: target.x, y: target.y };
    updatePlayerPosition();
    savePosition();
    removeRoute();
    setStatus('已到達目的地。');
  } else {
    updateRouteLine();
    setStatus((snapped ? '點擊處是障礙，已改到附近可走格。' : '已規劃路徑。')
      + ' 點擊其他位置可重新下達目的地。');
  }
  updateStats();
}

function advanceMovement(deltaSeconds) {
  if (!movementPath || !gatInfo || !currentCell) return;
  let budget = Number(speedInput.value) * tileSize() * deltaSeconds;
  let changedCell = false;
  while (budget > 0 && movementPath && pathIndex < movementPath.length) {
    const nextCell = movementPath[pathIndex];
    const destination = cellWorldPosition(nextCell, 1.0);
    const distance = playerSprite.position.distanceTo(destination);
    if (distance <= budget || distance < 0.0001) {
      playerSprite.position.copy(destination);
      budget -= distance;
      currentCell = { x: nextCell.x, y: nextCell.y };
      pathIndex++;
      changedCell = true;
      if (pathIndex >= movementPath.length) {
        movementPath = null;
        pathIndex = 1;
        removeRoute();
        setStatus('已到達目的地。');
      }
    } else {
      playerSprite.position.lerp(destination, budget / distance);
      budget = 0;
    }
  }
  if (fallbackPlayer.visible) {
    fallbackPlayer.position.set(
      playerSprite.position.x,
      playerSprite.position.y - tileSize() * 0.45,
      playerSprite.position.z
    );
  }
  if (changedCell) {
    savePosition();
    updateStats();
  }
}

function resize() {
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(stage);
resize();

modelInput.addEventListener('change', () => {
  const file = modelInput.files && modelInput.files[0];
  if (file) loadMapFile(file);
});
gatInput.addEventListener('change', () => {
  const file = gatInput.files && gatInput.files[0];
  if (file) loadGatFile(file);
});
scaleInput.addEventListener('change', () => {
  const nextScale = safeScale();
  if (!nextScale) {
    setStatus('世界比例必須大於 0，且不可大於 10。', true);
    return;
  }
  const ratio = nextScale / worldScale;
  worldScale = nextScale;
  if (mapRoot && Number.isFinite(ratio) && ratio > 0) {
    mapRoot.scale.multiplyScalar(ratio);
    camera.position.multiplyScalar(ratio);
    controls.target.multiplyScalar(ratio);
    mapRoot.updateMatrixWorld(true);
    mapBounds = new THREE.Box3().setFromObject(mapRoot);
    const size = mapBounds.getSize(new THREE.Vector3());
    if (mapInfo) mapInfo.size = size;
    camera.updateProjectionMatrix();
    controls.update();
  }
  if (gatInfo && mapRoot && mapInfo && mapInfo.mapId === gatInfo.mapId) {
    if (currentCell) updatePlayerPosition();
    makeGrid();
    if (movementPath) updateRouteLine();
    updateStats();
  }
});
speedInput.addEventListener('input', () => { speedValue.textContent = speedInput.value; });
showCellsInput.addEventListener('change', () => {
  makeGrid();
  if (showCellsInput.checked) setStatus('顯示通行格：綠色可走、紅色阻擋、橘色懸崖、藍色水域。');
});
document.getElementById('recenter').addEventListener('click', () => {
  fitCamera();
  setStatus('已重置視角。');
});
renderer.domElement.addEventListener('click', requestWalk);

function animate(now) {
  requestAnimationFrame(animate);
  const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
  lastFrame = now;
  advanceMovement(delta);
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

const params = new URLSearchParams(window.location.search);
const requestedMap = params.get('map');
if (requestedMap) {
  setStatus('目標地圖：' + requestedMap + '。請選取本機 ' + requestedMap + '.glb 與 ' + requestedMap + '.gat 檔。');
}

try {
  textureLoader.load('../images/player_swordsman.svg', texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    playerMaterial.map = texture;
    playerMaterial.needsUpdate = true;
    fallbackPlayer.visible = false;
    if (currentCell) playerSprite.visible = true;
  }, undefined, () => {
    playerSprite.visible = false;
    fallbackPlayer.visible = !!currentCell;
  });
} catch (error) {
  playerSprite.visible = false;
}
