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
  compareGndGatHeights,
  insetGndTextureUvs,
  normalizeModelName,
  normalizeTextureName,
  parseGndBuffer,
  parseRsmBuffer,
  parseRswBuffer,
  resolveRagassetsMapUrls,
  sampleGndHeightAtGatCell,
  sampleRsmAnimationPose,
  sampleRoWaterWaveOffset,
} from './ro_map_assets.mjs';

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

let mapRoot = null;
let mapInfo = null;
let mapBounds = null;
let gatInfo = null;
let gndInfo = null;
let rswInfo = null;
let nativeRenderStats = null;
let nativeWaterAnimation = null;
let activeRsmAnimations = [];
let gridMesh = null;
const modelTextureCache = new Map();
const MAX_NATIVE_MODEL_ASSETS = 100;
const MAX_NATIVE_MODEL_PLACEMENTS = 450;
let gridGeometry = null;
let gridMaterial = null;
let routeLine = null;
let targetRing = null;
let playerSprite = null;
let fallbackPlayer = null;
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
      + (nativeRenderStats.waterFrameCount || 0));
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

function clearNativeWaterAnimation() {
  if (!nativeWaterAnimation) return;
  const activeTexture = nativeWaterAnimation.mesh && nativeWaterAnimation.mesh.material
    ? nativeWaterAnimation.mesh.material.map : null;
  for (const texture of nativeWaterAnimation.textures) {
    if (texture && texture !== activeTexture) texture.dispose();
  }
  nativeWaterAnimation = null;
}

function advanceNativeWater(now) {
  const animation = nativeWaterAnimation;
  if (!animation) return;

  if (animation.waveEnabled && animation.basePositions && animation.tileCoordinates) {
    if (animation.waveStartedAt === null) animation.waveStartedAt = now;
    const elapsedSeconds = Math.max(0, (now - animation.waveStartedAt) / 1000);
    const positionAttribute = animation.mesh.geometry.getAttribute('position');
    const positions = positionAttribute.array;
    const diagonalCount = animation.mapWidth + animation.mapHeight + 1;
    const waveOffsets = new Float32Array(diagonalCount);

    // Wave crests travel along the map's (1, 1) diagonal. Reuse the sample for
    // each diagonal so neighbouring water tiles share exactly the same heights.
    for (let diagonal = 0; diagonal < diagonalCount; diagonal++) {
      waveOffsets[diagonal] = sampleRoWaterWaveOffset(
        animation.waterConfig, diagonal, 0, elapsedSeconds, animation.worldScale
      );
    }
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
  if (animation.textures.length < 2) return;
  if (!animation.nextFrameAt) {
    animation.nextFrameAt = now + animation.intervalMs;
    return;
  }
  if (now < animation.nextFrameAt) return;
  const steps = Math.floor((now - animation.nextFrameAt) / animation.intervalMs) + 1;
  animation.frameIndex = (animation.frameIndex + steps) % animation.textures.length;
  animation.mesh.material.map = animation.textures[animation.frameIndex];
  animation.mesh.material.needsUpdate = true;
  animation.nextFrameAt += steps * animation.intervalMs;
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

function loadModelTexture(url) {
  if (!url) return null;
  if (modelTextureCache.has(url)) return modelTextureCache.get(url);
  const texture = textureLoader.load(url, loadedTexture => {
    loadedTexture.colorSpace = THREE.SRGBColorSpace;
    loadedTexture.wrapS = THREE.RepeatWrapping;
    loadedTexture.wrapT = THREE.RepeatWrapping;
    loadedTexture.needsUpdate = true;
  }, undefined, () => {
    modelTextureCache.delete(url);
  });
  modelTextureCache.set(url, texture);
  return texture;
}

function rsmTextureNames(rsm, node) {
  if (rsm.major === 2 && rsm.minor >= 3) return node.textureNames;
  return node.textureIndices.map(index => rsm.textures[index] || '');
}

function buildRsmTemplate(rsm, urls, scale) {
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
      const texture = loadModelTexture(textureUrl);
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
  const center = bounds.getCenter(new THREE.Vector3());
  const rootShift = new THREE.Vector3(-center.x, -bounds.max.y, -center.z);
  for (let index = 0; index < rsm.nodes.length; index++) {
    if (!parented.has(index)) nodeGroups[index].position.add(rootShift);
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
  let lastKeyframe = 0;
  modelRoot.traverse(object => {
    const data = object.userData && object.userData.rooRsmAnimation;
    if (!data) return;
    const hasKeys = data.rotationKeyframes.length || data.scaleKeyframes.length
      || data.translationKeyframes.length;
    if (!hasKeys) return;
    tracks.push({ object, data });
    for (const keys of [data.rotationKeyframes, data.scaleKeyframes, data.translationKeyframes]) {
      for (const key of keys) lastKeyframe = Math.max(lastKeyframe, key.frame);
    }
  });
  if (!tracks.length) return null;

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

async function loadAndPlaceRswModels(rsw, urls, mapRoot, scale) {
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
        const response = await fetch(assetUrl, { mode: 'cors', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('RSM HTTP ' + response.status);
        const rsm = parseRsmBuffer(await response.arrayBuffer());
        const template = buildRsmTemplate(rsm, urls, scale);
        return { assetUrl, template, supported: !!template };
      } catch (error) {
        console.warn('ROO RSM 載入失敗：' + assetUrl, error);
        return { assetUrl, template: null, supported: false };
      }
    }));
    for (const item of loaded) {
      if (item.template) templates.set(item.assetUrl, item.template);
      else failedOrUnsupported++;
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
  if (!waterConfig || !Number.isFinite(waterConfig.level)) {
    return { animation: null, waterTileCount: 0, waterFrameCount: 0 };
  }
  const data = buildGndWaterMeshData(gat, waterConfig.level, scale);
  if (!data.waterTileCount) {
    return { animation: null, waterTileCount: 0, waterFrameCount: 0 };
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  geometry.setIndex(data.indices);
  geometry.computeVertexNormals();

  const frameUrls = Array.isArray(urls.waterFrames) ? urls.waterFrames.slice(0, 32) : [];
  const textures = await Promise.all(frameUrls.map(async url => {
    try {
      const texture = await textureLoader.loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      return texture;
    } catch (error) {
      console.warn('ROO 水面影格載入失敗：' + url, error);
      return null;
    }
  }));
  const availableTextures = textures.filter(Boolean);
  const material = new THREE.MeshBasicMaterial({
    map: availableTextures[0] || null,
    color: availableTextures.length ? 0xffffff : 0x63b5d8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'roo-native-water';
  mesh.renderOrder = 2;
  mesh.userData.rooMapWater = true;
  root.add(mesh);

  const interval = Number(waterConfig.textureCyclingInterval);
  const waveEnabled = Number.isFinite(waterConfig.waveHeight) && Math.abs(waterConfig.waveHeight) > 1e-8;
  const textureCyclingEnabled = availableTextures.length > 1;
  return {
    animation: waveEnabled || textureCyclingEnabled ? {
      mesh,
      textures: availableTextures,
      frameIndex: 0,
      nextFrameAt: 0,
      intervalMs: Math.max(50, Math.min(4000, (Number.isFinite(interval) && interval > 0 ? interval : 3) * (1000 / 30))),
      waveEnabled,
      waterConfig,
      worldScale: scale,
      mapWidth: gat.width,
      mapHeight: gat.height,
      tileCoordinates: Uint32Array.from(data.tileCoordinates),
      basePositions: Float32Array.from(data.positions),
      waveStartedAt: null,
    } : null,
    waterTileCount: data.waterTileCount,
    waterFrameCount: availableTextures.length,
  };
}

async function loadRagassetsMap(mapName) {
  const mapId = String(mapName || '').trim().toLowerCase();
  if (!/^[a-z0-9_@-]{1,64}$/.test(mapId)) {
    setStatus('地圖 ID 格式無效。', true);
    return;
  }

  setStatus('正在從公開素材來源載入 ' + mapId + ' 的 GND／GAT／RSW…');
  try {
    const manifestUrl = new URL('/maps/' + mapId + '/manifest.json', RAGASSETS_BASE_URL);
    const manifestResponse = await fetch(manifestUrl.href, { mode: 'cors' });
    if (!manifestResponse.ok) throw new Error('manifest HTTP ' + manifestResponse.status);
    const manifest = await manifestResponse.json();
    const urls = resolveRagassetsMapUrls(mapId, manifest);
    const responses = await Promise.all([
      fetch(urls.gnd, { mode: 'cors' }),
      fetch(urls.gat, { mode: 'cors' }),
      fetch(urls.rsw, { mode: 'cors' }),
    ]);
    const labels = ['GND 地表', 'GAT 通行格', 'RSW 場景設定'];
    for (let i = 0; i < responses.length; i++) {
      if (!responses[i].ok) throw new Error(labels[i] + ' HTTP ' + responses[i].status);
    }
    const buffers = await Promise.all(responses.map(response => response.arrayBuffer()));
    const parsedGnd = parseGndBuffer(buffers[0]);
    const parsedGat = parseGatBuffer(buffers[1], mapId + '.gat');
    const parsedRsw = parseRswBuffer(buffers[2]);
    if (parsedGat.width !== parsedGnd.width * 2 || parsedGat.height !== parsedGnd.height * 2) {
      throw new Error('GND／GAT 尺寸不相符：GND=' + parsedGnd.width + '×' + parsedGnd.height
        + '，GAT=' + parsedGat.width + '×' + parsedGat.height + '。');
    }

    const nextScale = safeScale();
    if (!nextScale) throw new Error('世界比例必須大於 0，且不可大於 10。');
    worldScale = nextScale;
    const lightmapAtlas = buildGndLightmapAtlasData(parsedGnd);
    const meshData = buildGndMeshData(parsedGnd, worldScale, lightmapAtlas);
    const lightmapTexture = lightmapAtlas
      ? createLightmapDataTexture(lightmapAtlas.lightMapPixels, lightmapAtlas.width, lightmapAtlas.height)
      : null;
    const aoTexture = lightmapAtlas
      ? createLightmapDataTexture(lightmapAtlas.aoMapPixels, lightmapAtlas.width, lightmapAtlas.height)
      : null;
    const nextRoot = new THREE.Group();
    nextRoot.name = 'roo-native-map-' + mapId;

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
      nextRoot.add(mesh);
    }

    setStatus('地表已建立，正在載入 RSW 模型資源…');
    modelTextureCache.clear();
    const nextRenderStats = await loadAndPlaceRswModels(parsedRsw, urls, nextRoot, worldScale);
    const { animations: nextRsmAnimations, ...modelRenderStats } = nextRenderStats;
    const waterConfig = parsedGnd.water || parsedRsw.water;
    setStatus('模型已載入，正在建立水域…');
    const nextWaterStats = await addNativeWater(nextRoot, parsedGat, waterConfig, urls, worldScale);

    const bounds = new THREE.Box3().setFromObject(nextRoot);
    if (bounds.isEmpty()) throw new Error('GND 沒有可顯示的地表；無法建立原生地圖。');
    clearNativeWaterAnimation();
    if (mapRoot) {
      scene.remove(mapRoot);
      disposeObject(mapRoot);
    }
    nativeWaterAnimation = nextWaterStats.animation;
    mapRoot = nextRoot;
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
      lightmapSlices: parsedGnd.lightmapCount,
      lightmapLayout: parsedGnd.lightmapLayout,
      lightmapAtlas: !!lightmapAtlas,
      heightAlignment: compareGndGatHeights(parsedGnd, parsedGat, worldScale),
      placementBounds: analyzeRswPlacementBounds(parsedGnd, parsedRsw, worldScale),
    };
    applyRswLighting(parsedRsw, mapInfo.size);
    fitCamera();
    finishOrRefreshScene();
    setStatus('原生地圖已載入：地表＋RSM 模型 ' + modelRenderStats.renderedPlacements
      + ' 個／' + parsedRsw.models.length + ' 個擺放位置；水域 ' + nextWaterStats.waterTileCount
      + ' 格、動畫影格 ' + nextWaterStats.waterFrameCount + ' 張。GND lightmap/AO 與頂點水波已啟用，實際畫面仍待校驗。');
    updateStats();
  } catch (error) {
    setStatus('公開原生地圖載入失敗：' + error.message
      + '。公開素材服務可能暫時離線；可切回公開地圖預覽或改用本機 GLB/GAT。', true);
    console.error(error);
  }
}

async function loadMapFile(file) {
  setStatus('正在載入 ' + file.name + '…');
  try {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
    clearNativeWaterAnimation();
    if (mapRoot) {
      scene.remove(mapRoot);
      disposeObject(mapRoot);
    }
    mapRoot = gltf.scene;
    activeRsmAnimations = [];
    scene.add(mapRoot);
    mapRoot.updateMatrixWorld(true);
    mapBounds = new THREE.Box3().setFromObject(mapRoot);
    if (mapBounds.isEmpty()) throw new Error('GLB 沒有可顯示的模型。');

    const size = mapBounds.getSize(new THREE.Vector3());
    mapInfo = { name: file.name, mapId: mapIdFromName(file.name), size, native: false };
    gndInfo = null;
    rswInfo = null;
    nativeRenderStats = null;
    resetRswLighting();
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
      setStatus('兩個檔案名稱不一致：地圖=' + mapInfo.mapId + '，GAT=' + gatInfo.mapId + '。請選同一張地圖。', true);
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
      gatInfo, playerSprite.position.x, playerSprite.position.z, worldScale
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

function animate(now) {
  requestAnimationFrame(animate);
  const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
  lastFrame = now;
  advanceMovement(delta);
  advanceNativeWater(now);
  advanceRsmAnimations(now);
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

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
