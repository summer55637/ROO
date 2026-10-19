import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  RAGASSETS_BASE_URL,
  buildGndLightmapAtlasData,
  buildGndMeshData,
  analyzeRswPlacementBounds,
  buildRsmNodeTransformData,
  buildRsm2NodeTransformData,
  buildRsmNodeMeshData,
  buildRsm2NodeMeshData,
  transformRsmVertex,
  buildGndWaterMeshData,
  buildGndWaterMeshDataByPlane,
  compareGndGatHeights,
  insetGndTextureUvs,
  normalizeModelName,
  normalizeTextureName,
  parseGndBuffer,
  parseRsmBuffer,
  parseRswBuffer,
  resolveRagassetsMapUrls,
  resolveWaterFramesForType,
  sampleGndHeightAtGatCell,
  sampleRsmAnimationPose,
  sampleRsmTextureAnimation,
  sampleRoWaterTextureIntervalMs,
  fillRoWaterWaveOffsets,
  sampleRoWaterWaveOffset,
} from './ro_map_assets.mjs';
import { createLatestRequestGate } from './latest_request_gate.mjs';
import { createVisibilityAwareFrameLoop } from './visibility_frame_loop.mjs';
import {
  buildRoExplorerSpriteLayout,
  resolveRoExplorerSpriteKey,
  roExplorerSpriteFramePath,
} from './ro_explorer_sprites.mjs';

const stage = document.getElementById('stage');
const status = document.getElementById('status');
const stats = document.getElementById('stats');
const modelInput = document.getElementById('model-file');
const gatInput = document.getElementById('gat-file');
const scaleInput = document.getElementById('world-scale');
const speedInput = document.getElementById('move-speed');
const speedValue = document.getElementById('speed-value');
const showCellsInput = document.getElementById('show-cells');
const nativeMapInput = document.getElementById('native-map');
const loadNativeMapButton = document.getElementById('load-native-map');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#090f18');
const camera = new THREE.PerspectiveCamera(48, 1, 0.01, 100000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.style.touchAction = 'none';
stage.appendChild(renderer.domElement);

const hemisphereLight = new THREE.HemisphereLight(0xddeaff, 0x384252, 2.0);
scene.add(hemisphereLight);
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
const explorerSpriteKey = resolveRoExplorerSpriteKey(
  new URLSearchParams(window.location.search).get('sprite')
);

let mapRoot = null;
let mapInfo = null;
let mapBounds = null;
let gatInfo = null;
let gndInfo = null;
let rswInfo = null;
let nativeRenderStats = null;
let nativeWaterAnimations = [];
let activeRsmAnimations = [];
const nativeMapLoadGate = createLatestRequestGate();
let nativeMapLoadAbortController = null;
let gridMesh = null;
const MAX_NATIVE_MODEL_ASSETS = 100;
const MAX_NATIVE_MODEL_PLACEMENTS = 450;
let gridGeometry = null;
let gridMaterial = null;
let routeLine = null;
let targetRing = null;
let playerSprite = null;
let fallbackPlayer = null;
let playerSpriteFrames = [];
let playerSpriteFrameLayout = null;
let playerSpriteFrameMetrics = null;
const playerRoot = new THREE.Group();
let currentCell = null;
let movementPath = null;
let pathIndex = 1;
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
playerRoot.add(playerSprite);
scene.add(playerRoot);

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
  if (gndInfo && gatInfo
    && gatInfo.width === gndInfo.width * 2
    && gatInfo.height === gndInfo.height * 2) {
    return sampleGndHeightAtGatCell(gndInfo, cell.x, cell.y, worldScale);
  }
  const idx = cell.y * gatInfo.width + cell.x;
  return -gatInfo.heights[idx] * worldScale;
}

function cellWorldPosition(cell, lift = 0) {
  const point = roMapWorldPointFromCell(gatInfo, cell.x, cell.y, worldScale);
  return new THREE.Vector3(point.x, groundHeight(cell) + tileSize() * lift, point.z);
}

function updatePlayerPosition() {
  if (!currentCell || !gatInfo) return;
  const ground = cellWorldPosition(currentCell);
  if (playerSpriteFrameMetrics) {
    playerSpriteFrameLayout = buildRoExplorerSpriteLayout(
      playerSpriteFrameMetrics.width,
      playerSpriteFrameMetrics.height,
      playerSpriteFrameMetrics.bounds,
      tileSize()
    );
  }
  playerRoot.position.copy(ground);
  if (playerSpriteFrameLayout) {
    playerSprite.position.set(
      playerSpriteFrameLayout.offsetX,
      playerSpriteFrameLayout.offsetY,
      0
    );
    playerSprite.scale.set(
      playerSpriteFrameLayout.width,
      playerSpriteFrameLayout.height,
      1
    );
  } else {
    playerSprite.position.set(0, tileSize() * 0.9, 0);
    playerSprite.scale.set(tileSize(), tileSize() * 1.8, 1);
  }
  fallbackPlayer.position.set(ground.x, ground.y + tileSize() * 0.55, ground.z);
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
    setStatus('兩個檔案名稱不一致：地圖=' + mapInfo.mapId + '，GAT=' + gatInfo.mapId + '。請選同一張地圖。', true);
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
    rows.push('地圖：' + mapInfo.name + '（' + mapInfo.mapId + '）');
    rows.push('場景大小：約 ' + [mapInfo.size.x, mapInfo.size.y, mapInfo.size.z].map(v => v.toFixed(1)).join(' × '));
  }
  if (gatInfo) {
    rows.push('GAT：' + gatInfo.name + '（' + gatInfo.mapId + '）');
    rows.push('版本 ' + gatInfo.version + '；尺寸 ' + gatInfo.width + ' × ' + gatInfo.height);
    rows.push('可走 ' + gatInfo.walkableCount + ' 格／阻擋 ' + gatInfo.blockedCount + ' 格');
  }
  if (rswInfo) {
    rows.push('RSW：' + rswInfo.version + '；模型位置 ' + rswInfo.models.length
      + '、點光源 ' + rswInfo.lights.length + '、音效 ' + rswInfo.sounds.length + '、效果 ' + rswInfo.effects.length);
  }
  if (nativeRenderStats) {
    rows.push('原生模型：' + nativeRenderStats.renderedPlacements + ' 個／上限 '
      + MAX_NATIVE_MODEL_PLACEMENTS + '；載入資源 ' + nativeRenderStats.loadedAssets
      + ' 個，未支援／失敗 ' + nativeRenderStats.unsupportedOrFailed);
    rows.push('水域：' + (nativeRenderStats.waterTileCount || 0) + ' 格；動畫影格 '
      + (nativeRenderStats.waterFrameCount || 0) + '；缺少類型影格、使用備援 '
      + (nativeRenderStats.waterTextureFallbackPlanes || 0) + ' 區');
    rows.push('RSM2.3 UV 動畫：' + (nativeRenderStats.textureAnimatedPlacements || 0)
      + ' 個擺放實例；' + (nativeRenderStats.textureAnimationMeshes || 0)
      + ' 個網格／' + (nativeRenderStats.textureAnimationChannels || 0) + ' 個通道');
    rows.push('GND lightmap：' + (nativeRenderStats.lightmapSlices || 0) + ' slices；'
      + (nativeRenderStats.lightmapLayout || '無') + '；貼圖合成 '
      + (nativeRenderStats.lightmapAtlas ? '已啟用' : '未啟用'));
    if (nativeRenderStats.heightAlignment) {
      const alignment = nativeRenderStats.heightAlignment;
      rows.push('GND/GAT 高度差：平均 ' + (alignment.meanAbsoluteError === null
        ? '—' : alignment.meanAbsoluteError.toFixed(3)) + '、P95 '
        + (alignment.p95AbsoluteError === null ? '—' : alignment.p95AbsoluteError.toFixed(3))
        + '、最大 ' + (alignment.maxAbsoluteError === null ? '—' : alignment.maxAbsoluteError.toFixed(3))
        + '（世界單位；樣本 ' + alignment.samples + '）');
    }
    if (nativeRenderStats.placementBounds) {
      const placement = nativeRenderStats.placementBounds;
      rows.push('RSW 模型位置：範圍內 ' + placement.withinBounds + '/' + placement.total
        + '；含 1 格邊界 ' + placement.withinOneTileMargin
        + '；越界最大距離 ' + placement.maximumOutsideDistance.toFixed(2));
    }
  }
  rows.push('角色素材：' + explorerSpriteKey + (playerSpriteFrames.length ? '（職業影格已載入）' : '（待機備援圖）'));
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

function disposeNativeWaterAnimationTextures(animations) {
  const activeTextures = new Set();
  const ownedTextures = new Set();
  for (const animation of animations || []) {
    for (const texture of animation.textures || []) ownedTextures.add(texture);
    const activeTexture = animation.mesh && animation.mesh.material
      ? animation.mesh.material.map : null;
    if (activeTexture) activeTextures.add(activeTexture);
  }
  for (const texture of ownedTextures) {
    if (texture && !activeTextures.has(texture)) texture.dispose();
  }
}

function clearNativeWaterAnimation() {
  disposeNativeWaterAnimationTextures(nativeWaterAnimations);
  nativeWaterAnimations = [];
}

function beginLocalMapLoadRequest() {
  if (nativeMapLoadAbortController) nativeMapLoadAbortController.abort();
  nativeMapLoadAbortController = null;
  const token = nativeMapLoadGate.begin();
  return () => nativeMapLoadGate.isCurrent(token);
}

function advanceNativeWater(now) {
  for (const animation of nativeWaterAnimations) {
    if (animation.waveEnabled && animation.basePositions && animation.tileCoordinates) {
      if (animation.waveStartedAt === null) animation.waveStartedAt = now;
      const elapsedSeconds = Math.max(0, (now - animation.waveStartedAt) / 1000);
      const positionAttribute = animation.mesh.geometry.getAttribute('position');
      const positions = positionAttribute.array;
      // Reuse a map-wide scratch buffer; planes are advanced sequentially.
      const waveOffsets = animation.waveOffsets;
      fillRoWaterWaveOffsets(
        animation.waterConfig,
        animation.mapWidth,
        animation.mapHeight,
        elapsedSeconds,
        waveOffsets,
        animation.worldScale
      );
      for (let tile = 0; tile < animation.tileCoordinates.length / 2; tile++) {
        const x = animation.tileCoordinates[tile * 2];
        const z = animation.tileCoordinates[tile * 2 + 1];
        const base = tile * 12;
        // Vertex layout: (x,z+1), (x+1,z+1), (x,z), (x+1,z).
        positions[base + 1] = animation.basePositions[base + 1] + waveOffsets[x + z + 1];
        positions[base + 4] = animation.basePositions[base + 4] + waveOffsets[x + z + 2];
        positions[base + 7] = animation.basePositions[base + 7] + waveOffsets[x + z];
        positions[base + 10] = animation.basePositions[base + 10] + waveOffsets[x + z + 1];
      }
      positionAttribute.needsUpdate = true;
    }

    // Texture cycling and vertex waves are independent in the RO map format.
    if (animation.textures.length < 2) continue;
    if (!animation.nextFrameAt) {
      animation.nextFrameAt = now + animation.intervalMs;
      continue;
    }
    if (now < animation.nextFrameAt) continue;
    const steps = Math.floor((now - animation.nextFrameAt) / animation.intervalMs) + 1;
    animation.frameIndex = (animation.frameIndex + steps) % animation.textures.length;
    animation.mesh.material.map = animation.textures[animation.frameIndex];
    animation.mesh.material.needsUpdate = true;
    animation.nextFrameAt += steps * animation.intervalMs;
  }
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

function getModelTextureUrl(urls, textureName) {
  const normalized = normalizeTextureName(textureName);
  if (!normalized) return null;
  if (urls.textures[normalized]) return urls.textures[normalized];

  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (!basename) return null;
  const candidates = Object.entries(urls.textures)
    .filter(([name]) => name === basename || name.endsWith('/' + basename))
    .map(([, url]) => url);
  return candidates.length === 1 ? candidates[0] : null;
}

function loadModelTexture(url, textureCache) {
  if (!url || !textureCache) return null;
  if (textureCache.has(url)) return textureCache.get(url);
  const texture = textureLoader.load(url, loadedTexture => {
    loadedTexture.colorSpace = THREE.SRGBColorSpace;
    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.RepeatWrapping;
    loadedTexture.needsUpdate = true;
  }, undefined, () => {
    textureCache.delete(url);
  });
  textureCache.set(url, texture);
  return texture;
}

function loadAnimatedModelTexture(url) {
  if (!url) return null;
  const texture = textureLoader.load(url, loadedTexture => {
    loadedTexture.colorSpace = THREE.SRGBColorSpace;
    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.RepeatWrapping;
    loadedTexture.needsUpdate = true;
  }, undefined, () => {
    console.warn('ROO RSM2.3 貼圖動畫載入失敗：' + url);
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.center.set(0.5, 0.5);
  return texture;
}

function rsmTextureNames(rsm, node) {
  if (rsm.major === 2 && rsm.minor >= 3) return node.textureNames;
  return node.textureIndices.map(index => rsm.textures[index] || '');
}

function buildRsmTemplate(rsm, urls, scale, textureCache) {
  if (rsm.major !== 1 && rsm.major !== 2) return null;

  const modelRoot = new THREE.Group();
  const nodesByName = new Map();
  for (let index = 0; index < rsm.nodes.length; index++) {
    const node = rsm.nodes[index];
    if (!nodesByName.has(node.name)) nodesByName.set(node.name, []);
    nodesByName.get(node.name).push(index);
  }

  const nodeGroups = rsm.nodes.map((node, index) => {
    let transform;
    if (rsm.major === 2) {
      const parents = nodesByName.get(node.parentName) || [];
      const parentIndex = parents.find(candidate => candidate !== index);
      const parentNode = parentIndex === undefined ? null : rsm.nodes[parentIndex];
      transform = buildRsm2NodeTransformData(node, parentNode, scale);
    } else {
      transform = buildRsmNodeTransformData(node, scale);
    }

    const group = new THREE.Group();
    group.name = node.name || 'rsm-node';
    group.position.set(...transform.position);
    group.quaternion.set(...transform.rotation);
    group.scale.set(...transform.scale);
    const animationTrack = {
      rotationKeyframes: node.rotationKeyframes || [],
      scaleKeyframes: node.scaleKeyframes || [],
      translationKeyframes: node.translationKeyframes || [],
    };
    if (animationTrack.rotationKeyframes.length || animationTrack.scaleKeyframes.length
      || animationTrack.translationKeyframes.length) {
      group.userData.rooRsmAnimation = animationTrack;
      const firstPose = sampleRsmAnimationPose(animationTrack, 0, rsm.major, scale);
      if (firstPose.rotation) group.quaternion.set(...firstPose.rotation);
      if (firstPose.scale) group.scale.set(...firstPose.scale);
      if (firstPose.translation) group.position.set(...firstPose.translation);
    }

    const textureNames = rsmTextureNames(rsm, node);
    const meshData = rsm.major === 2
      ? buildRsm2NodeMeshData(node, rsm.shadeType, scale)
      : buildRsmNodeMeshData(node, rsm.shadeType, scale);
    for (const data of meshData.buckets) {
      if (!data.indices.length) continue;
      const textureName = textureNames[data.textureIndex] || '';
      const textureUrl = getModelTextureUrl(urls, textureName);
      const texture = loadModelTexture(textureUrl, textureCache);
      const opacity = Math.max(0, Math.min(1, rsm.alpha / 255));
      const materialOptions = {
        map: texture,
        color: texture ? 0xffffff : 0xb8b4a0,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
        roughness: 1,
        metalness: 0,
      };
      const material = rsm.shadeType === 0
        ? new THREE.MeshBasicMaterial(materialOptions)
        : new THREE.MeshStandardMaterial(materialOptions);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      geometry.setIndex(data.indices);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'rsm-mesh-' + textureName;
      if (rsm.major === 2 && rsm.minor >= 3 && textureUrl) {
        const textureAnimation = (node.textureAnimations || [])
          .find(item => item.textureIndex === data.textureIndex);
        const channels = textureAnimation && Array.isArray(textureAnimation.channels)
          ? textureAnimation.channels.filter(channel => Number.isInteger(channel.operation)
            && channel.operation >= 0 && channel.operation <= 4
            && Array.isArray(channel.frames) && channel.frames.length > 0)
          : [];
        if (channels.length) {
          mesh.userData.rooRsmTextureAnimation = { textureUrl, channels };
        }
      }
      group.add(mesh);
    }
    return group;
  });

  const parented = new Set();
  for (let index = 0; index < rsm.nodes.length; index++) {
    const node = rsm.nodes[index];
    const parents = nodesByName.get(node.parentName) || [];
    const parentIndex = parents.find(candidate => candidate !== index);
    if (node.parentName && parentIndex !== undefined) {
      nodeGroups[parentIndex].add(nodeGroups[index]);
      parented.add(index);
    } else {
      modelRoot.add(nodeGroups[index]);
    }
  }

  const bounds = new THREE.Box3().setFromObject(modelRoot);
  if (bounds.isEmpty()) return null;
  // RSM1 stores Y-down meshes and needs the legacy ground-anchor shift.
  // RSM2 transforms are already absolute and must remain aligned to RSW coordinates.
  if (rsm.major === 1) {
    const center = bounds.getCenter(new THREE.Vector3());
    const rootShift = new THREE.Vector3(-center.x, -bounds.max.y, -center.z);
    for (let index = 0; index < rsm.nodes.length; index++) {
      if (!parented.has(index)) nodeGroups[index].position.add(rootShift);
    }
  }
  modelRoot.userData.rooModelVersion = rsm.version;
  modelRoot.userData.rooModelIsRsm2 = rsm.major === 2;
  modelRoot.userData.rooRsmModel = {
    major: rsm.major,
    framesPerSecond: Number.isFinite(rsm.framesPerSecond) && rsm.framesPerSecond > 0
      ? rsm.framesPerSecond : 60,
    animationLength: rsm.animationLength,
    worldScale: scale,
  };
  return modelRoot;
}

function createRsmAnimationInstance(instance, modelRoot) {
  const model = modelRoot && modelRoot.userData.rooRsmModel;
  if (!model || !Number.isFinite(Number(instance.animationType)) || Number(instance.animationType) === 0) {
    return null;
  }

  const tracks = [];
  const textureTracks = [];
  let lastKeyframe = 0;
  modelRoot.traverse(object => {
    const data = object.userData && object.userData.rooRsmAnimation;
    if (data) {
      const hasKeys = data.rotationKeyframes.length || data.scaleKeyframes.length
        || data.translationKeyframes.length;
      if (hasKeys) {
        tracks.push({ object, data });
        for (const keys of [data.rotationKeyframes, data.scaleKeyframes, data.translationKeyframes]) {
          for (const key of keys) lastKeyframe = Math.max(lastKeyframe, key.frame);
        }
      }
    }

    const textureData = object.userData && object.userData.rooRsmTextureAnimation;
    if (!textureData || !object.isMesh || !textureData.textureUrl
      || !Array.isArray(textureData.channels) || !textureData.channels.length
      || !object.material || Array.isArray(object.material)) return;
    const material = object.material.clone();
    const texture = loadAnimatedModelTexture(textureData.textureUrl);
    if (!texture) return;
    material.map = texture;
    texture.center.set(0.5, 0.5);
    texture.offset.set(0, 0);
    texture.repeat.set(1, 1);
    texture.rotation = 0;
    texture.needsUpdate = true;
    object.material = material;
    textureTracks.push({ texture, channels: textureData.channels });
    for (const channel of textureData.channels) {
      for (const key of channel.frames || []) lastKeyframe = Math.max(lastKeyframe, key.frame);
    }
  });
  if (!tracks.length && !textureTracks.length) return null;

  const animationLength = Number(model.animationLength);
  const durationTicks = Math.max(
    Number.isFinite(animationLength) && animationLength > 0 ? animationLength : 0,
    lastKeyframe
  );
  if (!(durationTicks > 0)) return null;

  const configuredSpeed = Number(instance.animationSpeed);
  const speed = Math.max(
    Number.isFinite(configuredSpeed) && configuredSpeed > 0 ? configuredSpeed : 1,
    0.03
  );
  return {
    major: model.major,
    framesPerSecond: model.framesPerSecond,
    durationTicks,
    worldScale: model.worldScale,
    speed,
    startedAt: null,
    tracks,
    textureTracks,
  };
}

function advanceRsmAnimations(now) {
  for (const animation of activeRsmAnimations) {
    if (animation.startedAt === null) animation.startedAt = now;
    const elapsedSeconds = Math.max(0, (now - animation.startedAt) / 1000);
    const ticksPerSecond = animation.major === 1 ? 1000 : animation.framesPerSecond;
    const rawTime = elapsedSeconds * ticksPerSecond * animation.speed;
    const frame = ((rawTime % animation.durationTicks) + animation.durationTicks)
      % animation.durationTicks;

    for (const track of animation.tracks) {
      const pose = sampleRsmAnimationPose(track.data, frame, animation.major, animation.worldScale);
      if (pose.rotation) track.object.quaternion.set(...pose.rotation);
      if (pose.scale) track.object.scale.set(...pose.scale);
      if (pose.translation) track.object.position.set(...pose.translation);
    }
    for (const track of animation.textureTracks) {
      const transform = sampleRsmTextureAnimation(track.channels, frame, animation.durationTicks);
      track.texture.offset.set(transform.offset[0], transform.offset[1]);
      track.texture.repeat.set(transform.scale[0], transform.scale[1]);
      track.texture.rotation = transform.rotation;
    }
  }
}

function makeRswInstanceTransform(instance, scale) {
  const group = new THREE.Group();
  const p = instance.position;
  group.position.set(p[0] * scale, -p[1] * scale, -p[2] * scale);
  const rotation = instance.rotation.map(value => value * Math.PI / 180);
  const [rx, ry, rz] = rotation;
  const sourceRotation = new THREE.Matrix4()
    .makeRotationZ(-rz)
    .multiply(new THREE.Matrix4().makeRotationX(-rx))
    .multiply(new THREE.Matrix4().makeRotationY(ry));
  const mirrorZ = new THREE.Matrix4().makeScale(1, 1, -1);
  sourceRotation.premultiply(mirrorZ).multiply(mirrorZ);
  group.quaternion.setFromRotationMatrix(sourceRotation).normalize();
  group.scale.set(instance.scale[0], instance.scale[1], instance.scale[2]);
  return group;
}

async function loadAndPlaceRswModels(rsw, urls, mapRoot, scale, isCurrentRequest, requestSignal) {
  const textureCache = new Map();
  const placements = rsw.models.slice(0, MAX_NATIVE_MODEL_PLACEMENTS);
  const availableByUrl = new Map();
  let unresolvedNames = 0;
  for (const placement of placements) {
    const assetUrl = urls.models[normalizeModelName(placement.modelName)];
    if (!assetUrl) {
      unresolvedNames++;
      continue;
    }
    if (!availableByUrl.has(assetUrl)) availableByUrl.set(assetUrl, placement.modelName);
  }

  const assetUrls = [...availableByUrl.keys()];
  const selectedUrls = assetUrls.slice(0, MAX_NATIVE_MODEL_ASSETS);
  const templates = new Map();
  const animations = [];
  let failedOrUnsupported = Math.max(0, assetUrls.length - selectedUrls.length);

  for (let start = 0; start < selectedUrls.length; start += 8) {
    const batch = selectedUrls.slice(start, start + 8);
    const loaded = await Promise.all(batch.map(async assetUrl => {
      try {
        const timeoutSignal = AbortSignal.timeout(20000);
        const fetchSignal = requestSignal && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([requestSignal, timeoutSignal])
          : (requestSignal || timeoutSignal);
        const response = await fetch(assetUrl, { mode: 'cors', signal: fetchSignal });
        if (!response.ok) throw new Error('RSM HTTP ' + response.status);
        const rsm = parseRsmBuffer(await response.arrayBuffer());
        const template = buildRsmTemplate(rsm, urls, scale, textureCache);
        return { assetUrl, template, supported: !!template };
      } catch (error) {
        if (isCurrentRequest()) console.warn('ROO RSM 載入失敗：' + assetUrl, error);
        return { assetUrl, template: null, supported: false };
      }
    }));
    for (const item of loaded) {
      if (item.template) templates.set(item.assetUrl, item.template);
      else failedOrUnsupported++;
    }
    if (!isCurrentRequest()) {
      const geometries = new Set();
      const materials = new Set();
      const textures = new Set(textureCache.values());
      for (const template of templates.values()) {
        template.traverse(node => {
          if (node.geometry) geometries.add(node.geometry);
          const list = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
          for (const material of list) {
            materials.add(material);
            for (const value of Object.values(material)) {
              if (value && value.isTexture) textures.add(value);
            }
          }
        });
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      return {
        renderedPlacements: 0,
        loadedAssets: 0,
        unsupportedOrFailed: 0,
        unresolvedNames: 0,
        truncatedPlacements: 0,
        animations: [],
        aborted: true,
      };
    }
    setStatus('已解析 ' + Math.min(start + batch.length, selectedUrls.length) + '/'
      + selectedUrls.length + ' 個地圖模型資源…');
  }

  let renderedPlacements = 0;
  let unsupportedPlacements = 0;
  for (const placement of placements) {
    const assetUrl = urls.models[normalizeModelName(placement.modelName)];
    const template = assetUrl && templates.get(assetUrl);
    if (!template) {
      unsupportedPlacements++;
      continue;
    }
    const instance = template.clone(true);
    const animation = createRsmAnimationInstance(placement, instance);
    if (animation) animations.push(animation);
    const transform = makeRswInstanceTransform(placement, scale);
    transform.add(instance);
    transform.userData.rooMapObject = true;
    transform.name = placement.name || placement.modelName;
    mapRoot.add(transform);
    renderedPlacements++;
  }

  return {
    renderedPlacements,
    loadedAssets: templates.size,
    unsupportedOrFailed: failedOrUnsupported + unsupportedPlacements + unresolvedNames,
    unresolvedNames,
    truncatedPlacements: Math.max(0, rsw.models.length - placements.length),
    animations,
  };
}

function applyRswLighting(rsw, mapSize) {
  if (!rsw || !rsw.light) return;
  const ambient = rsw.light.ambient;
  const diffuse = rsw.light.diffuse;
  hemisphereLight.groundColor.setRGB(ambient[0], ambient[1], ambient[2]);
  hemisphereLight.color.setRGB(
    Math.min(1, ambient[0] + 0.12),
    Math.min(1, ambient[1] + 0.12),
    Math.min(1, ambient[2] + 0.12)
  );
  keyLight.color.setRGB(diffuse[0], diffuse[1], diffuse[2]);
  fillLight.color.setRGB(
    Math.min(1, diffuse[0] * 0.65 + ambient[0] * 0.35),
    Math.min(1, diffuse[1] * 0.65 + ambient[1] * 0.35),
    Math.min(1, diffuse[2] * 0.65 + ambient[2] * 0.35)
  );

  const longitude = rsw.light.longitude * Math.PI / 180;
  const latitude = rsw.light.latitude * Math.PI / 180;
  const direction = new THREE.Vector3(
    Math.cos(latitude) * Math.cos(longitude),
    Math.sin(latitude),
    Math.cos(latitude) * Math.sin(longitude)
  ).normalize();
  const distance = Math.max(mapSize.x, mapSize.y, mapSize.z, 100) * 1.5;
  keyLight.position.copy(direction.clone().multiplyScalar(distance));
  fillLight.position.copy(direction.clone().multiplyScalar(-distance * 0.6));
}

function resetRswLighting() {
  hemisphereLight.color.set('#ddeaff');
  hemisphereLight.groundColor.set('#384252');
  keyLight.color.set('#ffffff');
  keyLight.position.set(250, 500, 300);
  fillLight.color.set('#b6d5ff');
  fillLight.position.set(-300, 150, -250);
}

function applyGndBakedLighting(material, lightMapTexture, aoTexture) {
  material.onBeforeCompile = shader => {
    shader.uniforms.rooGndLightMap = { value: lightMapTexture };
    shader.uniforms.rooGndAoMap = { value: aoTexture };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nattribute vec2 uv2;\nvarying vec2 vRooGndLightmapUv;'
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRooGndLightmapUv = uv2;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform sampler2D rooGndLightMap;\nuniform sampler2D rooGndAoMap;\nvarying vec2 vRooGndLightmapUv;'
    ).replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n'
        + 'diffuseColor.rgb *= texture2D(rooGndLightMap, vRooGndLightmapUv).rgb;\n'
        + 'diffuseColor.rgb *= texture2D(rooGndAoMap, vRooGndLightmapUv).r;'
    );
  };
  material.customProgramCacheKey = () => 'roo-gnd-baked-lightmap-v1';
}

function createLightmapDataTexture(data, width, height) {
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

async function addNativeWater(root, gat, waterConfig, urls, scale) {
  const waterData = buildGndWaterMeshDataByPlane(gat, waterConfig, scale);
  if (!waterData.waterTileCount) {
    return { animations: [], waterTileCount: 0, waterFrameCount: 0 };
  }

  // Cache each decoded water texture once, even when several planes share a type.
  const texturePromises = new Map();
  async function loadTextures(frameUrls) {
    const requests = frameUrls.slice(0, 32).map(url => {
      if (!texturePromises.has(url)) {
        texturePromises.set(url, textureLoader.loadAsync(url).then(texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.needsUpdate = true;
          return texture;
        }).catch(error => {
          console.warn('ROO 水面影格載入失敗：' + url, error);
          return null;
        }));
      }
      return texturePromises.get(url);
    });
    return (await Promise.all(requests)).filter(Boolean);
  }

  const animations = [];
  let maxFrameCount = 0;
  let fallbackWaterPlaneCount = 0;
  let sharedWaveOffsets = null;
  for (const plane of waterData.planes) {
    const config = plane.config;
    const frameSelection = resolveWaterFramesForType(urls, config.type);
    if (frameSelection.usedFallback) fallbackWaterPlaneCount++;
    const textures = await loadTextures(frameSelection.frames);
    maxFrameCount = Math.max(maxFrameCount, textures.length);

    const data = plane.data;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(data.indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      map: textures[0] || null,
      color: textures.length ? 0xffffff : 0x63b5d8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'roo-native-water-' + plane.gridX + '-' + plane.gridY;
    mesh.renderOrder = 2;
    mesh.userData.rooMapWater = true;
    root.add(mesh);

    const interval = Number(config.textureCyclingInterval);
    const waveEnabled = Number.isFinite(config.waveHeight) && Math.abs(config.waveHeight) > 1e-8;
    const textureCyclingEnabled = textures.length > 1;
    if (waveEnabled || textureCyclingEnabled) {
      if (waveEnabled && !sharedWaveOffsets) {
        sharedWaveOffsets = new Float32Array(gat.width + gat.height + 1);
      }
      animations.push({
        mesh,
        textures,
        frameIndex: 0,
        nextFrameAt: 0,
        intervalMs: sampleRoWaterTextureIntervalMs(interval),
        waveEnabled,
        waterConfig: config,
        waveOffsets: waveEnabled ? sharedWaveOffsets : null,
        worldScale: scale,
        mapWidth: gat.width,
        mapHeight: gat.height,
        tileCoordinates: Uint32Array.from(data.tileCoordinates),
        basePositions: Float32Array.from(data.positions),
        waveStartedAt: null,
      });
    }
  }

  return {
    animations,
    waterTileCount: waterData.waterTileCount,
    waterFrameCount: maxFrameCount,
    waterTextureFallbackPlanes: fallbackWaterPlaneCount,
  };
}

async function loadRagassetsMap(mapName) {
  const loadToken = nativeMapLoadGate.begin();
  if (nativeMapLoadAbortController) nativeMapLoadAbortController.abort();
  nativeMapLoadAbortController = null;
  const isCurrentRequest = () => nativeMapLoadGate.isCurrent(loadToken);
  let stagedRoot = null;
  let stagedWaterStats = null;
  const mapId = String(mapName || '').trim().toLowerCase();
  if (!/^[a-z0-9_@-]{1,64}$/.test(mapId)) {
    setStatus('地圖 ID 格式無效。', true);
    return;
  }

  const abortController = new AbortController();
  nativeMapLoadAbortController = abortController;
  setStatus('正在從公開素材來源載入 ' + mapId + ' 的 GND／GAT／RSW…');
  try {
    const manifestUrl = new URL('/maps/' + mapId + '/manifest.json', RAGASSETS_BASE_URL);
    const manifestResponse = await fetch(manifestUrl.href, { mode: 'cors', signal: abortController.signal });
    if (!isCurrentRequest()) return;
    if (!manifestResponse.ok) throw new Error('manifest HTTP ' + manifestResponse.status);
    const manifest = await manifestResponse.json();
    if (!isCurrentRequest()) return;
    const urls = resolveRagassetsMapUrls(mapId, manifest);
    const responses = await Promise.all([
      fetch(urls.gnd, { mode: 'cors', signal: abortController.signal }),
      fetch(urls.gat, { mode: 'cors', signal: abortController.signal }),
      fetch(urls.rsw, { mode: 'cors', signal: abortController.signal }),
    ]);
    if (!isCurrentRequest()) return;
    const labels = ['GND 地表', 'GAT 通行格', 'RSW 場景設定'];
    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].ok) throw new Error(labels[i] + ' HTTP ' + responses[i].status);
    }
    const buffers = await Promise.all(responses.map(response => response.arrayBuffer()));
    if (!isCurrentRequest()) return;
    const parsedGnd = parseGndBuffer(buffers[0]);
    const parsedGat = parseGatBuffer(buffers[1], mapId + '.gat');
    const parsedRsw = parseRswBuffer(buffers[2]);
    if (parsedGat.width !== parsedGnd.width * 2 || parsedGat.height !== parsedGnd.height * 2) {
      throw new Error('GND／GAT 尺寸不相符：GND=' + parsedGnd.width + '×' + parsedGnd.height
        + '，GAT=' + parsedGat.width + '×' + parsedGat.height + '。');
    }

    const nextScale = safeScale();
    if (!nextScale) throw new Error('世界比例必須大於 0，且不可大於 10。');
    const lightmapAtlas = buildGndLightmapAtlasData(parsedGnd);
    const meshData = buildGndMeshData(parsedGnd, nextScale, lightmapAtlas);
    const lightmapTexture = lightmapAtlas
      ? createLightmapDataTexture(lightmapAtlas.lightMapPixels, lightmapAtlas.width, lightmapAtlas.height)
      : null;
    const aoTexture = lightmapAtlas
      ? createLightmapDataTexture(lightmapAtlas.aoMapPixels, lightmapAtlas.width, lightmapAtlas.height)
      : null;
    stagedRoot = new THREE.Group();
    stagedRoot.name = 'roo-native-map-' + mapId;

    for (const bucket of meshData.buckets) {
      if (!bucket.indices.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
      if (lightmapAtlas) geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(bucket.lightmapUvs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
      geometry.setIndex(bucket.indices);
      geometry.computeVertexNormals();

      let material;
      let texture = null;
      const textureName = bucket.textureIndex >= 0 ? parsedGnd.textures[bucket.textureIndex] : '';
      const textureUrl = urls.textures[normalizeTextureName(textureName)];
      if (textureUrl) {
        texture = textureLoader.load(textureUrl, loadedTexture => {
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.wrapS = THREE.RepeatWrapping;
          loadedTexture.wrapT = THREE.RepeatWrapping;
          const textureWidth = loadedTexture.image && (loadedTexture.image.naturalWidth || loadedTexture.image.width);
          const textureHeight = loadedTexture.image && (loadedTexture.image.naturalHeight || loadedTexture.image.height);
          if (textureWidth > 0 && textureHeight > 0) {
            const uvAttribute = geometry.getAttribute('uv');
            uvAttribute.array.set(insetGndTextureUvs(uvAttribute.array, textureWidth, textureHeight));
            uvAttribute.needsUpdate = true;
          }
          loadedTexture.needsUpdate = true;
        }, undefined, () => {
          if (material) {
            material.map = null;
            material.color.set('#9cb68c');
            material.needsUpdate = true;
          }
        });
      }
      if (lightmapAtlas) {
        material = new THREE.MeshBasicMaterial({
          map: texture,
          color: texture ? 0xffffff : 0x9cb68c,
          vertexColors: true,
          side: THREE.DoubleSide,
        });
        applyGndBakedLighting(material, lightmapTexture, aoTexture);
      } else {
        material = new THREE.MeshStandardMaterial({
          map: texture,
          color: texture ? 0xffffff : 0x9cb68c,
          vertexColors: true,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
        });
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'terrain-texture-' + bucket.textureIndex;
      mesh.userData.rooTerrainSurface = true;
      stagedRoot.add(mesh);
    }

    setStatus('地表已建立，正在載入 RSW 模型資源…');
    const nextRenderStats = await loadAndPlaceRswModels(
      parsedRsw, urls, stagedRoot, nextScale, isCurrentRequest, abortController.signal
    );
    if (!isCurrentRequest() || nextRenderStats.aborted) {
      disposeObject(stagedRoot);
      stagedRoot = null;
      return;
    }
    const { animations: nextRsmAnimations, ...modelRenderStats } = nextRenderStats;
    const waterConfig = parsedGnd.water || parsedRsw.water;
    setStatus('模型已載入，正在建立水域…');
    stagedWaterStats = await addNativeWater(stagedRoot, parsedGat, waterConfig, urls, nextScale);
    if (!isCurrentRequest()) {
      disposeNativeWaterAnimationTextures(stagedWaterStats.animations);
      disposeObject(stagedRoot);
      stagedWaterStats = null;
      stagedRoot = null;
      return;
    }
    const nextWaterStats = stagedWaterStats;

    const bounds = new THREE.Box3().setFromObject(stagedRoot);
    if (bounds.isEmpty()) throw new Error('GND 沒有可顯示的地表；無法建立原生地圖。');
    worldScale = nextScale;
    clearNativeWaterAnimation();
    if (mapRoot) {
      scene.remove(mapRoot);
      disposeObject(mapRoot);
    }
    nativeWaterAnimations = nextWaterStats.animations;
    mapRoot = stagedRoot;
    stagedRoot = null;
    stagedWaterStats = null;
    activeRsmAnimations = nextRsmAnimations;
    scene.add(mapRoot);
    mapRoot.updateMatrixWorld(true);
    mapBounds = new THREE.Box3().setFromObject(mapRoot);
    mapInfo = {
      name: mapId + '（公開 GND/RSW）',
      mapId,
      native: true,
      size: mapBounds.getSize(new THREE.Vector3()),
    };
    gatInfo = parsedGat;
    gndInfo = parsedGnd;
    rswInfo = parsedRsw;
    nativeRenderStats = {
      ...modelRenderStats,
      waterTileCount: nextWaterStats.waterTileCount,
      waterFrameCount: nextWaterStats.waterFrameCount,
      waterTextureFallbackPlanes: nextWaterStats.waterTextureFallbackPlanes,
      textureAnimatedPlacements: nextRsmAnimations.filter(animation => animation.textureTracks.length > 0).length,
      textureAnimationMeshes: nextRsmAnimations.reduce((sum, animation) => sum + animation.textureTracks.length, 0),
      textureAnimationChannels: nextRsmAnimations.reduce((sum, animation) => sum
        + animation.textureTracks.reduce((meshSum, track) => meshSum + track.channels.length, 0), 0),
      lightmapSlices: parsedGnd.lightmapCount,
      lightmapLayout: parsedGnd.lightmapLayout,
      lightmapAtlas: !!lightmapAtlas,
      heightAlignment: compareGndGatHeights(parsedGnd, parsedGat, nextScale),
      placementBounds: analyzeRswPlacementBounds(parsedGnd, parsedRsw, nextScale),
    };
    applyRswLighting(parsedRsw, mapInfo.size);
    fitCamera();
    finishOrRefreshScene();
    setStatus('原生地圖已載入：地表＋RSM 模型 ' + modelRenderStats.renderedPlacements
      + ' 個／' + parsedRsw.models.length + ' 個擺放位置；水域 ' + nextWaterStats.waterTileCount
      + ' 格、動畫影格 ' + nextWaterStats.waterFrameCount + ' 張。GND lightmap/AO 與頂點水波已啟用，實際畫面仍待校驗。');
    updateStats();
  } catch (error) {
    if (stagedWaterStats) disposeNativeWaterAnimationTextures(stagedWaterStats.animations);
    if (stagedRoot) disposeObject(stagedRoot);
    if (!isCurrentRequest()) return;
    setStatus('公開原生地圖載入失敗：' + error.message
      + '。公開素材服務可能暫時離線；可切回公開地圖預覽或改用本機 GLB/GAT。', true);
    console.error(error);
  } finally {
    if (nativeMapLoadAbortController === abortController) nativeMapLoadAbortController = null;
  }
}

async function loadMapFile(file) {
  const isCurrentRequest = beginLocalMapLoadRequest();
  setStatus('正在載入 ' + file.name + '…');
  let stagedRoot = null;
  try {
    const buffer = await file.arrayBuffer();
    if (!isCurrentRequest()) return;
    const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
    stagedRoot = gltf.scene;
    if (!isCurrentRequest()) {
      disposeObject(stagedRoot);
      stagedRoot = null;
      return;
    }
    stagedRoot.updateMatrixWorld(true);
    const stagedBounds = new THREE.Box3().setFromObject(stagedRoot);
    if (stagedBounds.isEmpty()) throw new Error('GLB 沒有可顯示的模型。');
    const size = stagedBounds.getSize(new THREE.Vector3());

    clearNativeWaterAnimation();
    if (mapRoot) {
      scene.remove(mapRoot);
      disposeObject(mapRoot);
    }
    mapRoot = stagedRoot;
    stagedRoot = null;
    activeRsmAnimations = [];
    scene.add(mapRoot);
    mapRoot.updateMatrixWorld(true);
    mapBounds = new THREE.Box3().setFromObject(mapRoot);
    mapInfo = { name: file.name, mapId: mapIdFromName(file.name), size, native: false };
    gndInfo = null;
    rswInfo = null;
    nativeRenderStats = null;
    resetRswLighting();
    fitCamera();
    finishOrRefreshScene();
    if (!gatInfo) setStatus('已載入 GLB。請再選取同一張地圖的 GAT 檔，才能啟用碰撞與尋路。');
  } catch (error) {
    if (stagedRoot) disposeObject(stagedRoot);
    if (!isCurrentRequest()) return;
    setStatus('GLB 載入失敗：' + error.message, true);
    console.error(error);
  }
}

async function loadGatFile(file) {
  const isCurrentRequest = beginLocalMapLoadRequest();
  setStatus('正在解析 ' + file.name + '…');
  try {
    const buffer = await file.arrayBuffer();
    if (!isCurrentRequest()) return;
    const parsedGat = parseGatBuffer(buffer, file.name);
    const nextScale = safeScale();
    if (!nextScale) throw new Error('世界比例必須大於 0，且不可大於 10。');
    if (mapRoot && mapInfo && mapInfo.mapId !== parsedGat.mapId) {
      gatInfo = parsedGat;
      worldScale = nextScale;
      removeGrid();
      removeRoute();
      playerSprite.visible = false;
      fallbackPlayer.visible = false;
      updateStats();
      setStatus('兩個檔案名稱不一致：地圖=' + mapInfo.mapId + '，GAT=' + gatInfo.mapId + '。請選同一張地圖。', true);
      return;
    }
    gatInfo = parsedGat;
    worldScale = nextScale;
    finishOrRefreshScene();
  } catch (error) {
    if (!isCurrentRequest()) return;
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
    if (mapInfo.native && !hit.object.userData.rooTerrainSurface) continue;
    if (!hit.face) continue;
    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (normal.y > 0.35) return hit;
  }
  return null;
}

function requestWalk(event) {
  if (!gatInfo || !mapRoot || !currentCell || mapInfo.mapId !== gatInfo.mapId) {
    setStatus('請先載入地圖與同名 GAT。', true);
    return;
  }
  const hit = groundHitFromEvent(event);
  if (!hit) {
    setStatus('沒有點到可辨識的地面；請點擊地圖地板，而不是天空或牆面。');
    return;
  }

  // 若途中改點，先把角色吸附到目前腳下的可走格，再重新尋路。
  if (movementPath) {
    const positionCell = roMapCellFromWorldPoint(
      gatInfo, playerRoot.position.x, playerRoot.position.z, worldScale
    );
    if (positionCell && isRoMapCellWalkable(gatInfo, positionCell.x, positionCell.y)) {
      currentCell = positionCell;
      updatePlayerPosition();
    }
    movementPath = null;
    pathIndex = 1;
    removeRoute();
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
    const destination = cellWorldPosition(nextCell);
    const distance = playerRoot.position.distanceTo(destination);
    if (distance <= budget || distance < 0.0001) {
      playerRoot.position.copy(destination);
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
      playerRoot.position.lerp(destination, budget / distance);
      budget = 0;
    }
  }
  if (fallbackPlayer.visible) {
    fallbackPlayer.position.set(
      playerRoot.position.x,
      playerRoot.position.y + tileSize() * 0.55,
      playerRoot.position.z
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
let pointerOrigin = null;
let pointerDragged = false;
renderer.domElement.addEventListener('pointerdown', event => {
  pointerOrigin = { x: event.clientX, y: event.clientY };
  pointerDragged = false;
});
renderer.domElement.addEventListener('pointermove', event => {
  if (!pointerOrigin) return;
  if (Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) > 6) {
    pointerDragged = true;
  }
});
renderer.domElement.addEventListener('pointercancel', () => {
  pointerOrigin = null;
  pointerDragged = false;
});
renderer.domElement.addEventListener('click', event => {
  const wasDrag = pointerDragged;
  pointerOrigin = null;
  pointerDragged = false;
  if (!wasDrag) requestWalk(event);
});

const stopRenderLoop = createVisibilityAwareFrameLoop(
  document,
  now => {
    const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
    lastFrame = now;
    advanceMovement(delta);
    advanceNativeWater(now);
    advanceRsmAnimations(now);
    controls.update();
    renderer.render(scene, camera);
  },
  callback => window.requestAnimationFrame(callback),
  frameId => window.cancelAnimationFrame(frameId)
);

function handleRenderPageHide(event) {
  // BFCache pages must keep their visibility listener so rendering resumes on pageshow.
  if (event.persisted) return;
  stopRenderLoop();
  window.removeEventListener('pagehide', handleRenderPageHide);
}
window.addEventListener('pagehide', handleRenderPageHide);

const params = new URLSearchParams(window.location.search);
const requestedMap = params.get('map');
if (requestedMap) {
  if (/^[a-z0-9_@-]{1,64}$/i.test(requestedMap)) {
    nativeMapInput.value = requestedMap.toLowerCase();
  }
  setStatus('目標地圖：' + requestedMap + '。可選「原生地圖」直接載入公開 GND/GAT，或使用本機 GLB/GAT。');
}
loadNativeMapButton.addEventListener('click', () => loadRagassetsMap(nativeMapInput.value));
window.addEventListener('roo-explorer-mode', event => {
  if (event.detail === 'native') loadRagassetsMap(nativeMapInput.value);
});

function measureSpriteAlphaBounds(image) {
  const width = image && (image.naturalWidth || image.width);
  const height = image && (image.naturalHeight || image.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('角色影格圖片尺寸無效。');
  }
  const whole = { left: 0, top: 0, right: width, bottom: height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return whole;
  let pixels;
  try {
    context.drawImage(image, 0, 0, width, height);
    pixels = context.getImageData(0, 0, width, height).data;
  } catch (error) {
    // Keep layout stable if a browser disallows pixel reads; never block exploration.
    return whole;
  }
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 16) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return whole;
  return { left, top, right: right + 1, bottom: bottom + 1 };
}

async function loadExplorerSpriteFrames() {
  // The current native scene uses the idle pose only; avoid downloading attack frames
  // until directional movement animation is implemented.
  const url = new URL(roExplorerSpriteFramePath(explorerSpriteKey, 0), import.meta.url).href;
  let texture;
  try {
    texture = await textureLoader.loadAsync(url);
  } catch (error) {
    return false;
  }

  const image = texture.image;
  const width = image && (image.naturalWidth || image.width);
  const height = image && (image.naturalHeight || image.height);
  const bounds = measureSpriteAlphaBounds(image);
  const layout = buildRoExplorerSpriteLayout(width, height, bounds, tileSize());
  texture.colorSpace = THREE.SRGBColorSpace;
  playerSpriteFrames = [texture];
  playerSpriteFrameMetrics = { width, height, bounds };
  playerSpriteFrameLayout = layout;

  const previousTexture = playerMaterial.map;
  playerMaterial.map = texture;
  playerMaterial.needsUpdate = true;
  if (previousTexture && previousTexture !== texture) previousTexture.dispose();
  fallbackPlayer.visible = false;
  if (currentCell) {
    playerSprite.visible = true;
    updatePlayerPosition();
  }
  updateStats();
  return true;
}

try {
  textureLoader.load('../images/player_swordsman.svg', texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    if (playerSpriteFrames.length) {
      texture.dispose();
      return;
    }
    playerMaterial.map = texture;
    playerMaterial.needsUpdate = true;
    fallbackPlayer.visible = false;
    if (currentCell) {
      playerSprite.visible = true;
      updatePlayerPosition();
    }
  }, undefined, () => {
    if (playerSpriteFrames.length) return;
    playerSprite.visible = false;
    fallbackPlayer.visible = !!currentCell;
  });
} catch (error) {
  playerSprite.visible = false;
}
loadExplorerSpriteFrames().catch(error => {
  console.warn('ROO 角色影格載入失敗，保留備援外觀：', error);
});
