import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  RAGASSETS_BASE_URL,
  buildGndLightmapAtlasData,
  computeGndLightDirection,
  computeGndLightMultiplier,
  transformGndNormalToRoSpace,
  buildGndMeshData,
  GND_PREVIEW_AO_STRENGTH,
  analyzeRswPlacementBounds,
  buildRsmNodeTransformData,
  buildRsm2NodeTransformData,
  buildRsmNodeMeshData,
  buildRsm2NodeMeshData,
  transformRsmVertex,
  buildGndWaterMeshData,
  buildGndWaterMeshDataByPlane,
  compareGndGatHeights,
  mapGndDiffuseUvToSourcePixel,
  resolveGndDiffuseCropRect,
  normalizeModelName,
  normalizeTextureName,
  parseGndBuffer,
  parseRsmBuffer,
  parseRswBuffer,
  resolveRagassetsMapUrls,
  resolveMapTextureUrl,
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
import { buildRoExplorerCombatFeedback } from './ro_explorer_feedback.mjs';
import {
  buildRoExplorerSpriteLayout,
  resolveRoExplorerSpriteKey,
  roExplorerSpriteFramePath,
  roExplorerAnimationUrl,
  roExplorerDirectionFromDelta,
} from './ro_explorer_sprites.mjs';
import {
  buildRoExplorerMinimapPixels,
  getRoExplorerMinimapSize,
  mapRoExplorerCellToMinimap,
  mapRoExplorerMinimapPointToCell,
} from './ro_explorer_minimap.mjs';
import {
  buildRoExplorerMonsterSpawns,
  parseRoExplorerMonsterCatalog,
  roExplorerMonsterAnimationUrl,
} from './ro_explorer_monsters.mjs';
import {
  findRoExplorerMonsterRespawnCell,
  reviveRoExplorerMonster,
  scheduleRoExplorerMonsterRespawn,
} from './ro_explorer_lifecycle.mjs';
import {
  formatRoExplorerGaugeValue,
  formatRoExplorerLevelProgress,
  formatRoExplorerZeny,
  getRoExplorerGaugePercent,
} from './ro_explorer_hud.mjs';
import {
  buildRoExplorerCameraSnapshot,
  resolveRoExplorerCameraSnapshot,
} from './ro_explorer_camera.mjs';
import { getRoExplorerCameraFollowDelta } from './ro_explorer_camera_follow.mjs';
import {
  projectRoExplorer2DPoint,
  unprojectRoExplorer2DPoint,
  drawRoExplorer2DTexturedTriangle,
  getRoExplorer2DViewportRadius,
  isRoExplorer2DPointVisible,
  drawRoExplorer2DGroundShadow,
  drawRoExplorer2DSelectionRing,
} from './ro_explorer_2d.mjs';

const stage = document.getElementById('stage');
const ro2dCanvas = document.getElementById('ro-2d-stage');
const toggle2DViewButton = document.getElementById('toggle-2d-view');
const ro2dContext = ro2dCanvas ? ro2dCanvas.getContext('2d', { alpha: false }) : null;
const ro2dTerrainCanvas = document.createElement('canvas');
const ro2dTerrainContext = ro2dTerrainCanvas.getContext('2d', { alpha: false });
const status = document.getElementById('status');
const stats = document.getElementById('stats');
const combatFeedbackLayer = document.getElementById('combat-feedback-layer');
const modelInput = document.getElementById('model-file');
const gatInput = document.getElementById('gat-file');
const scaleInput = document.getElementById('world-scale');
const speedInput = document.getElementById('move-speed');
const speedValue = document.getElementById('speed-value');
const showCellsInput = document.getElementById('show-cells');
const showMinimapInput = document.getElementById('show-minimap');
const minimapPanel = document.getElementById('minimap-panel');
const minimapCanvas = document.getElementById('minimap');
const minimapMapName = document.getElementById('minimap-map-name');
const monsterPanel = document.getElementById('monster-panel');
const monsterTitle = document.getElementById('monster-title');
const monsterDescription = document.getElementById('monster-description');
const monsterHpGauge = document.getElementById('monster-hp-gauge');
const monsterHpBar = document.getElementById('monster-hp-bar');
const monsterHpValue = document.getElementById('monster-hp-value');
const playerVitalsPanel = document.getElementById('player-vitals-panel');
const playerHpGauge = document.getElementById('player-hp-gauge');
const playerHpBar = document.getElementById('player-hp-bar');
const playerHpValue = document.getElementById('player-hp-value');
const playerSpGauge = document.getElementById('player-sp-gauge');
const playerSpBar = document.getElementById('player-sp-bar');
const playerSpValue = document.getElementById('player-sp-value');
const playerBaseLevelLabel = document.getElementById('player-base-level');
const playerBaseExpGauge = document.getElementById('player-base-exp-gauge');
const playerBaseExpBar = document.getElementById('player-base-exp-bar');
const playerBaseExpValue = document.getElementById('player-base-exp-value');
const playerJobLevelLabel = document.getElementById('player-job-level');
const playerJobExpGauge = document.getElementById('player-job-exp-gauge');
const playerJobExpBar = document.getElementById('player-job-exp-bar');
const playerJobExpValue = document.getElementById('player-job-exp-value');
const playerZenyValue = document.getElementById('player-zeny-value');
const clearMonsterTargetButton = document.getElementById('clear-monster-target');
const attackMonsterButton = document.getElementById('attack-monster');
const stopMonsterAttackButton = document.getElementById('stop-monster-attack');
const stopMovementButton = document.getElementById('stop-movement');
const followPlayerInput = document.getElementById('follow-player');
const monsterSkillInput = document.getElementById('monster-skill');
const castMonsterSkillButton = document.getElementById('cast-monster-skill');
const supportSkillInput = document.getElementById('support-skill');
const castSupportSkillButton = document.getElementById('cast-support-skill');
const RO_EXPLORER_COMBAT_COMMAND_KEY = 'roo_explorer_combat_command';
const combatSessionId = 'ex-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const combatResultKey = 'roo_explorer_combat_result_' + combatSessionId;
let activeCombatTarget = null;
let pendingCombatRequest = null;
let combatRequestCounter = 0;
let pendingStatusTickId = null;
let pendingVitalsRequestId = null;
let nextVitalsRequestAt = 0;
let vitalsPollTimer = null;
let explorerPageActive = true;
let activeExplorerMode = 'public';
let statusTickCursor = 0;
const timedStatusEntries = new Set();
const combatFeedbackEntries = new Set();
let nextCombatAt = 0;
let combatAttackIntervalMs = 1000;
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
const gndDiffuseSourceTexturePromises = new Map();

function loadGndDiffuseSourceTexture(url) {
  if (!gndDiffuseSourceTexturePromises.has(url)) {
    const promise = textureLoader.loadAsync(url).then(texture => {
      // Match GRFEditor's GndTexture sampler: linear filtering with ClampToEdge on both axes.
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      return texture;
    }).catch(error => {
      gndDiffuseSourceTexturePromises.delete(url);
      throw error;
    });
    gndDiffuseSourceTexturePromises.set(url, promise);
  }
  return gndDiffuseSourceTexturePromises.get(url);
}
const explorerParams = new URLSearchParams(window.location.search);
activeExplorerMode = explorerParams.get('mode') === 'native'
  ? 'native' : (explorerParams.get('mode') === 'local' ? 'local' : 'public');
function readVitalsParam(key) {
  const raw = explorerParams.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
const playerVitals = {
  hp: readVitalsParam('php'),
  maxHp: readVitalsParam('pmaxhp'),
  sp: readVitalsParam('psp'),
  maxSp: readVitalsParam('pmaxsp'),
};
const playerProgress = {
  baseLevel: readVitalsParam('pbaselevel'),
  baseExp: readVitalsParam('pbaseexp'),
  baseExpNeed: readVitalsParam('pbaseexpneed'),
  jobLevel: readVitalsParam('pjoblevel'),
  jobExp: readVitalsParam('pjobexp'),
  jobExpNeed: readVitalsParam('pjobexpneed'),
  zeny: readVitalsParam('pzeny'),
};
function updateRoExplorerGauge(gauge, fill, valueLabel, current, maximum) {
  const percent = getRoExplorerGaugePercent(current, maximum);
  const valueText = formatRoExplorerGaugeValue(current, maximum);
  if (valueLabel) valueLabel.textContent = valueText;
  if (fill) {
    fill.style.width = percent + '%';
    fill.classList.toggle('is-low', valueText !== '— / —' && percent <= 25);
  }
  if (gauge) {
    gauge.setAttribute('aria-valuenow', String(percent));
    gauge.setAttribute('aria-valuetext', valueText === '— / —' ? '無資料' : valueText);
  }
}
function renderPlayerVitals() {
  updateRoExplorerGauge(playerHpGauge, playerHpBar, playerHpValue, playerVitals.hp, playerVitals.maxHp);
  updateRoExplorerGauge(playerSpGauge, playerSpBar, playerSpValue, playerVitals.sp, playerVitals.maxSp);
}
function renderPlayerProgressGauge(gauge, fill, levelLabel, valueLabel, label, level, current, needed) {
  const view = formatRoExplorerLevelProgress(label, level, current, needed);
  if (levelLabel) levelLabel.textContent = view.levelLabel;
  if (valueLabel) valueLabel.textContent = view.valueLabel;
  if (fill) {
    fill.style.width = view.percent + '%';
    fill.classList.toggle('is-low', !view.maxed && view.valueLabel !== '— / —' && view.percent <= 25);
  }
  if (gauge) {
    gauge.setAttribute('aria-valuenow', String(view.percent));
    gauge.setAttribute('aria-valuetext', view.valueLabel === '— / —' ? '無資料' : view.valueLabel);
  }
}
function renderPlayerProgress() {
  renderPlayerProgressGauge(playerBaseExpGauge, playerBaseExpBar, playerBaseLevelLabel,
    playerBaseExpValue, '基礎', playerProgress.baseLevel, playerProgress.baseExp, playerProgress.baseExpNeed);
  renderPlayerProgressGauge(playerJobExpGauge, playerJobExpBar, playerJobLevelLabel,
    playerJobExpValue, '職業', playerProgress.jobLevel, playerProgress.jobExp, playerProgress.jobExpNeed);
  if (playerZenyValue) playerZenyValue.textContent = formatRoExplorerZeny(playerProgress.zeny);
}
function updatePlayerProgress(values) {
  if (!values || typeof values !== 'object') return;
  const fields = [
    ['baseLevel', 'playerBaseLevel'], ['baseExp', 'playerBaseExp'], ['baseExpNeed', 'playerBaseExpNeed'],
    ['jobLevel', 'playerJobLevel'], ['jobExp', 'playerJobExp'], ['jobExpNeed', 'playerJobExpNeed'],
    ['zeny', 'playerZeny'],
  ];
  for (const [localKey, resultKey] of fields) {
    const raw = values[resultKey];
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) playerProgress[localKey] = value;
  }
  renderPlayerProgress();
}
function updatePlayerVitals(values, options = {}) {
  if (!values || typeof values !== 'object') return;
  const previousHp = playerVitals.hp;
  const previousHpValue = Number(previousHp);
  const hadPreviousHp = previousHp !== null && previousHp !== undefined && previousHp !== ''
    && Number.isFinite(previousHpValue);
  for (const key of ['hp', 'maxHp', 'sp', 'maxSp']) {
    if (values[key] === null || values[key] === undefined || values[key] === '') continue;
    const value = Number(values[key]);
    if (Number.isFinite(value)) playerVitals[key] = value;
  }
  const currentHp = Number(playerVitals.hp);
  if (options.showDamage && hadPreviousHp && Number.isFinite(currentHp) && currentHp < previousHpValue) {
    showRoExplorerPlayerDamageFeedback(previousHpValue - currentHp);
  }
  renderPlayerVitals();
}
function refreshVitalsPolling() {
  const shouldPoll = activeExplorerMode === 'native' && playerVitalsPanel
    && !playerVitalsPanel.hidden && !document.hidden && explorerPageActive;
  if (shouldPoll) {
    requestRoExplorerVitals();
    if (vitalsPollTimer === null) vitalsPollTimer = window.setInterval(requestRoExplorerVitals, 1000);
    return;
  }
  if (vitalsPollTimer !== null) window.clearInterval(vitalsPollTimer);
  vitalsPollTimer = null;
  pendingVitalsRequestId = null;
  nextVitalsRequestAt = 0;
}
function setVitalsPollingMode(mode) {
  activeExplorerMode = mode === 'native' ? 'native' : (mode === 'local' ? 'local' : 'public');
  if (playerVitalsPanel) playerVitalsPanel.hidden = activeExplorerMode !== 'native';
  refreshVitalsPolling();
}
window.addEventListener('roo-explorer-mode', event => setVitalsPollingMode(event.detail));
document.addEventListener('visibilitychange', refreshVitalsPolling);
renderPlayerVitals();
renderPlayerProgress();
const explorerSpriteKey = resolveRoExplorerSpriteKey(explorerParams.get('sprite'));
const monsterMapIdFromUrl = String(explorerParams.get('map') || '').trim().toLowerCase();
const explorerMonsterCatalog = parseRoExplorerMonsterCatalog(explorerParams.get('mobs'));
/* 只列出已接通的攻擊技能與安全的自身增益；其餘持續／指定目標效果待整合。 */
const RO_EXPLORER_SELF_BUFF_TYPES = new Set([
  'buff_atk', 'buff_auraflat', 'buff_matk', 'buff_aspd', 'buff_sight', 'buff_assumptio', 'buff_basilica', 'buff_meltdown', 'buff_windwalk',
]);
const RO_EXPLORER_SUPPORT_SKILL_TYPES = new Set([
  'heal', 'heal_over_time', 'field_heal', 'cure', 'buff_sprate', 'buff_def', 'buff_block',
  'buff_reflect', 'buff_providence', 'buff_atk', 'buff_auraflat', 'buff_matk', 'buff_aspd',
  'buff_sight', 'buff_assumptio', 'buff_basilica', 'buff_meltdown', 'buff_windwalk',
  'buff_blessing', 'buff_angelus', 'buff_shield', 'buff_lukflat',
  'buff_holyweapon', 'buff_elearmor', 'buff_ailimmune',
]);
const RO_EXPLORER_SUPPORTED_SKILL_TYPES = new Set([
  'damage', 'magic', 'magic_aoe', 'damage_aoe', 'damage_multihit', 'damage_multi', 'poison_proc',
  'buff_atk', 'buff_auraflat', 'buff_matk', 'buff_aspd', 'buff_sight', 'buff_assumptio', 'buff_basilica', 'buff_meltdown', 'buff_windwalk',
]);
function parseRoExplorerSkillCatalog(raw) {
  try {
    const value = JSON.parse(String(raw || ''));
    if (!Array.isArray(value)) return [];
    return value.slice(0, 80).filter(skill => skill
      && typeof skill.id === 'string' && /^[a-z0-9_]{1,48}$/i.test(skill.id)
      && typeof skill.name === 'string' && skill.name.length > 0 && skill.name.length <= 80
      && Number.isInteger(skill.level) && skill.level >= 1 && skill.level <= 200
      && (RO_EXPLORER_SUPPORTED_SKILL_TYPES.has(skill.type)
        || RO_EXPLORER_SUPPORT_SKILL_TYPES.has(skill.type)))
      .map(skill => ({
        id: skill.id, name: skill.name, level: skill.level,
        spCost: Number.isFinite(Number(skill.spCost)) ? Math.max(0, Math.floor(Number(skill.spCost))) : 0,
        type: skill.type, isSelfBuff: RO_EXPLORER_SELF_BUFF_TYPES.has(skill.type),
        isSupport: RO_EXPLORER_SUPPORT_SKILL_TYPES.has(skill.type)
      }));
  } catch (error) {
    return [];
  }
}
const explorerSkillCatalog = parseRoExplorerSkillCatalog(explorerParams.get('skills'));

let mapRoot = null;
let mapInfo = null;
let mapBounds = null;
let gatInfo = null;
let gndInfo = null;
let rswInfo = null;
let nativeRenderStats = null;
let terrainTextureDiagnostics = null;
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
let localIdleTexture = null;
let localIdleMetrics = null;
let placeholderSpriteTexture = null;
const playerMotionTextureCache = new Map();
const playerMotionTextureEntries = new Map();
let desiredPlayerMotionKey = '';
let activePlayerMotionKey = '';
let activePlayerMotionTexture = null;
let currentMotionType = 'idle';
let currentFacing = 0;
let lastMotionTextureUploadAt = 0;
const playerRoot = new THREE.Group();
let currentCell = null;
let movementPath = null;
let pathIndex = 1;
let lastFrame = 0;
let worldScale = 0.2;
let ro2dActive = false;
let ro2dSourceImages = new Map();
let ro2dDecorations = [];
let ro2dCameraCenter = null;
let ro2dFrameCenter = null;
let ro2dTerrainCenter = null;
let ro2dTerrainDirty = true;
let ro2dLastTerrainRenderAt = 0;
let ro2dViewportWidth = 1;
let ro2dViewportHeight = 1;
let ro2dPixelRatio = 1;
let ro2dMetrics = { terrainTiles: 0, texturedTiles: 0, visibleProps: 0, visibleMonsters: 0 };
const RO_EXPLORER_2D_PIXELS_PER_WORLD_UNIT = 1.6;
let minimapGatInfo = null;
let minimapBaseImage = null;
let minimapBaseWidth = 0;
let minimapBaseHeight = 0;
const monsterSpritesRoot = new THREE.Group();
scene.add(monsterSpritesRoot);
const monsterTextureCache = new Map();
const monsterTextureSet = new Set();
const monsterEntries = [];
let monsterGeneration = 0;
let selectedMonsterEntry = null;
let queuedCombatSkill = null;
let lastMonsterTextureUploadAt = 0;

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
const selectedMonsterMaterial = new THREE.MeshBasicMaterial({ color: '#ff967a', side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
const selectedMonsterRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.48, 28), selectedMonsterMaterial);
selectedMonsterRing.rotation.x = -Math.PI / 2;
selectedMonsterRing.visible = false;
scene.add(selectedMonsterRing);

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function updateRoExplorerMovementControls() {
  if (!stopMovementButton) return;
  const canStop = !!movementPath && movementPath.length > 1 && !!gatInfo && !!mapRoot
    && !!mapInfo && mapInfo.mapId === gatInfo.mapId;
  stopMovementButton.hidden = !canStop;
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
  updateRoExplorerMovementControls();
  updateMinimap();
}

function updateMinimap() {
  if (!minimapPanel || !minimapCanvas || !showMinimapInput) return;
  const visible = showMinimapInput.checked && !!currentCell && !!gatInfo && !!mapRoot
    && !!mapInfo && mapInfo.mapId === gatInfo.mapId;
  minimapPanel.hidden = !visible;
  if (!visible) return;

  const size = getRoExplorerMinimapSize(gatInfo.width, gatInfo.height);
  if (minimapGatInfo !== gatInfo || minimapBaseWidth !== size.width
    || minimapBaseHeight !== size.height || !minimapBaseImage) {
    minimapCanvas.width = size.width;
    minimapCanvas.height = size.height;
    const context = minimapCanvas.getContext('2d');
    if (!context) return;
    const pixels = buildRoExplorerMinimapPixels(gatInfo, size.width, size.height);
    minimapBaseImage = context.createImageData(size.width, size.height);
    minimapBaseImage.data.set(pixels);
    minimapGatInfo = gatInfo;
    minimapBaseWidth = size.width;
    minimapBaseHeight = size.height;
  }

  const context = minimapCanvas.getContext('2d');
  if (!context || !minimapBaseImage) return;
  context.putImageData(minimapBaseImage, 0, 0);
  context.imageSmoothingEnabled = false;

  for (const entry of monsterEntries) {
    if (entry.dead) continue;
    const marker = mapRoExplorerCellToMinimap(entry.cell, gatInfo.width, gatInfo.height, size.width, size.height);
    if (!marker) continue;
    context.beginPath();
    context.arc(marker.x, marker.y, entry === selectedMonsterEntry ? 3.4 : 2.2, 0, Math.PI * 2);
    context.fillStyle = entry === selectedMonsterEntry ? '#ff967a' : '#e06f83';
    context.fill();
  }

  if (movementPath && movementPath.length > 1) {
    const points = movementPath.slice(Math.max(0, pathIndex - 1))
      .map(cell => mapRoExplorerCellToMinimap(
        cell, gatInfo.width, gatInfo.height, size.width, size.height
      ))
      .filter(Boolean);
    if (points.length > 1) {
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
      context.strokeStyle = '#ffe18a';
      context.lineWidth = Math.max(1.5, Math.min(size.width, size.height) / 140);
      context.lineJoin = 'round';
      context.lineCap = 'round';
      context.stroke();
    }
    const target = mapRoExplorerCellToMinimap(
      movementPath[movementPath.length - 1],
      gatInfo.width, gatInfo.height, size.width, size.height
    );
    if (target) {
      context.beginPath();
      context.arc(target.x, target.y, 3.2, 0, Math.PI * 2);
      context.strokeStyle = '#fff0a5';
      context.lineWidth = 1.4;
      context.stroke();
    }
  }

  const player = mapRoExplorerCellToMinimap(
    currentCell, gatInfo.width, gatInfo.height, size.width, size.height
  );
  if (player) {
    context.beginPath();
    context.arc(player.x, player.y, 3.3, 0, Math.PI * 2);
    context.fillStyle = '#07111d';
    context.fill();
    context.beginPath();
    context.arc(player.x, player.y, 1.8, 0, Math.PI * 2);
    context.fillStyle = '#69edb3';
    context.fill();
  }
  if (minimapMapName) minimapMapName.textContent = gatInfo.mapId;
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

function ro2dPixelsPerWorldUnit() {
  return RO_EXPLORER_2D_PIXELS_PER_WORLD_UNIT / Math.max(worldScale, 0.01);
}

function ro2dWorldPointFromGndCorner(x, z, heightValue) {
  return {
    x: (x * 10 - gndInfo.width * 5) * worldScale,
    y: heightValue === 0 ? 0 : -heightValue * worldScale,
    z: -(z * 10 - gndInfo.height * 5) * worldScale,
  };
}

function ro2dGndTileWorldCorners(x, z, cube) {
  return [
    ro2dWorldPointFromGndCorner(x, z, cube.hSW),
    ro2dWorldPointFromGndCorner(x + 1, z, cube.hSE),
    ro2dWorldPointFromGndCorner(x, z + 1, cube.hNW),
    ro2dWorldPointFromGndCorner(x + 1, z + 1, cube.hNE),
  ];
}

function ro2dProject(point, center = ro2dFrameCenter) {
  return projectRoExplorer2DPoint(point, center, ro2dViewportWidth, ro2dViewportHeight,
    ro2dPixelsPerWorldUnit());
}

function ro2dRefreshSourceImages() {
  if (!mapRoot) return;
  const next = new Map();
  mapRoot.traverse(object => {
    if (!object || !object.userData) return;
    const textureIndex = object.userData.rooGndTextureIndex;
    const texture = object.userData.rooGndDiffuseSourceTexture;
    if (Number.isInteger(textureIndex) && texture && texture.image && !next.has(textureIndex)) {
      next.set(textureIndex, texture.image);
    }
  });
  ro2dSourceImages = next;
}

function rebuildRoExplorer2DSceneIndex() {
  ro2dSourceImages = new Map();
  ro2dDecorations = [];
  if (mapRoot && gndInfo) {
    mapRoot.updateMatrixWorld(true);
    mapRoot.traverse(object => {
      if (!object || !object.userData) return;
      const textureIndex = object.userData.rooGndTextureIndex;
      const texture = object.userData.rooGndDiffuseSourceTexture;
      if (Number.isInteger(textureIndex) && texture && texture.image && !ro2dSourceImages.has(textureIndex)) {
        ro2dSourceImages.set(textureIndex, texture.image);
      }
      if (object.userData.rooMapObject) {
        const world = object.getWorldPosition(new THREE.Vector3());
        ro2dDecorations.push({
          object,
          name: String(object.name || object.userData.rooModelName || 'RO 場景物件'),
          position: { x: world.x, y: world.y, z: world.z },
        });
      }
    });
  }
  ro2dTerrainCenter = null;
  ro2dTerrainDirty = true;
  ro2dLastTerrainRenderAt = 0;
  if (toggle2DViewButton) {
    toggle2DViewButton.disabled = !(mapInfo && mapInfo.native && gndInfo && gatInfo);
  }
}

function resizeRoExplorer2DCanvases(width, height) {
  ro2dViewportWidth = Math.max(1, Math.floor(width));
  ro2dViewportHeight = Math.max(1, Math.floor(height));
  ro2dPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const backingWidth = Math.max(1, Math.round(ro2dViewportWidth * ro2dPixelRatio));
  const backingHeight = Math.max(1, Math.round(ro2dViewportHeight * ro2dPixelRatio));
  if (ro2dCanvas && (ro2dCanvas.width !== backingWidth || ro2dCanvas.height !== backingHeight)) {
    ro2dCanvas.width = backingWidth;
    ro2dCanvas.height = backingHeight;
    ro2dTerrainDirty = true;
  }
  if (ro2dTerrainCanvas.width !== backingWidth || ro2dTerrainCanvas.height !== backingHeight) {
    ro2dTerrainCanvas.width = backingWidth;
    ro2dTerrainCanvas.height = backingHeight;
    ro2dTerrainDirty = true;
  }
  if (ro2dContext) ro2dContext.setTransform(ro2dPixelRatio, 0, 0, ro2dPixelRatio, 0, 0);
  if (ro2dTerrainContext) ro2dTerrainContext.setTransform(ro2dPixelRatio, 0, 0, ro2dPixelRatio, 0, 0);
}

function ro2dFallbackTerrainColor(textureName, x, z) {
  const value = String(textureName || '').toLowerCase();
  const variation = ((x * 17 + z * 31) % 9 + 9) % 9;
  if (/water|lake|river/.test(value)) return 'rgb(' + (43 + variation) + ',' + (100 + variation * 2) + ',' + (137 + variation * 3) + ')';
  if (/road|stone|city|prt_|floor|pavement/.test(value)) return 'rgb(' + (111 + variation * 2) + ',' + (109 + variation * 2) + ',' + (97 + variation) + ')';
  return 'rgb(' + (50 + variation * 2) + ',' + (92 + variation * 2) + ',' + (52 + variation) + ')';
}

function ro2dFillQuad(context, points, color) {
  if (!points || points.length !== 4) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  context.lineTo(points[1].x, points[1].y);
  context.lineTo(points[3].x, points[3].y);
  context.lineTo(points[2].x, points[2].y);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawRoExplorer2DTerrainTile(context, x, z, cube, center) {
  if (!cube || !Number.isInteger(cube.topSurface) || cube.topSurface < 0
    || cube.topSurface >= gndInfo.surfaces.length) return { drawn: false, textured: false };
  const surface = gndInfo.surfaces[cube.topSurface];
  if (!surface) return { drawn: false, textured: false };
  const worldCorners = ro2dGndTileWorldCorners(x, z, cube);
  const points = worldCorners.map(point => ro2dProject(point, center));
  if (!points.every(point => isRoExplorer2DPointVisible(point, ro2dViewportWidth, ro2dViewportHeight, 36))) {
    return { drawn: false, textured: false };
  }
  const textureName = gndInfo.textures && gndInfo.textures[surface.textureIndex];
  const image = ro2dSourceImages.get(surface.textureIndex);
  const imageWidth = image && (image.naturalWidth || image.videoWidth || image.width);
  const imageHeight = image && (image.naturalHeight || image.videoHeight || image.height);
  const uv = Array.isArray(surface.uv) ? surface.uv : null;
  if (image && imageWidth > 0 && imageHeight > 0 && uv && uv.length === 4
    && uv.every(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))) {
    const sourcePoints = uv.map(point => ({ x: point[0] * imageWidth, y: (1 - point[1]) * imageHeight }));
    try {
      const first = drawRoExplorer2DTexturedTriangle(context, image,
        [sourcePoints[0], sourcePoints[1], sourcePoints[2]], [points[0], points[1], points[2]]);
      const second = drawRoExplorer2DTexturedTriangle(context, image,
        [sourcePoints[2], sourcePoints[1], sourcePoints[3]], [points[2], points[1], points[3]]);
      if (first && second) return { drawn: true, textured: true };
    } catch (error) {}
  }
  ro2dFillQuad(context, points, ro2dFallbackTerrainColor(textureName, x, z));
  return { drawn: true, textured: false };
}

function renderRoExplorer2DTerrain(center, now) {
  if (!ro2dTerrainContext || !gndInfo || !Array.isArray(gndInfo.cubes)
    || !gndInfo.width || !gndInfo.height) return;
  ro2dRefreshSourceImages();
  const context = ro2dTerrainContext;
  const width = ro2dViewportWidth, height = ro2dViewportHeight;
  context.setTransform(ro2dPixelRatio, 0, 0, ro2dPixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#263d2c';
  context.fillRect(0, 0, width, height);
  const radius = getRoExplorer2DViewportRadius(width, height);
  const cx = Math.floor(center.x / (10 * worldScale) + gndInfo.width / 2);
  const cz = Math.floor(gndInfo.height / 2 - center.z / (10 * worldScale));
  const minX = Math.max(0, cx - radius.x);
  const maxX = Math.min(gndInfo.width - 1, cx + radius.x);
  const minZ = Math.max(0, cz - radius.z);
  const maxZ = Math.min(gndInfo.height - 1, cz + radius.z);
  const tiles = [];
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const cube = gndInfo.cubes[z * gndInfo.width + x];
      if (cube && cube.topSurface >= 0) tiles.push({ x, z, cube, depth: x + z });
    }
  }
  tiles.sort((a, b) => a.depth - b.depth);
  let drawn = 0, textured = 0;
  for (const tile of tiles) {
    const result = drawRoExplorer2DTerrainTile(context, tile.x, tile.z, tile.cube, center);
    if (result.drawn) drawn++;
    if (result.textured) textured++;
  }
  ro2dTerrainCenter = { x: center.x, y: center.y, z: center.z };
  ro2dLastTerrainRenderAt = now;
  ro2dTerrainDirty = false;
  ro2dMetrics.terrainTiles = drawn;
  ro2dMetrics.texturedTiles = textured;
}

function drawRoExplorer2DGatGrid(context, center) {
  if (!showCellsInput.checked || !gatInfo || !currentCell) return;
  const ppu = ro2dPixelsPerWorldUnit();
  const radiusX = Math.ceil(ro2dViewportWidth / Math.max(4, ppu * tileSize() * 2.5)) + 4;
  const radiusY = Math.ceil(ro2dViewportHeight / Math.max(4, ppu * tileSize() * 1.25)) + 4;
  const startX = Math.max(0, currentCell.x - radiusX);
  const endX = Math.min(gatInfo.width - 1, currentCell.x + radiusX);
  const startY = Math.max(0, currentCell.y - radiusY);
  const endY = Math.min(gatInfo.height - 1, currentCell.y + radiusY);
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const index = y * gatInfo.width + x;
      const world = cellWorldPosition({ x, y }, 0.015);
      const at = ro2dProject(world, center);
      if (!isRoExplorer2DPointVisible(at, ro2dViewportWidth, ro2dViewportHeight, 18)) continue;
      const halfW = 2.5 * worldScale * ppu;
      const halfH = halfW * 0.5;
      context.beginPath();
      context.moveTo(at.x, at.y - halfH);
      context.lineTo(at.x + halfW, at.y);
      context.lineTo(at.x, at.y + halfH);
      context.lineTo(at.x - halfW, at.y);
      context.closePath();
      if (gatInfo.water && gatInfo.water[index]) context.fillStyle = 'rgba(62,169,234,0.22)';
      else if (gatInfo.walkable[index]) context.fillStyle = 'rgba(77,222,151,0.14)';
      else if (gatInfo.terrainTypes[index] === 5) context.fillStyle = 'rgba(247,157,69,0.27)';
      else context.fillStyle = 'rgba(245,92,102,0.22)';
      context.fill();
      context.strokeStyle = gatInfo.walkable[index] ? 'rgba(124,255,195,0.20)' : 'rgba(255,126,130,0.25)';
      context.lineWidth = 0.5;
      context.stroke();
    }
  }
}

function drawRoExplorer2DPath(context, center) {
  if (!movementPath || movementPath.length < 2) return;
  const cells = movementPath.slice(Math.max(0, pathIndex - 1));
  context.beginPath();
  cells.forEach((cell, index) => {
    const point = ro2dProject(cellWorldPosition(cell, 0.12), center);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = '#ffe18a';
  context.lineWidth = 3;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.stroke();
  const target = movementPath[movementPath.length - 1];
  const p = ro2dProject(cellWorldPosition(target, 0.18), center);
  context.beginPath(); context.arc(p.x, p.y, 5, 0, Math.PI * 2);
  context.fillStyle = '#fff0ad'; context.fill();
  context.strokeStyle = '#5a4220'; context.lineWidth = 1.5; context.stroke();
}

function drawRoExplorer2DProp(context, prop, point) {
  const name = String(prop.name || '').toLowerCase();
  const scale = Math.max(0.75, Math.min(1.65, ro2dPixelsPerWorldUnit() / 8));
  if (/tree|palm|plant|bush|leaf|flower|grass|shrub|banana|mushroom/.test(name)) {
    context.fillStyle = 'rgba(0,0,0,0.24)';
    context.beginPath(); context.ellipse(point.x, point.y - 1, 13 * scale, 4 * scale, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#6b4a2d'; context.fillRect(point.x - 2.5 * scale, point.y - 22 * scale, 5 * scale, 23 * scale);
    context.fillStyle = '#214b35'; context.beginPath(); context.arc(point.x, point.y - 29 * scale, 15 * scale, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#34764a';
    context.beginPath(); context.arc(point.x - 8 * scale, point.y - 34 * scale, 10 * scale, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.arc(point.x + 8 * scale, point.y - 32 * scale, 11 * scale, 0, Math.PI * 2); context.fill();
    return;
  }
  if (/house|building|tower|inn|castle|wall|roof|gate/.test(name)) {
    context.fillStyle = '#4b3e3d'; context.fillRect(point.x - 12, point.y - 28, 24, 28);
    context.fillStyle = '#8d5141';
    context.beginPath(); context.moveTo(point.x - 16, point.y - 27);
    context.lineTo(point.x, point.y - 41); context.lineTo(point.x + 16, point.y - 27);
    context.closePath(); context.fill();
    context.strokeStyle = 'rgba(255,230,190,0.65)'; context.stroke();
    return;
  }
  context.fillStyle = '#665b52';
  context.beginPath(); context.moveTo(point.x - 9, point.y - 3);
  context.lineTo(point.x - 7, point.y - 11); context.lineTo(point.x + 1, point.y - 16);
  context.lineTo(point.x + 9, point.y - 7); context.lineTo(point.x + 7, point.y - 2);
  context.closePath(); context.fill();
}

function ro2dDrawableImage(image) {
  return image && Number(image.naturalWidth || image.videoWidth || image.width) > 0
    && Number(image.naturalHeight || image.videoHeight || image.height) > 0;
}

function drawRoExplorer2DSprite(context, image, point, width, height, fallbackColor, selected = false) {
  const x = point.x, y = point.y;
  // Keep animated RO sprites grounded as well as fallback silhouettes.
  drawRoExplorer2DGroundShadow(context, x, y, width);
  if (selected) drawRoExplorer2DSelectionRing(context, x, y, width);
  if (ro2dDrawableImage(image)) {
    const iw = image.naturalWidth || image.videoWidth || image.width;
    const ih = image.naturalHeight || image.videoHeight || image.height;
    const drawWidth = Math.min(width * 1.65, height * iw / ih);
    try { context.drawImage(image, x - drawWidth / 2, y - height, drawWidth, height); return; } catch (error) {}
  }
  context.fillStyle = fallbackColor;
  context.beginPath(); context.ellipse(x, y - height * 0.72, width * 0.34, height * 0.27, 0, 0, Math.PI * 2); context.fill();
  context.fillRect(x - width * 0.16, y - height * 0.56, width * 0.32, height * 0.42);
  context.fillStyle = '#f0d6b4'; context.beginPath(); context.arc(x, y - height * 0.88, width * 0.16, 0, Math.PI * 2); context.fill();
}

function ro2dDrawCombatFeedback(context, center) {
  const now = performance.now();
  combatFeedbackEntries.forEach(item => {
    const elapsed = now - item.startedAt;
    if (elapsed >= item.durationMs) { item.element.remove(); combatFeedbackEntries.delete(item); return; }
    const point = ro2dProject(item.worldPosition, center);
    if (!isRoExplorer2DPointVisible(point, ro2dViewportWidth, ro2dViewportHeight, 36)) return;
    const remaining = 1 - elapsed / item.durationMs;
    context.globalAlpha = Math.min(1, remaining * 1.8);
    context.font = '900 18px system-ui, sans-serif'; context.textAlign = 'center';
    context.lineWidth = 3; context.strokeStyle = 'rgba(5,8,13,0.9)';
    context.fillStyle = item.element.classList.contains('combat-feedback--miss') ? '#d7e3f2'
      : item.element.classList.contains('combat-feedback--player-hit') ? '#ff7777'
        : item.element.classList.contains('combat-feedback--skill') ? '#9cecff'
          : item.element.classList.contains('combat-feedback--dot') ? '#c5ff7d' : '#fff0a3';
    const lift = 26 * (elapsed / Math.max(1, item.durationMs));
    context.strokeText(item.element.textContent, point.x, point.y - lift);
    context.fillText(item.element.textContent, point.x, point.y - lift);
    context.globalAlpha = 1;
  });
}

function renderRoExplorer2DFrame(now) {
  if (!ro2dActive || !ro2dContext || !ro2dCanvas || !mapInfo || !gatInfo || !gndInfo || !currentCell) return;
  const width = ro2dViewportWidth, height = ro2dViewportHeight;
  if (followPlayerInput.checked || !ro2dCameraCenter) {
    ro2dCameraCenter = { x: playerRoot.position.x, y: playerRoot.position.y, z: playerRoot.position.z };
  }
  const center = { x: ro2dCameraCenter.x, y: ro2dCameraCenter.y, z: ro2dCameraCenter.z };
  ro2dFrameCenter = center;
  if (!ro2dTerrainCenter || ro2dTerrainDirty) renderRoExplorer2DTerrain(center, now);
  else {
    const centerProjection = ro2dProject(center, ro2dTerrainCenter);
    const shiftX = width / 2 - centerProjection.x;
    const shiftY = height / 2 - centerProjection.y;
    if (Math.abs(shiftX) > width * 0.22 || Math.abs(shiftY) > height * 0.22 || now - ro2dLastTerrainRenderAt > 650) {
      renderRoExplorer2DTerrain(center, now);
    }
  }
  const context = ro2dContext;
  context.setTransform(ro2dPixelRatio, 0, 0, ro2dPixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#263d2c'; context.fillRect(0, 0, width, height);
  if (ro2dTerrainCenter) {
    const c = ro2dProject(center, ro2dTerrainCenter);
    context.drawImage(ro2dTerrainCanvas, width / 2 - c.x, height / 2 - c.y, width, height);
  }
  drawRoExplorer2DGatGrid(context, center);
  drawRoExplorer2DPath(context, center);

  const items = [];
  const pad = 60;
  for (const prop of ro2dDecorations) {
    if (!prop.object || !prop.object.visible) continue;
    const world = prop.object.getWorldPosition(new THREE.Vector3());
    const point = ro2dProject({ x: world.x, y: world.y, z: world.z }, center);
    if (isRoExplorer2DPointVisible(point, width, height, pad)) items.push({ kind: 'prop', prop, point, depth: point.y });
  }
  let visibleMonsters = 0;
  for (const entry of monsterEntries) {
    if (!entry || entry.dead || !entry.cell) continue;
    const point = ro2dProject(cellWorldPosition(entry.cell), center);
    if (!isRoExplorer2DPointVisible(point, width, height, pad)) continue;
    items.push({ kind: 'monster', entry, point, depth: point.y }); visibleMonsters++;
  }
  if (currentCell && playerRoot) {
    const point = ro2dProject({ x: playerRoot.position.x, y: playerRoot.position.y, z: playerRoot.position.z }, center);
    if (isRoExplorer2DPointVisible(point, width, height, pad)) items.push({ kind: 'player', point, depth: point.y });
  }
  items.sort((a, b) => a.depth - b.depth);
  let visibleProps = 0;
  for (const item of items) {
    if (item.kind === 'prop') { drawRoExplorer2DProp(context, item.prop, item.point); visibleProps++; continue; }
    if (item.kind === 'monster') {
      const entry = item.entry;
      const image = entry.texture && entry.texture.image
        || entry.sprite && entry.sprite.material && entry.sprite.material.map && entry.sprite.material.map.image;
      const size = Math.max(18, tileSize() * ro2dPixelsPerWorldUnit() * 3.7);
      drawRoExplorer2DSprite(context, image, item.point, size * 0.92, size, '#c76570', entry === selectedMonsterEntry);
      if (entry.currentHp !== undefined || entry.maxHp !== undefined) {
        const hp = Number.isFinite(entry.currentHp) ? entry.currentHp : entry.monster.hp;
        const maxHp = Number.isFinite(entry.maxHp) ? entry.maxHp : entry.monster.hp;
        const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
        context.fillStyle = 'rgba(12,16,20,0.85)'; context.fillRect(item.point.x - size * 0.4, item.point.y - size - 7, size * 0.8, 4);
        context.fillStyle = '#f36f81'; context.fillRect(item.point.x - size * 0.4, item.point.y - size - 7, size * 0.8 * ratio, 4);
      }
    } else if (item.kind === 'player') {
      const image = playerSprite && playerSprite.material && playerSprite.material.map && playerSprite.material.map.image;
      const size = Math.max(22, tileSize() * ro2dPixelsPerWorldUnit() * 4.15);
      drawRoExplorer2DSprite(context, image, item.point, size * 0.85, size, '#58e0a1');
    }
  }
  ro2dMetrics.visibleProps = visibleProps; ro2dMetrics.visibleMonsters = visibleMonsters;
  ro2dDrawCombatFeedback(context, center);
  context.fillStyle = 'rgba(8,14,21,0.78)'; context.strokeStyle = 'rgba(151,186,147,0.52)'; context.lineWidth = 1;
  context.beginPath(); context.roundRect(12, 12, Math.min(250, width - 24), 49, 9); context.fill(); context.stroke();
  context.fillStyle = '#edf6e6'; context.font = '600 12px system-ui, sans-serif';
  context.fillText('ROO 2D 探索原型 · ' + (mapInfo.mapId || 'RO 地圖'), 24, 31);
  context.fillStyle = '#b9cdb6'; context.font = '11px system-ui, sans-serif';
  context.fillText('真實 GND 貼圖 · GAT 尋路 · 點擊移動', 24, 49);
}

function setRoExplorer2DActive(active) {
  const next = !!active;
  if (next && !(mapInfo && mapInfo.native && gndInfo && gatInfo && currentCell)) {
    setStatus('純 2D 原型需要先載入一張原生 RO GND/GAT 地圖。', true); return;
  }
  ro2dActive = next;
  if (ro2dCanvas) ro2dCanvas.hidden = !next;
  if (renderer && renderer.domElement) {
    renderer.domElement.hidden = next;
    if (next) renderer.domElement.style.setProperty('display', 'none', 'important');
    else {
      renderer.domElement.style.removeProperty('display');
      renderer.domElement.hidden = false;
    }
  }
  if (stage) stage.classList.toggle('roo-2d-active', next);
  if (toggle2DViewButton) {
    toggle2DViewButton.setAttribute('aria-pressed', String(next));
    toggle2DViewButton.textContent = next ? '返回原生 3D' : '切換純 2D 原型';
    toggle2DViewButton.disabled = !(mapInfo && mapInfo.native && gndInfo && gatInfo);
  }
  if (next) {
    ro2dCameraCenter = { x: playerRoot.position.x, y: playerRoot.position.y, z: playerRoot.position.z };
    ro2dTerrainCenter = null; ro2dTerrainDirty = true;
    setStatus('純 2D 原型已開啟：地面使用真實 GND diffuse UV/貼圖，角色與怪物使用 RO 2D 動畫；場景模型暫以簡圖呈現。點擊地面可移動，GAT/A*、戰鬥與本機存檔沿用現有系統。');
  } else setStatus('已返回原生 3D 地圖。');
}

function handleRoExplorer2DCanvasClick(event) {
  if (!ro2dActive || !mapInfo || !gatInfo || !gndInfo || !currentCell) return;
  const rect = ro2dCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const center = ro2dFrameCenter || ro2dCameraCenter;
  if (!center) return;
  let nearestMonster = null, nearestDistance = Infinity;
  for (const entry of monsterEntries) {
    if (!entry || entry.dead || !entry.cell) continue;
    const point = ro2dProject(cellWorldPosition(entry.cell), center);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < nearestDistance) { nearestDistance = distance; nearestMonster = entry; }
  }
  if (nearestMonster && nearestDistance <= 23) { selectRoExplorerMonster(nearestMonster); return; }
  let guess = unprojectRoExplorer2DPoint(x, y, center, ro2dViewportWidth, ro2dViewportHeight,
    ro2dPixelsPerWorldUnit(), center.y);
  let target = roMapCellFromWorldPoint(gatInfo, guess.x, guess.z, worldScale);
  if (target && target.x >= 0 && target.y >= 0 && target.x < gatInfo.width && target.y < gatInfo.height) {
    guess = unprojectRoExplorer2DPoint(x, y, center, ro2dViewportWidth, ro2dViewportHeight,
      ro2dPixelsPerWorldUnit(), groundHeight(target));
    target = roMapCellFromWorldPoint(gatInfo, guess.x, guess.z, worldScale);
  }
  if (target) requestWalkToCell(target);
}
if (ro2dCanvas) ro2dCanvas.addEventListener('click', handleRoExplorer2DCanvasClick);
if (toggle2DViewButton) toggle2DViewButton.addEventListener('click', () => setRoExplorer2DActive(!ro2dActive));
window.addEventListener('roo-explorer-mode', event => {
  if (event.detail !== 'native' && ro2dActive) setRoExplorer2DActive(false);
  if (event.detail !== 'native' && toggle2DViewButton) toggle2DViewButton.disabled = true;
});
if (explorerParams.get('roo-2d-test') === '1') {
  window.__rooExplorer2DTest = {
    getMetrics: () => ({
      ...ro2dMetrics,
      active: ro2dActive,
      canvasHidden: !ro2dCanvas || ro2dCanvas.hidden,
      rendererCanvasHidden: !!renderer.domElement.hidden,
      rendererCanvasInlineDisplay: renderer.domElement.style.display,
      rendererCanvasComputedDisplay: getComputedStyle(renderer.domElement).display,
      rendererCanvasIsDirectStageChild: renderer.domElement.parentElement === stage,
      stageClassName: stage.className,
      stageCanvasCount: stage.querySelectorAll('canvas').length,
    }),
    getWalkableTargets: () => {
      if (!ro2dActive || !currentCell || !gatInfo || !ro2dFrameCenter) return [];
      const result = [];
      for (let radius = 3; radius <= 14 && result.length < 30; radius++) {
        for (let dy = -radius; dy <= radius && result.length < 30; dy++) {
          for (let dx = -radius; dx <= radius && result.length < 30; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const x = currentCell.x + dx, y = currentCell.y + dy;
            if (x < 0 || y < 0 || x >= gatInfo.width || y >= gatInfo.height) continue;
            const index = y * gatInfo.width + x;
            if (!gatInfo.walkable[index] || (gatInfo.water && gatInfo.water[index])) continue;
            const point = ro2dProject(cellWorldPosition({ x, y }), ro2dFrameCenter);
            if (point.x < 8 || point.y < 8 || point.x > ro2dViewportWidth - 8 || point.y > ro2dViewportHeight - 8) continue;
            result.push({ x, y, screenX: point.x, screenY: point.y });
          }
        }
      }
      return result;
    },
    getPlayerCell: () => currentCell ? { x: currentCell.x, y: currentCell.y } : null,
    getMonsterTargets: () => {
      if (!ro2dActive || !currentCell || !gatInfo || !ro2dFrameCenter) return [];
      return monsterEntries.filter(entry => entry && entry.cell && entry.monster).map(entry => {
        const point = ro2dProject(cellWorldPosition(entry.cell), ro2dFrameCenter);
        const maxHp = Number.isFinite(entry.maxHp) && entry.maxHp > 0
          ? entry.maxHp : Math.max(1, Number(entry.monster.hp) || 1);
        const currentHp = Number.isFinite(entry.currentHp)
          ? Math.max(0, entry.currentHp) : maxHp;
        return {
          spawnKey: entry.spawnKey,
          spawnBaseKey: entry.spawnBaseKey,
          respawnCount: entry.respawnCount || 0,
          monsterId: String(entry.monster.id),
          name: entry.monster.name,
          cell: { x: entry.cell.x, y: entry.cell.y },
          screenX: point.x,
          screenY: point.y,
          currentHp,
          maxHp,
          dead: !!entry.dead,
          distance: Math.max(Math.abs(currentCell.x - entry.cell.x), Math.abs(currentCell.y - entry.cell.y)),
        };
      });
    },
    canApproachMonster: spawnKey => {
      const entry = monsterEntries.find(item => item && item.spawnKey === spawnKey && !item.dead);
      return !!entry && !!findMonsterAdjacentPath(entry);
    },
  };
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
  if (followPlayerInput.checked) focusCameraOnPlayer();
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
    clearRoExplorerMonsters();
    removeGrid();
    removeRoute();
    playerSprite.visible = false;
    fallbackPlayer.visible = false;
    updateStats();
    setStatus('兩個檔案名稱不一致：地圖=' + mapInfo.mapId + '，GAT=' + gatInfo.mapId + '。請選同一張地圖。', true);
    return false;
  }
  makeGrid();
  if (!gatInfo || !mapRoot) {
    clearRoExplorerMonsters();
    removeRoute();
    playerSprite.visible = false;
    fallbackPlayer.visible = false;
    updateStats();
    return false;
  }
  try {
    startAtSavedOrCenter();
    makeGrid();
    syncRoExplorerMonsters();
    setStatus('地圖已就緒：點地面或小地圖行走，點選怪物查看資料；拖曳旋轉、滾輪縮放。');
  } catch (error) {
    setStatus('場景初始化失敗：' + (error && error.message ? error.message : '未知錯誤'), true);
    updateStats();
    return false;
  }
  updateStats();
  return !!currentCell;
}

function updateStats() {
  const rows = [];
  if (mapInfo) {
    rows.push('地圖：' + mapInfo.name + '（' + mapInfo.mapId + '）');
    rows.push('場景大小：約 ' + [mapInfo.size.x, mapInfo.size.y, mapInfo.size.z].map(v => v.toFixed(1)).join(' × '));
  }
  if (mapInfo && monsterMapIdFromUrl === mapInfo.mapId) {
    rows.push('野外怪物：' + monsterEntries.filter(entry => !entry.dead).length + ' 隻／初始上限 8');
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
    if (terrainTextureDiagnostics) {
      const textures = terrainTextureDiagnostics;
      rows.push('GND 地表貼圖：已解析 ' + textures.resolved + '/' + textures.total
        + '；載入成功 ' + textures.loaded + '；失敗 ' + textures.failed
        + '；缺少匹配 ' + textures.missing.length);
      if (textures.missing.length) {
        rows.push('缺少地表貼圖名稱：' + textures.missing.slice(0, 3).join('、'));
      }
    }
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
  rows.push('角色素材：' + explorerSpriteKey + (activePlayerMotionTexture
    ? '（RO ' + (currentMotionType === 'walk' ? '行走' : '站立') + '／方向 ' + currentFacing + '）'
    : (playerSpriteFrames.length ? '（本機立繪備援）' : '（通用備援圖）')));
  rows.push('世界比例：' + worldScale + '；GAT 格寬 ' + tileSize().toFixed(2));
  if (currentCell) rows.push('目前格：(' + currentCell.x + ', ' + currentCell.y + ')');
  if (monsterEntries.length) rows.push('附近怪物：' + monsterEntries.length + ' 隻（可點選查看）');
  else if (mapInfo && mapInfo.mapId === monsterMapIdFromUrl && !explorerMonsterCatalog.length) rows.push('此地沒有可顯示的怪物');
  if (selectedMonsterEntry) rows.push('目標：' + selectedMonsterEntry.monster.name + ' Lv.' + selectedMonsterEntry.monster.level);
  stats.textContent = rows.length ? rows.join('\n') : '尚未載入地圖';
  updateMinimap();
}

const RO_EXPLORER_CAMERA_STORAGE_PREFIX = 'roo_explorer_camera_';

function saveCameraView() {
  if (!mapInfo || !mapInfo.mapId) return;
  const maxDimension = Math.max(mapInfo.size.x, mapInfo.size.y, mapInfo.size.z, 10);
  const snapshot = buildRoExplorerCameraSnapshot(camera.position, controls.target, maxDimension);
  if (!snapshot) return;
  try {
    localStorage.setItem(RO_EXPLORER_CAMERA_STORAGE_PREFIX + mapInfo.mapId, JSON.stringify(snapshot));
  } catch (error) {
    // 無法使用本機儲存時，仍可正常探索。
  }
}

function restoreCameraView(maxDimension) {
  if (!mapInfo || !mapInfo.mapId) return false;
  const key = RO_EXPLORER_CAMERA_STORAGE_PREFIX + mapInfo.mapId;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(key) || 'null');
  } catch (error) {
    saved = null;
  }
  const view = resolveRoExplorerCameraSnapshot(saved, maxDimension);
  if (!view) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      // 儲存被停用時略過清理。
    }
    return false;
  }
  camera.position.set(view.position.x, view.position.y, view.position.z);
  controls.target.set(view.target.x, view.target.y, view.target.z);
  return true;
}

function fitCamera(restoreSaved = true) {
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
  if (restoreSaved) restoreCameraView(maxDimension);
  controls.update();
  saveCameraView();
}

controls.addEventListener('end', saveCameraView);
window.addEventListener('pagehide', saveCameraView);

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
  return resolveMapTextureUrl(urls.textures, textureName);
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

const GND_DEBUG_MODE_UNIFORM = { value: 0 };

function applyGndBakedLighting(material, lightMapTexture, aoTexture, rswLight) {
  const longitude = Number.isFinite(rswLight && rswLight.longitude) ? rswLight.longitude : 45;
  const latitude = Number.isFinite(rswLight && rswLight.latitude) ? rswLight.latitude : 45;
  const ambientSource = rswLight && Array.isArray(rswLight.ambient) ? rswLight.ambient : [0.3, 0.3, 0.3];
  const diffuseSource = rswLight && Array.isArray(rswLight.diffuse) ? rswLight.diffuse : [1, 1, 1];
  const lightDirection = new THREE.Vector3(
    ...computeGndLightDirection(longitude, latitude)
  ).normalize();
  const lightAmbient = new THREE.Vector3(...ambientSource.map(value =>
    Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.3))));
  const lightDiffuse = new THREE.Vector3(...diffuseSource.map(value =>
    Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1))));

  material.onBeforeCompile = shader => {
    shader.uniforms.rooGndLightMap = { value: lightMapTexture };
    shader.uniforms.rooGndAoMap = { value: aoTexture };
    shader.uniforms.rooGndLightDirection = { value: lightDirection };
    shader.uniforms.rooGndLightAmbient = { value: lightAmbient };
    shader.uniforms.rooGndLightDiffuse = { value: lightDiffuse };
    shader.uniforms.rooGndDebugMode = GND_DEBUG_MODE_UNIFORM;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nattribute vec2 uv2;\nattribute vec3 rooGndVertexNormal;'
        + '\nattribute float rooGndHasLightmap;'
        + '\nuniform vec3 rooGndLightDirection;\nuniform vec3 rooGndLightAmbient;'
        + '\nuniform vec3 rooGndLightDiffuse;\nvarying vec2 vRooGndLightmapUv;'
        + '\nvarying float vRooGndHasLightmap;\nvarying vec3 vRooGndLightMultiplier;'
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n'
        + 'vRooGndLightmapUv = uv2;\n'
        + 'vRooGndHasLightmap = rooGndHasLightmap;\n'
        + 'vec3 rooGndNormal = normalize(rooGndVertexNormal);\n'
        + 'vec3 rooGndDirection = normalize(rooGndLightDirection);\n'
        + 'float rooGndNL = clamp(dot(rooGndNormal, -rooGndDirection), 0.0, 1.0);\n'
        + 'vec3 rooGndAmbientFactor = (vec3(1.0) - rooGndLightAmbient) * rooGndLightAmbient;\n'
        + 'vec3 rooGndAmbientTerm = rooGndLightAmbient - rooGndAmbientFactor'
        + ' + rooGndAmbientFactor * rooGndLightDiffuse;\n'
        + 'vec3 rooGndDiffuseFactor = (vec3(1.0) - rooGndLightDiffuse) * rooGndLightDiffuse;\n'
        + 'vec3 rooGndDiffuseTerm = rooGndLightDiffuse - rooGndDiffuseFactor'
        + ' + rooGndDiffuseFactor * rooGndLightAmbient;\n'
        + 'vec3 rooGndMultiplier1 = min(rooGndNL * rooGndDiffuseTerm + rooGndAmbientTerm, vec3(1.0));\n'
        + 'vec3 rooGndMaxLight = max(rooGndLightDiffuse, rooGndLightAmbient);\n'
        + 'vec3 rooGndMinLight = min(rooGndLightDiffuse, rooGndLightAmbient);\n'
        + 'vec3 rooGndMultiplier2 = min(rooGndMaxLight + (vec3(1.0) - rooGndMaxLight)'
        + ' * rooGndMinLight, vec3(1.0));\n'
        + 'vRooGndLightMultiplier = clamp(min(rooGndMultiplier1, rooGndMultiplier2),'
        + ' vec3(0.0), vec3(1.0));'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n'
        + 'vec3 rooGndLegacySrgbToLinear(vec3 value) {\n'
        + '  vec3 low = value / 12.92;\n'
        + '  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));\n'
        + '  return mix(low, high, step(vec3(0.04045), value));\n'
        + '}\n'
        + 'uniform sampler2D rooGndLightMap;'
        + '\nuniform sampler2D rooGndAoMap;\nuniform float rooGndDebugMode;\nvarying vec2 vRooGndLightmapUv;'
        + '\nvarying float vRooGndHasLightmap;\nvarying vec3 vRooGndLightMultiplier;'
    ).replace(
      '#include <color_fragment>',
      'vec3 rooGndDiffuseOnly = diffuseColor.rgb;\n#include <color_fragment>\n'
        + 'vec3 rooGndVertexColor = vec3(1.0);\n'
        + '#ifdef USE_COLOR\nrooGndVertexColor = vColor;\n#endif\n'
        + 'float rooGndHasValidLightmap = clamp(vRooGndHasLightmap, 0.0, 1.0);\n'
        + 'vec3 rooGndDiffuse = rooGndDiffuseOnly;\n'
        + 'vec3 rooGndRgbLightmap = clamp(texture2D(rooGndLightMap, vRooGndLightmapUv).rgb, 0.0, 1.0);\n'
        + 'float rooGndAo = clamp(texture2D(rooGndAoMap, vRooGndLightmapUv).r, 0.0, 1.0);\n'
        + 'float rooGndAoBlend = mix(1.0, rooGndAo, rooGndHasValidLightmap * ' + GND_PREVIEW_AO_STRENGTH.toFixed(2) + ');\n'
        + 'if (rooGndDebugMode < 0.5) {\n'
        + '  diffuseColor.rgb = rooGndDiffuse * rooGndVertexColor * vRooGndLightMultiplier * rooGndAoBlend + rooGndRgbLightmap * rooGndHasValidLightmap;\n'
        + '} else if (rooGndDebugMode < 1.5) {\n'
        + '  diffuseColor.rgb = rooGndDiffuse * rooGndVertexColor;\n'
        + '} else if (rooGndDebugMode < 2.5) {\n'
        + '  diffuseColor.rgb = rooGndRgbLightmap * rooGndHasValidLightmap;\n'
        + '} else if (rooGndDebugMode < 3.5) {\n'
        + '  diffuseColor.rgb = vec3(mix(1.0, rooGndAo, rooGndHasValidLightmap));\n'
        + '} else if (rooGndDebugMode < 4.5) {\n'
        + '  diffuseColor.rgb = vRooGndLightMultiplier;\n'
        + '} else if (rooGndDebugMode < 5.5) {\n'
        + '  diffuseColor.rgb = rooGndDiffuse * rooGndVertexColor * rooGndAoBlend;\n'
        + '} else if (rooGndDebugMode < 6.5) {\n'
        + '  diffuseColor.rgb = rooGndDiffuse * rooGndVertexColor * vRooGndLightMultiplier;\n'
        + '} else if (rooGndDebugMode < 7.5) {\n'
        + '  diffuseColor.rgb = rooGndDiffuse;\n'
        + '} else {\n'
        + '  diffuseColor.rgb = rooGndVertexColor;\n'
        + '}\n'
        + 'diffuseColor.rgb = rooGndLegacySrgbToLinear(clamp(diffuseColor.rgb, vec3(0.0), vec3(1.0)));'
    );
  };
  material.customProgramCacheKey = () => 'roo-gnd-baked-lightmap-v7-legacy-color-math';
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
  // Each atlas cell is a separate original RO lightmap slice. Global mip generation
  // averages neighboring slices at low levels and creates unrelated dark/bright blobs.
  // Keep base-level bilinear sampling inside the four-pixel edge-extended gutter.
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
  // Browser GPU audits only inspect GND surfaces; they do not need thousands of RSW model instances
  // or animated water frames. This query flag is only used by the automated diagnostic harness.
  const gndGpuAuditOnly = new URLSearchParams(window.location.search)
    .get('roo-gnd-gpu-audit-only') === '1';
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
    // The classic RO renderer uses 16-level RGB lightmap posterization; keep the
    // browser render and public-asset pixel validation on the same source values.
    const lightmapAtlas = buildGndLightmapAtlasData(parsedGnd, 16);
    const meshData = buildGndMeshData(parsedGnd, nextScale, lightmapAtlas);
    const texturedBuckets = meshData.buckets.filter(bucket => bucket.textureIndex >= 0);
    const mappedTextureIndexes = [...new Set(texturedBuckets.map(bucket => bucket.textureIndex))];
    const nextTerrainTextureDiagnostics = {
      mapId,
      total: mappedTextureIndexes.length,
      resolved: 0,
      loaded: 0,
      failed: 0,
      missing: [],
    };
    const resolvedTextureIndexes = new Set();
    const loadedTextureIndexes = new Set();
    const failedTextureIndexes = new Set();
    terrainTextureDiagnostics = nextTerrainTextureDiagnostics;
    updateStats();
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
      if (bucket.sourceUvs && bucket.sourceUvs.length === bucket.uvs.length) {
        geometry.setAttribute('rooGndSourceUv', new THREE.Float32BufferAttribute(bucket.sourceUvs, 2));
      }
      if (lightmapAtlas) {
        geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(bucket.lightmapUvs, 2));
        geometry.setAttribute('rooGndHasLightmap', new THREE.Float32BufferAttribute(bucket.lightmapEnabled, 1));
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
      geometry.setIndex(bucket.indices);
      if (Array.isArray(bucket.normals) && bucket.normals.length === bucket.positions.length) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      if (lightmapAtlas) {
        const viewNormals = geometry.getAttribute('normal').array;
        const roLightingNormals = new Float32Array(viewNormals.length);
        for (let normalAt = 0; normalAt < viewNormals.length; normalAt += 3) {
          roLightingNormals.set(transformGndNormalToRoSpace([
            viewNormals[normalAt],
            viewNormals[normalAt + 1],
            viewNormals[normalAt + 2],
          ]), normalAt);
        }
        geometry.setAttribute('rooGndVertexNormal', new THREE.Float32BufferAttribute(
          roLightingNormals, 3
        ));
      }

      const textureName = bucket.textureIndex >= 0 ? parsedGnd.textures[bucket.textureIndex] : '';
      const textureUrl = resolveMapTextureUrl(urls.textures, textureName);
      if (textureUrl && !resolvedTextureIndexes.has(bucket.textureIndex)) {
        resolvedTextureIndexes.add(bucket.textureIndex);
        nextTerrainTextureDiagnostics.resolved++;
      } else if (bucket.textureIndex >= 0 && !textureUrl) {
        const missingName = textureName || '(空白材質名稱)';
        if (!nextTerrainTextureDiagnostics.missing.includes(missingName)) {
          nextTerrainTextureDiagnostics.missing.push(missingName);
        }
      }

      // Leave a safe terrain tint while the one shared source image is decoded.
      // The real material map is replaced by an isolated per-UV-region CanvasTexture below.
      let material;
      if (lightmapAtlas) {
        material = new THREE.MeshBasicMaterial({
          map: null,
          color: 0x9cb68c,
          vertexColors: true,
          side: THREE.DoubleSide,
        });
        applyGndBakedLighting(material, lightmapTexture, aoTexture, parsedRsw.light);
      } else {
        material = new THREE.MeshStandardMaterial({
          map: null,
          color: 0x9cb68c,
          vertexColors: true,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
        });
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'terrain-texture-' + bucket.textureIndex
        + (bucket.diffuseUvRect ? '-region-' + [
          bucket.diffuseUvRect.minU, bucket.diffuseUvRect.maxU,
          bucket.diffuseUvRect.minV, bucket.diffuseUvRect.maxV,
        ].map(value => Math.round(value * 1000)).join('-') : '-source');
      mesh.userData.rooTerrainSurface = true;
      mesh.userData.rooGndSurfaceIndices = bucket.surfaceIndices;
      mesh.userData.rooGndTextureIndex = bucket.textureIndex;
      mesh.userData.rooGndTextureName = textureName;
      mesh.userData.rooGndTextureUrl = textureUrl || '';
      mesh.userData.rooGndDiffuseUvRect = bucket.diffuseUvRect || null;
      mesh.userData.rooGndDiffuseSourceTexture = null;
      mesh.userData.rooGndDiffuseSourcePixelRect = null;
      mesh.userData.rooGndDiffuseSampler = null;
      mesh.userData.rooGndLightmapSampler = lightmapTexture ? {
        generateMipmaps: lightmapTexture.generateMipmaps,
        minFilter: lightmapTexture.minFilter,
        magFilter: lightmapTexture.magFilter,
        colorSpace: lightmapTexture.colorSpace,
      } : null;
      stagedRoot.add(mesh);

      if (!textureUrl) continue;
      loadGndDiffuseSourceTexture(textureUrl).then(sourceTexture => {
        if (!isCurrentRequest()) return;
        let targetTexture = sourceTexture;
        const sourceTextureWidth = sourceTexture.image
          && (sourceTexture.image.naturalWidth || sourceTexture.image.width);
        const sourceTextureHeight = sourceTexture.image
          && (sourceTexture.image.naturalHeight || sourceTexture.image.height);
        let textureWidth = sourceTextureWidth;
        let textureHeight = sourceTextureHeight;
        let sourcePixelRect = null;
        let isIsolatedRegion = false;

        if (bucket.diffuseUvRect) {
          try {
            const region = createGndDiffuseRegionTexture(sourceTexture, bucket.diffuseUvRect);
            targetTexture = region.texture;
            textureWidth = region.width;
            textureHeight = region.height;
            sourcePixelRect = region.sourcePixelRect;
            isIsolatedRegion = true;
          } catch (error) {
            // If canvas cropping is unavailable, restore the real source UVs and use
            // the original texture with its full-image mip chain rather than showing
            // the wrong subregion under local 0..1 coordinates.
            console.warn('ROO GND diffuse 子區域隔離失敗，回退完整來源貼圖：' + textureName, error);
            const sourceUvAttribute = geometry.getAttribute('rooGndSourceUv');
            const uvAttribute = geometry.getAttribute('uv');
            if (sourceUvAttribute && uvAttribute) {
              uvAttribute.array.set(sourceUvAttribute.array);
              uvAttribute.needsUpdate = true;
            }
          }
        }

        const uvAttribute = geometry.getAttribute('uv');
        const sourceUvAttribute = geometry.getAttribute('rooGndSourceUv');
        if (isIsolatedRegion && sourcePixelRect && sourceTextureWidth > 0 && sourceTextureHeight > 0
          && uvAttribute && sourceUvAttribute) {
          // POT atlases keep crops in their original texel coordinates so every
          // mip level shares the same grid phase as the source. Non-POT fallback
          // crops remain top-left packed and require a local UV transform.
          const sourceAligned = sourcePixelRect.sourceAligned === true;
          for (let uvAt = 0; uvAt < sourceUvAttribute.array.length; uvAt += 2) {
            if (sourceAligned) {
              uvAttribute.array[uvAt] = sourceUvAttribute.array[uvAt];
              uvAttribute.array[uvAt + 1] = sourceUvAttribute.array[uvAt + 1];
            } else {
              uvAttribute.array[uvAt] = (
                sourceUvAttribute.array[uvAt] * sourceTextureWidth - sourcePixelRect.x0
              ) / textureWidth;
              // CanvasTexture flips the top-origin compact crop vertically.
              uvAttribute.array[uvAt + 1] = (
                sourceUvAttribute.array[uvAt + 1] * sourceTextureHeight
                  + textureHeight - sourceTextureHeight + sourcePixelRect.y0
              ) / textureHeight;
            }
          }
          uvAttribute.needsUpdate = true;
        } else {
          if (!isIsolatedRegion) {
            sourceTexture.wrapS = THREE.ClampToEdgeWrapping;
            sourceTexture.wrapT = THREE.ClampToEdgeWrapping;
            sourceTexture.generateMipmaps = true;
            sourceTexture.minFilter = THREE.LinearMipmapLinearFilter;
            sourceTexture.magFilter = THREE.LinearFilter;
            sourceTexture.needsUpdate = true;
          }
          if (sourceUvAttribute && uvAttribute) {
            uvAttribute.array.set(sourceUvAttribute.array);
            uvAttribute.needsUpdate = true;
          }
        }

        material.map = targetTexture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        mesh.userData.rooGndDiffuseSourceTexture = sourceTexture;
        mesh.userData.rooGndDiffuseSourcePixelRect = sourcePixelRect;
        mesh.userData.rooGndDiffuseSampler = {
          generateMipmaps: targetTexture.generateMipmaps,
          minFilter: targetTexture.minFilter,
          magFilter: targetTexture.magFilter,
          colorSpace: targetTexture.colorSpace,
        };
        if (!loadedTextureIndexes.has(bucket.textureIndex)) {
          loadedTextureIndexes.add(bucket.textureIndex);
          nextTerrainTextureDiagnostics.loaded++;
        }
        if (terrainTextureDiagnostics === nextTerrainTextureDiagnostics) updateStats();
      }).catch(error => {
        if (!isCurrentRequest()) return;
        if (!failedTextureIndexes.has(bucket.textureIndex)) {
          failedTextureIndexes.add(bucket.textureIndex);
          nextTerrainTextureDiagnostics.failed++;
        }
        if (material) {
          material.map = null;
          material.color.set('#9cb68c');
          material.needsUpdate = true;
        }
        if (terrainTextureDiagnostics === nextTerrainTextureDiagnostics) updateStats();
        console.warn('ROO GND 地表貼圖載入失敗：' + textureName, error);
      });
    }

    setStatus(gndGpuAuditOnly
      ? '地表已建立，正在準備 GPU 光照診斷…'
      : '地表已建立，正在載入 RSW 模型資源…');
    // In audit-only mode, keep the real parsed RSW lighting but skip unrelated RSM instance
    // downloads so the GPU can validate the actual GND material pipeline deterministically.
    const rswForPlacement = gndGpuAuditOnly ? { ...parsedRsw, models: [] } : parsedRsw;
    const nextRenderStats = await loadAndPlaceRswModels(
      rswForPlacement, urls, stagedRoot, nextScale, isCurrentRequest, abortController.signal
    );
    if (!isCurrentRequest() || nextRenderStats.aborted) {
      disposeObject(stagedRoot);
      stagedRoot = null;
      return;
    }
    const { animations: nextRsmAnimations, ...modelRenderStats } = nextRenderStats;
    const waterConfig = parsedGnd.water || parsedRsw.water;
    if (gndGpuAuditOnly) {
      // GND boundary sampling uses isolated terrain quads and the source RSW light;
      // animated water assets are not part of the component/framebuffer comparison.
      stagedWaterStats = {
        waterTileCount: 0,
        waterFrameCount: 0,
        waterTextureFallbackPlanes: 0,
        animations: [],
      };
    } else {
      setStatus('模型已載入，正在建立水域…');
      stagedWaterStats = await addNativeWater(stagedRoot, parsedGat, waterConfig, urls, nextScale);
    }
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
    rebuildRoExplorer2DSceneIndex();
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
    rebuildRoExplorer2DSceneIndex();
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
      terrainTextures: nextTerrainTextureDiagnostics,
      heightAlignment: compareGndGatHeights(parsedGnd, parsedGat, nextScale),
      placementBounds: analyzeRswPlacementBounds(parsedGnd, parsedRsw, nextScale),
    };
    applyRswLighting(parsedRsw, mapInfo.size);
    fitCamera();
    if (!finishOrRefreshScene()) return;
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
    ro2dTerrainCenter = null;
    ro2dTerrainDirty = true;
    rebuildRoExplorer2DSceneIndex();
    mapBounds = new THREE.Box3().setFromObject(mapRoot);
    mapInfo = { name: file.name, mapId: mapIdFromName(file.name), size, native: false };
    gndInfo = null;
    rebuildRoExplorer2DSceneIndex();
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

function updateRoExplorerCombatButtons() {
  updateRoExplorerMovementControls();
  const combatSkills = explorerSkillCatalog.filter(skill => !skill.isSupport);
  const supportSkills = explorerSkillCatalog.filter(skill => skill.isSupport);
  if (attackMonsterButton) {
    attackMonsterButton.disabled = !selectedMonsterEntry || !!selectedMonsterEntry.dead || !!pendingCombatRequest;
    attackMonsterButton.hidden = !!activeCombatTarget && activeCombatTarget === selectedMonsterEntry;
  }
  if (stopMonsterAttackButton) stopMonsterAttackButton.hidden = !activeCombatTarget || activeCombatTarget !== selectedMonsterEntry;
  if (monsterSkillInput) monsterSkillInput.disabled = !combatSkills.length || !!pendingCombatRequest;
  if (castMonsterSkillButton) {
    castMonsterSkillButton.disabled = !selectedMonsterEntry || !!selectedMonsterEntry.dead
      || !combatSkills.some(skill => skill.id === (monsterSkillInput && monsterSkillInput.value))
      || !!pendingCombatRequest;
  }
  if (supportSkillInput) supportSkillInput.disabled = !supportSkills.length || !!pendingCombatRequest;
  if (castSupportSkillButton) {
    castSupportSkillButton.disabled = !supportSkills.some(skill => skill.id === (supportSkillInput && supportSkillInput.value))
      || !!pendingCombatRequest;
  }
}
function populateRoExplorerSkillPicker() {
  const combatSkills = explorerSkillCatalog.filter(skill => !skill.isSupport);
  const supportSkills = explorerSkillCatalog.filter(skill => skill.isSupport);
  if (monsterSkillInput) {
    monsterSkillInput.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = combatSkills.length ? '選擇攻擊技能' : '沒有已學攻擊技能';
    monsterSkillInput.appendChild(placeholder);
    combatSkills.forEach(skill => {
      const option = document.createElement('option');
      option.value = skill.id;
      option.textContent = skill.name + ' Lv.' + skill.level + '（SP ' + skill.spCost + '）';
      monsterSkillInput.appendChild(option);
    });
    monsterSkillInput.disabled = !combatSkills.length;
  }
  if (supportSkillInput) {
    supportSkillInput.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = supportSkills.length ? '選擇恢復／輔助技能' : '沒有已學恢復／輔助技能';
    supportSkillInput.appendChild(placeholder);
    supportSkills.forEach(skill => {
      const option = document.createElement('option');
      option.value = skill.id;
      option.textContent = skill.name + ' Lv.' + skill.level + '（SP ' + skill.spCost + '）';
      supportSkillInput.appendChild(option);
    });
    supportSkillInput.disabled = !supportSkills.length;
  }
  updateRoExplorerCombatButtons();
}
function clearSelectedRoExplorerMonster() {
  stopRoExplorerCombat(false);
  queuedCombatSkill = null;
  selectedMonsterEntry = null;
  selectedMonsterRing.visible = false;
  if (monsterPanel) monsterPanel.hidden = true;
  updateRoExplorerCombatButtons();
  updateMinimap();
  updateStats();
}

function clearRoExplorerMonsters() {
  stopRoExplorerCombat(false);
  timedStatusEntries.clear();
  pendingStatusTickId = null;
  monsterGeneration++;
  selectedMonsterEntry = null;
  selectedMonsterRing.visible = false;
  monsterEntries.forEach(entry => {
    monsterSpritesRoot.remove(entry.root);
    entry.sprite.material.dispose();
  });
  monsterEntries.length = 0;
  monsterTextureSet.forEach(texture => texture.dispose());
  monsterTextureSet.clear();
  monsterTextureCache.clear();
  if (monsterPanel) monsterPanel.hidden = true;
  updateMinimap();
}

function updateRoExplorerMonsterPosition(entry) {
  if (!entry || !entry.root || !entry.metrics || !gatInfo) return;
  entry.root.position.copy(cellWorldPosition(entry.cell));
  const layout = buildRoExplorerSpriteLayout(entry.metrics.width, entry.metrics.height, entry.metrics.bounds, tileSize());
  entry.sprite.position.set(layout.offsetX, layout.offsetY, 0);
  entry.sprite.scale.set(layout.width, layout.height, 1);
}
function updateRoExplorerMonsterPositions() {
  monsterEntries.forEach(updateRoExplorerMonsterPosition);
  if (selectedMonsterEntry) selectedMonsterRing.position.copy(cellWorldPosition(selectedMonsterEntry.cell, 0.12));
}
function loadRoExplorerMonsterTexture(imageId) {
  if (monsterTextureCache.has(imageId)) return monsterTextureCache.get(imageId);
  const promise = (async () => {
    const animationUrl = roExplorerMonsterAnimationUrl(imageId);
    let texture = null;
    if (animationUrl) {
      try { texture = await textureLoader.loadAsync(animationUrl); } catch (error) { texture = null; }
    }
    if (!texture) {
      try { texture = await textureLoader.loadAsync(new URL('../images/monsters/' + imageId + '.png', import.meta.url).href); }
      catch (error) { return null; }
    }
    try {
      texture.colorSpace = THREE.SRGBColorSpace;
      return { texture, metrics: spriteMetricsForTexture(texture) };
    } catch (error) { texture.dispose(); return null; }
  })();
  monsterTextureCache.set(imageId, promise);
  return promise;
}
function showRoExplorerWorldFeedback(worldPosition, damage, action) {
  if (!worldPosition || !combatFeedbackLayer) return;
  const feedback = buildRoExplorerCombatFeedback(damage, action);
  if (!feedback) return;

  const element = document.createElement('span');
  element.className = 'combat-feedback combat-feedback--' + feedback.kind;
  element.textContent = feedback.text;
  element.style.animationDuration = feedback.durationMs + 'ms';
  combatFeedbackLayer.appendChild(element);
  combatFeedbackEntries.add({
    element,
    worldPosition: worldPosition.clone(),
    startedAt: performance.now(),
    durationMs: feedback.durationMs,
  });
}
function showRoExplorerCombatFeedback(entry, damage, action) {
  if (!entry || !entry.cell) return;
  showRoExplorerWorldFeedback(cellWorldPosition(entry.cell, 1.55), damage, action);
}
function showRoExplorerPlayerDamageFeedback(damage) {
  if (!currentCell || !gatInfo) return;
  const worldPosition = playerRoot.position.clone();
  worldPosition.y += tileSize() * 1.55;
  showRoExplorerWorldFeedback(worldPosition, damage, 'player-hit');
}

function updateRoExplorerCombatFeedback(now) {
  if (ro2dActive) { combatFeedbackEntries.forEach(item => { item.element.hidden = true; }); return; }
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width <= 0 || height <= 0) return;
  camera.updateMatrixWorld();
  combatFeedbackEntries.forEach(item => {
    if (now - item.startedAt >= item.durationMs) {
      item.element.remove();
      combatFeedbackEntries.delete(item);
      return;
    }
    const projected = item.worldPosition.clone().project(camera);
    const onScreen = projected.z >= -1 && projected.z <= 1
      && projected.x >= -1.1 && projected.x <= 1.1
      && projected.y >= -1.1 && projected.y <= 1.1;
    item.element.hidden = !onScreen;
    if (!onScreen) return;
    item.element.style.left = ((projected.x * 0.5 + 0.5) * width) + 'px';
    item.element.style.top = ((-projected.y * 0.5 + 0.5) * height) + 'px';
  });
}

function renderSelectedRoExplorerMonster(entry, note) {
  if (!entry || entry !== selectedMonsterEntry) return;
  const hp = Number.isFinite(entry.currentHp) ? entry.currentHp : entry.monster.hp;
  const maxHp = Number.isFinite(entry.maxHp) ? entry.maxHp : entry.monster.hp;
  if (monsterTitle) monsterTitle.textContent = (entry.monster.icon ? entry.monster.icon + ' ' : '') + entry.monster.name
    + '　Lv.' + entry.monster.level + (entry.dead ? '（已擊敗）' : '');
  updateRoExplorerGauge(monsterHpGauge, monsterHpBar, monsterHpValue, hp, maxHp);
  const statusNote = entry.statusLabels && entry.statusLabels.length
    ? '\n狀態：' + entry.statusLabels.join('、') : '';
  if (monsterDescription) monsterDescription.textContent = 'ATK ' + Math.floor(entry.monster.atk).toLocaleString()
    + (note ? '\n' + note : '\n可普攻，或選擇已學主動技能施放。') + statusNote;
  if (monsterPanel) monsterPanel.hidden = false;
}
function selectRoExplorerMonster(entry) {
  if (!entry || entry.dead) return;
  if (selectedMonsterEntry !== entry) queuedCombatSkill = null;
  if (activeCombatTarget && activeCombatTarget !== entry) stopRoExplorerCombat(false);
  selectedMonsterEntry = entry;
  selectedMonsterRing.position.copy(cellWorldPosition(entry.cell, 0.12));
  selectedMonsterRing.visible = true;
  renderSelectedRoExplorerMonster(entry);
  updateRoExplorerCombatButtons();
  setStatus('已選取 ' + entry.monster.name + '。可按「靠近並自動普攻」。');
  updateMinimap();
  updateStats();
}
function monsterHitFromEvent(event) {
  if (!monsterEntries.length) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(monsterSpritesRoot, true).find(item => {
    const entry = item.object.userData.rooMonsterEntry;
    return entry && !entry.dead;
  });
  return hit ? hit.object.userData.rooMonsterEntry : null;
}
function syncRoExplorerMonsters() {
  clearRoExplorerMonsters();
  if (!gatInfo || !mapRoot || !currentCell || !mapInfo || mapInfo.mapId !== gatInfo.mapId
    || mapInfo.mapId !== monsterMapIdFromUrl || !explorerMonsterCatalog.length) {
    updateStats();
    return;
  }
  const spawns = buildRoExplorerMonsterSpawns(gatInfo, explorerMonsterCatalog, currentCell, mapInfo.mapId, { maxCount: 8 });
  const generation = monsterGeneration;
  for (const [spawnIndex, spawn] of spawns.entries()) {
    const root = new THREE.Group();
    root.position.copy(cellWorldPosition(spawn.cell));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0xffffff, transparent: true, depthTest: true, depthWrite: false,
    }));
    sprite.visible = false;
    const spawnBaseKey = 'm' + spawnIndex;
    const entry = { ...spawn, spawnKey: spawnBaseKey, spawnBaseKey, respawnCount: 0, respawnAt: 0, root, sprite, texture: null, metrics: null, dead: false };
    sprite.userData.rooMonsterEntry = entry;
    root.add(sprite);
    monsterSpritesRoot.add(root);
    monsterEntries.push(entry);
    loadRoExplorerMonsterTexture(spawn.monster.imageId).then(asset => {
      if (generation !== monsterGeneration || !monsterEntries.includes(entry)) {
        if (asset && asset.texture) asset.texture.dispose();
        return;
      }
      if (!asset) { setStatus('部分怪物素材載入失敗，已保留其小地圖標記。'); return; }
      entry.texture = asset.texture;
      entry.metrics = asset.metrics;
      entry.sprite.material.map = asset.texture;
      entry.sprite.material.needsUpdate = true;
      entry.sprite.visible = true;
      monsterTextureSet.add(asset.texture);
      updateRoExplorerMonsterPosition(entry);
      updateMinimap();
      updateStats();
    });
  }
  updateMinimap();
  updateStats();
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

function stopRoExplorerCombat(showMessage = true) {
  const previous = activeCombatTarget;
  activeCombatTarget = null;
  nextCombatAt = 0;
  updateRoExplorerCombatButtons();
  if (showMessage && previous) setStatus('已停止自動普攻。');
}
function findMonsterAdjacentPath(entry) {
  if (!entry || !gatInfo || !currentCell) return null;
  const cells = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = entry.cell.x + dx, y = entry.cell.y + dy;
      if (x < 0 || y < 0 || x >= gatInfo.width || y >= gatInfo.height
        || !isRoMapCellWalkable(gatInfo, x, y)) continue;
      const path = findRoPath(gatInfo, currentCell, { x, y });
      if (path && (!cells.length || path.length < cells[0].path.length)) {
        cells.length = 0;
        cells.push({ cell: { x, y }, path });
      } else if (path && cells.length && path.length === cells[0].path.length) {
        cells.push({ cell: { x, y }, path });
      }
    }
  }
  cells.sort((a, b) => {
    const da = Math.hypot(a.cell.x - currentCell.x, a.cell.y - currentCell.y);
    const db = Math.hypot(b.cell.x - currentCell.x, b.cell.y - currentCell.y);
    return da - db;
  });
  return cells.length ? cells[0].cell : null;
}
function startRoExplorerCombat() {
  const entry = selectedMonsterEntry;
  if (!entry || entry.dead) {
    setStatus('請先選取還存活的怪物。', true);
    return;
  }
  if (!gatInfo || !mapInfo || mapInfo.mapId !== gatInfo.mapId || mapInfo.mapId !== monsterMapIdFromUrl) {
    setStatus('請先載入目前地圖及相同名稱的 GAT。', true);
    return;
  }
  const targetDistance = () => Math.max(Math.abs(currentCell.x - entry.cell.x), Math.abs(currentCell.y - entry.cell.y));
  activeCombatTarget = entry;
  updateRoExplorerCombatButtons();
  if (targetDistance() > 1) {
    const adjacent = findMonsterAdjacentPath(entry);
    if (!adjacent) {
      stopRoExplorerCombat(false);
      setStatus('找不到通往怪物附近的可走路徑。', true);
      return;
    }
    requestWalkToCell(adjacent);
    setStatus('正接近 ' + entry.monster.name + '；抵達一格距離後會開始普攻。');
  } else {
    nextCombatAt = 0;
    setStatus('已進入普攻距離，準備攻擊 ' + entry.monster.name + '。');
  }
}
function sendRoExplorerSkillRequest(entry, skill) {
  if (!entry || entry.dead || !skill || pendingCombatRequest || !mapInfo) return;
  const requestId = combatSessionId + '-' + (++combatRequestCounter).toString(36);
  pendingCombatRequest = { requestId, entry, action: 'skill', skill };
  const command = {
    type: 'skill', requestId, sessionId: combatSessionId, spawnKey: entry.spawnKey,
    mapId: mapInfo.mapId, defId: entry.monster.id, skillId: skill.id
  };
  updateRoExplorerCombatButtons();
  try {
    localStorage.setItem(RO_EXPLORER_COMBAT_COMMAND_KEY, JSON.stringify(command));
    setStatus('正在由主遊戲引擎施放「' + skill.name + '」…');
  } catch (error) {
    pendingCombatRequest = null;
    updateRoExplorerCombatButtons();
    setStatus('無法傳送技能指令；請允許此網站使用本機儲存。', true);
    return;
  }
  window.setTimeout(() => {
    if (!pendingCombatRequest || pendingCombatRequest.requestId !== requestId) return;
    pendingCombatRequest = null;
    updateRoExplorerCombatButtons();
    nextCombatAt = performance.now() + 2000;
    setStatus('未收到技能回覆。請保持同源的主遊戲分頁開啟，再重新嘗試。', true);
  }, 5000);
}

function requestRoExplorerSupportSkill(skill) {
  if (!skill || !skill.isSupport || pendingCombatRequest) return;
  if (!mapInfo || !mapInfo.mapId || mapInfo.mapId !== monsterMapIdFromUrl) {
    setStatus('請先載入與主遊戲相同的地圖。', true);
    return;
  }
  const requestId = combatSessionId + '-' + (++combatRequestCounter).toString(36);
  pendingCombatRequest = { requestId, entry: null, action: 'support_skill', skill };
  const command = {
    type: 'support_skill', requestId, sessionId: combatSessionId,
    mapId: mapInfo.mapId, skillId: skill.id
  };
  updateRoExplorerCombatButtons();
  try {
    localStorage.setItem(RO_EXPLORER_COMBAT_COMMAND_KEY, JSON.stringify(command));
    setStatus('正在由主遊戲引擎施放「' + skill.name + '」…');
  } catch (error) {
    pendingCombatRequest = null;
    updateRoExplorerCombatButtons();
    setStatus('無法傳送輔助指令；請允許此網站使用本機儲存。', true);
    return;
  }
  window.setTimeout(() => {
    if (!pendingCombatRequest || pendingCombatRequest.requestId !== requestId) return;
    pendingCombatRequest = null;
    updateRoExplorerCombatButtons();
    setStatus('未收到輔助／恢復技能回覆。請保持同源的主遊戲分頁開啟，再重新嘗試。', true);
  }, 5000);
}

function requestRoExplorerSkill(entry, skill) {
  if (!entry || entry.dead || !skill || pendingCombatRequest) return;
  if (!mapInfo || !gatInfo || mapInfo.mapId !== gatInfo.mapId
    || mapInfo.mapId !== monsterMapIdFromUrl) {
    setStatus('請先載入與主遊戲相同的地圖及 GAT。', true);
    return;
  }
  if (!currentCell) {
    setStatus('請先載入通行格，確認角色所在位置。', true);
    return;
  }
  if (skill.isSelfBuff) {
    queuedCombatSkill = null;
    sendRoExplorerSkillRequest(entry, skill);
    return;
  }
  const distance = Math.max(Math.abs(currentCell.x - entry.cell.x), Math.abs(currentCell.y - entry.cell.y));
  if (distance > 1) {
    const adjacent = findMonsterAdjacentPath(entry);
    if (!adjacent) {
      setStatus('找不到通往怪物附近的可走路徑。', true);
      return;
    }
    queuedCombatSkill = { entry, skill };
    requestWalkToCell(adjacent);
    setStatus('正接近 ' + entry.monster.name + '；抵達後會施放「' + skill.name + '」。');
    return;
  }
  queuedCombatSkill = null;
  sendRoExplorerSkillRequest(entry, skill);
}

function requestRoExplorerCombatAttack(entry) {
  if (!entry || pendingCombatRequest) return;
  const requestId = combatSessionId + '-' + (++combatRequestCounter).toString(36);
  pendingCombatRequest = { requestId, entry, action: 'attack' };
  const command = {
    type: 'attack', requestId, sessionId: combatSessionId, spawnKey: entry.spawnKey,
    mapId: mapInfo.mapId, defId: entry.monster.id,
  };
  try {
    localStorage.setItem(RO_EXPLORER_COMBAT_COMMAND_KEY, JSON.stringify(command));
    setStatus('正在由主遊戲引擎結算普攻…');
  } catch (error) {
    pendingCombatRequest = null;
    nextCombatAt = performance.now() + 2000;
    setStatus('無法傳送戰鬥指令；請允許此網站使用本機儲存。', true);
    return;
  }
  window.setTimeout(() => {
    if (!pendingCombatRequest || pendingCombatRequest.requestId !== requestId) return;
    pendingCombatRequest = null;
    nextCombatAt = performance.now() + 2000;
    setStatus('未收到主遊戲回覆。請保持同源的主遊戲分頁開啟，再重新嘗試。', true);
  }, 5000);
}
function processRoExplorerMonsterRespawns(now) {
  let respawned = 0;
  for (const entry of monsterEntries) {
    if (!entry.dead || !Number.isFinite(entry.respawnAt) || now < entry.respawnAt) continue;
    const occupiedCells = monsterEntries
      .filter(other => other !== entry && !other.dead)
      .map(other => other.cell);
    const cell = findRoExplorerMonsterRespawnCell(
      gatInfo, currentCell, entry.cell, occupiedCells, 12
    );
    if (!cell) {
      entry.respawnAt = now + 1000;
      continue;
    }
    entry.cell = cell;
    if (!reviveRoExplorerMonster(entry, now)) continue;
    entry.root.visible = true;
    entry.sprite.visible = !!entry.texture;
    delete entry.sprite.raycast;
    updateRoExplorerMonsterPosition(entry);
    if (selectedMonsterEntry === entry) {
      selectedMonsterRing.position.copy(cellWorldPosition(entry.cell, 0.12));
      selectedMonsterRing.visible = true;
      renderSelectedRoExplorerMonster(entry, '已重新出現，可再次選取或攻擊。');
    }
    respawned++;
  }
  if (!respawned) return;
  updateRoExplorerCombatButtons();
  updateMinimap();
  updateStats();
  setStatus(respawned === 1 ? '一隻怪物已重新出現。' : respawned + ' 隻怪物已重新出現。');
}
function requestNextRoExplorerStatusTick() {
  processRoExplorerMonsterRespawns(performance.now());
  if (pendingStatusTickId || !mapInfo || !mapInfo.mapId) return;
  const now = performance.now();
  const entries = Array.from(timedStatusEntries).filter(entry =>
    !entry.dead && monsterEntries.includes(entry) && Number(entry.nextStatusTickAt || 0) <= now
  );
  timedStatusEntries.forEach(entry => {
    if (entry.dead || !monsterEntries.includes(entry)) timedStatusEntries.delete(entry);
  });
  if (!entries.length) return;
  const entry = entries[statusTickCursor++ % entries.length];
  const requestId = combatSessionId + '-tick-' + (++combatRequestCounter).toString(36);
  pendingStatusTickId = requestId;
  entry.nextStatusTickAt = now + 1500;
  const command = {
    type: 'status_tick', requestId, sessionId: combatSessionId, spawnKey: entry.spawnKey,
    mapId: mapInfo.mapId, defId: entry.monster.id
  };
  try {
    localStorage.setItem(RO_EXPLORER_COMBAT_COMMAND_KEY, JSON.stringify(command));
  } catch (error) {
    pendingStatusTickId = null;
    entry.nextStatusTickAt = performance.now() + 1500;
    return;
  }
  window.setTimeout(() => {
    if (pendingStatusTickId !== requestId) return;
    pendingStatusTickId = null;
    entry.nextStatusTickAt = performance.now() + 1500;
  }, 4000);
}
function requestRoExplorerVitals() {
  if (activeExplorerMode !== 'native' || !playerVitalsPanel || playerVitalsPanel.hidden
    || document.hidden || !explorerPageActive || pendingVitalsRequestId) return;
  const now = performance.now();
  if (now < nextVitalsRequestAt) return;
  const requestId = combatSessionId + '-vitals-' + (++combatRequestCounter).toString(36);
  const command = {
    type: 'vitals', requestId, sessionId: combatSessionId,
    spawnKey: 'vitals', mapId: monsterMapIdFromUrl || 'prontera', defId: 'vitals'
  };
  pendingVitalsRequestId = requestId;
  nextVitalsRequestAt = now + 1000;
  try {
    localStorage.setItem(RO_EXPLORER_COMBAT_COMMAND_KEY, JSON.stringify(command));
  } catch (error) {
    pendingVitalsRequestId = null;
    nextVitalsRequestAt = performance.now() + 2500;
    return;
  }
  window.setTimeout(() => {
    if (pendingVitalsRequestId !== requestId) return;
    pendingVitalsRequestId = null;
    nextVitalsRequestAt = performance.now() + 500;
  }, 3000);
}
function handleRoExplorerCombatStorage(event) {
  if (!event || event.key !== combatResultKey || !event.newValue) return;
  let result;
  try { result = JSON.parse(event.newValue); } catch (error) { return; }
  if (!result) return;
  if (result.requestType === 'vitals') {
    if (result.requestId !== pendingVitalsRequestId) return;
    pendingVitalsRequestId = null;
    if (result.ok && result.accepted) updatePlayerVitals({
      hp: result.playerHp, maxHp: result.playerMaxHp,
      sp: result.playerSp, maxSp: result.playerMaxSp,
    }, { showDamage: true });
    if (result.ok && result.accepted) updatePlayerProgress(result);
    return;
  }
  if (result.requestType === 'status_tick') {
    if (result.requestId !== pendingStatusTickId) return;
    pendingStatusTickId = null;
    updatePlayerVitals({
      hp: result.playerHp, maxHp: result.playerMaxHp,
      sp: result.playerSp, maxSp: result.playerMaxSp,
    });
    updatePlayerProgress(result);
    const entry = monsterEntries.find(item => item.spawnKey === result.spawnKey);
    if (!entry) return;
    entry.nextStatusTickAt = performance.now() + 900;
    if (!result.ok) {
      timedStatusEntries.delete(entry);
      entry.statusLabels = [];
      return;
    }
    if (result.accepted && Number(result.damageDealt) > 0) showRoExplorerCombatFeedback(entry, result.damageDealt, 'dot');
    if (Number.isFinite(result.hp)) entry.currentHp = Math.max(0, result.hp);
    if (Number.isFinite(result.maxHp)) entry.maxHp = Math.max(1, result.maxHp);
    if (result.killed || entry.currentHp <= 0) {
      scheduleRoExplorerMonsterRespawn(entry, performance.now());
      entry.root.visible = false;
      entry.sprite.raycast = () => {};
      timedStatusEntries.delete(entry);
      const wasSelected = selectedMonsterEntry === entry;
      if (wasSelected) selectedMonsterRing.visible = false;
      if (activeCombatTarget === entry) activeCombatTarget = null;
      if (wasSelected) {
        renderSelectedRoExplorerMonster(entry, '已擊敗；持續傷害與獎勵由主遊戲引擎結算。');
        setStatus('持續傷害擊敗 ' + entry.monster.name + '！獎勵已交由主遊戲結算。');
      }
      updateRoExplorerCombatButtons();
      updateMinimap();
      updateStats();
      return;
    }
    if (result.hasTimedStatus) {
      entry.statusLabels = Array.isArray(result.statusLabels) ? result.statusLabels : [];
      timedStatusEntries.add(entry);
    } else {
      entry.statusLabels = [];
      timedStatusEntries.delete(entry);
    }
    if (result.damageDealt > 0 && selectedMonsterEntry === entry) {
      renderSelectedRoExplorerMonster(entry, '持續狀態造成 ' + Math.floor(result.damageDealt).toLocaleString() + ' 傷害。');
      setStatus(entry.monster.name + ' 受到持續傷害 ' + Math.floor(result.damageDealt).toLocaleString() + '。');
    }
    updateMinimap();
    updateStats();
    return;
  }
  if (result.requestType === 'support_skill') {
    if (!pendingCombatRequest || result.requestId !== pendingCombatRequest.requestId
      || pendingCombatRequest.action !== 'support_skill') return;
    const request = pendingCombatRequest;
    pendingCombatRequest = null;
    updatePlayerVitals({
      hp: result.playerHp, maxHp: result.playerMaxHp,
      sp: result.playerSp, maxSp: result.playerMaxSp,
    }, { showDamage: true });
    updatePlayerProgress(result);
    updateRoExplorerCombatButtons();
    if (!result.ok || !result.accepted) {
      setStatus(result.error || '恢復／輔助技能未能施放；請檢查 SP、冷卻、沉默與裝備條件。', true);
      return;
    }
    const skillName = result.skillName || request.skill.name;
    let note = skillName + ' 已施放，輔助效果已生效。';
    if (result.skillType === 'field_heal') note = skillName + ' 已啟動持續恢復效果。';
    else if (result.skillType === 'cure') note = skillName + ' 已施放，已處理可解除的異常狀態。';
    else if (result.skillType === 'buff_sprate') note = skillName + ' 已施放，SP 自然恢復增益已生效。';
    else if (result.skillType === 'buff_blessing') note = skillName + ' 已施放，能力值與命中提升。';
    else if (result.skillType === 'buff_angelus') note = skillName + ' 已施放，防禦與最大 HP 提升。';
    else if (result.skillType === 'buff_shield') note = skillName + ' 已施放，防護護盾已建立。';
    else if (result.skillType === 'buff_lukflat') note = skillName + ' 已施放，幸運值提升。';
    else if (result.skillType === 'buff_holyweapon') note = skillName + ' 已施放，武器暫時附加聖屬性。';
    else if (result.skillType === 'buff_elearmor') note = skillName + ' 已施放，防禦屬性已變更。';
    else if (result.skillType === 'buff_ailimmune') note = skillName + ' 已施放，中毒免疫已生效。';
    if (Number(result.hpRestored) > 0) note += ' HP +' + Math.floor(result.hpRestored).toLocaleString() + '。';
    if (Number(result.spRestored) > 0) note += ' SP +' + Math.floor(result.spRestored).toLocaleString() + '。';
    else if (Number(result.spCost) > 0) note += ' 消耗 SP ' + Math.floor(result.spCost).toLocaleString() + '。';
    if (Number(result.zenySpent) > 0) note += ' 消耗鋅幣 ' + Math.floor(result.zenySpent).toLocaleString() + '。';
    note += ' 目前 HP ' + Math.floor(result.playerHp).toLocaleString()
      + ' / ' + Math.floor(result.playerMaxHp).toLocaleString()
      + '，SP ' + Math.floor(result.playerSp).toLocaleString()
      + ' / ' + Math.floor(result.playerMaxSp).toLocaleString() + '。';
    setStatus(note);
    return;
  }
  if (!pendingCombatRequest || result.requestId !== pendingCombatRequest.requestId) return;
  const request = pendingCombatRequest;
  const entry = request.entry;
  pendingCombatRequest = null;
  updatePlayerVitals({
    hp: result.playerHp,
    maxHp: result.playerMaxHp,
    sp: result.playerSp,
    maxSp: result.playerMaxSp,
  }, { showDamage: true });
  updatePlayerProgress(result);
  updateRoExplorerCombatButtons();
  if (Number.isFinite(result.hp)) entry.currentHp = Math.max(0, result.hp);
  if (Number.isFinite(result.maxHp)) entry.maxHp = Math.max(1, result.maxHp);
  if (result.accepted && (!result.isSelfBuff || Number(result.damageDealt) > 0)) {
    showRoExplorerCombatFeedback(entry, result.damageDealt, request.action === 'skill' ? 'skill' : 'attack');
  }
  if (result.killed || entry.currentHp <= 0) {
    timedStatusEntries.delete(entry);
    scheduleRoExplorerMonsterRespawn(entry, performance.now());
    entry.root.visible = false;
    entry.sprite.raycast = () => {};
    const wasSelected = selectedMonsterEntry === entry;
    if (wasSelected) selectedMonsterRing.visible = false;
    if (activeCombatTarget === entry) activeCombatTarget = null;
    if (wasSelected) {
      renderSelectedRoExplorerMonster(entry, '已擊敗；經驗、職業經驗、金幣及掉落由主遊戲引擎結算。');
      setStatus('擊敗 ' + entry.monster.name + '！獎勵已交由主遊戲結算。');
    }
    updateRoExplorerCombatButtons();
    updateMinimap();
    updateStats();
    return;
  }
  if (!result.ok) {
    if (request.action !== 'skill') stopRoExplorerCombat(false);
    if (selectedMonsterEntry === entry) {
      setStatus(result.error || (request.action === 'skill' ? '主遊戲拒絕了技能。' : '主遊戲拒絕了這次攻擊。'), true);
      renderSelectedRoExplorerMonster(entry, result.error || '主遊戲拒絕了這次動作。');
    }
    updateRoExplorerCombatButtons();
    return;
  }
  if (result.rateLimited) {
    nextCombatAt = performance.now() + Math.max(50, Number(result.retryAfterMs) || 250);
    return;
  }
  if (!result.accepted) {
    if (request.action !== 'skill') stopRoExplorerCombat(false);
    const fallback = request.action === 'skill'
      ? '技能未施放；請檢查 SP、冷卻、沉默狀態與裝備條件。'
      : '攻擊未執行；請檢查角色是否能攻擊及弓箭矢。';
    if (selectedMonsterEntry === entry) {
      setStatus(result.error || fallback, true);
      renderSelectedRoExplorerMonster(entry, result.error || fallback);
    }
    updateRoExplorerCombatButtons();
    return;
  }
  if (result.hasTimedStatus) {
    entry.statusLabels = Array.isArray(result.statusLabels) ? result.statusLabels : [];
    entry.nextStatusTickAt = performance.now() + 100;
    timedStatusEntries.add(entry);
  } else {
    entry.statusLabels = [];
    timedStatusEntries.delete(entry);
  }
  combatAttackIntervalMs = Math.max(150, Number(result.attackIntervalMs) || 1000);
  if (request.action === 'skill') {
    nextCombatAt = performance.now() + combatAttackIntervalMs;
    const skillName = result.skillName || request.skill.name;
    const note = result.isSelfBuff
      ? skillName + ' 已施放，自身增益已生效。'
      : (result.damageDealt > 0
        ? skillName + ' 造成 ' + Math.floor(result.damageDealt).toLocaleString() + ' 傷害。'
        : skillName + ' 已施放。');
    const playerInfo = ' 玩家 HP ' + Math.floor(result.playerHp).toLocaleString()
      + ' / ' + Math.floor(result.playerMaxHp).toLocaleString()
      + '，SP ' + Math.floor(result.playerSp).toLocaleString()
      + ' / ' + Math.floor(result.playerMaxSp).toLocaleString() + '。';
    renderSelectedRoExplorerMonster(entry, note + playerInfo);
    if (selectedMonsterEntry === entry) {
      setStatus(note + ' 目標 HP ' + Math.floor(entry.currentHp).toLocaleString()
        + ' / ' + Math.floor(entry.maxHp).toLocaleString() + '。' + playerInfo);
    }
    updateRoExplorerCombatButtons();
    return;
  }
  nextCombatAt = performance.now() + combatAttackIntervalMs;
  const note = result.damageDealt > 0
    ? '本次造成 ' + Math.floor(result.damageDealt).toLocaleString() + ' 傷害。'
    : '本次未造成傷害。';
  renderSelectedRoExplorerMonster(entry, note + ' 玩家 HP ' + Math.floor(result.playerHp).toLocaleString()
    + ' / ' + Math.floor(result.playerMaxHp).toLocaleString() + '。');
  if (selectedMonsterEntry === entry) {
    setStatus(note + ' 目標 HP ' + Math.floor(entry.currentHp).toLocaleString()
      + ' / ' + Math.floor(entry.maxHp).toLocaleString() + '。');
  }
}
window.addEventListener('storage', handleRoExplorerCombatStorage);
let statusTickTimer = window.setInterval(requestNextRoExplorerStatusTick, 100);
if (activeExplorerMode === 'native') setVitalsPollingMode('native');
window.addEventListener('pagehide', () => {
  explorerPageActive = false;
  if (statusTickTimer !== null) window.clearInterval(statusTickTimer);
  if (vitalsPollTimer !== null) window.clearInterval(vitalsPollTimer);
  statusTickTimer = null;
  vitalsPollTimer = null;
  pendingStatusTickId = null;
  pendingVitalsRequestId = null;
});
window.addEventListener('pageshow', () => {
  explorerPageActive = true;
  if (statusTickTimer === null) statusTickTimer = window.setInterval(requestNextRoExplorerStatusTick, 100);
  if (activeExplorerMode === 'native' && vitalsPollTimer === null) setVitalsPollingMode('native');
});
attackMonsterButton.addEventListener('click', startRoExplorerCombat);
stopMonsterAttackButton.addEventListener('click', () => stopRoExplorerCombat());
if (stopMovementButton) stopMovementButton.addEventListener('click', stopRoExplorerMovement);
if (monsterSkillInput) monsterSkillInput.addEventListener('change', updateRoExplorerCombatButtons);
if (castMonsterSkillButton) castMonsterSkillButton.addEventListener('click', () => {
  const skill = explorerSkillCatalog.find(item => !item.isSupport
    && item.id === (monsterSkillInput && monsterSkillInput.value));
  requestRoExplorerSkill(selectedMonsterEntry, skill);
});
if (supportSkillInput) supportSkillInput.addEventListener('change', updateRoExplorerCombatButtons);
if (castSupportSkillButton) castSupportSkillButton.addEventListener('click', () => {
  const skill = explorerSkillCatalog.find(item => item.isSupport
    && item.id === (supportSkillInput && supportSkillInput.value));
  requestRoExplorerSupportSkill(skill);
});

function stopRoExplorerMovement() {
  if (!movementPath || !gatInfo || !currentCell) return;
  const previousPlayerPosition = followPlayerInput.checked ? playerRoot.position.clone() : null;
  const stoppedCell = roMapCellFromWorldPoint(
    gatInfo, playerRoot.position.x, playerRoot.position.z, worldScale
  );
  if (stoppedCell && isRoMapCellWalkable(gatInfo, stoppedCell.x, stoppedCell.y)) {
    currentCell = { x: stoppedCell.x, y: stoppedCell.y };
  }
  movementPath = null;
  pathIndex = 1;
  queuedCombatSkill = null;
  stopRoExplorerCombat(false);
  updatePlayerPosition();
  if (syncFollowCamera(previousPlayerPosition)) saveCameraView();
  savePosition();
  removeRoute();
  setPlayerMotion('idle', currentFacing);
  updateRoExplorerCombatButtons();
  updateStats();
  setStatus('已停止移動／接近；角色已停在最近的可走格。');
}

function requestWalkToCell(requestedTarget) {
  if (!gatInfo || !mapRoot || !currentCell || !mapInfo || mapInfo.mapId !== gatInfo.mapId) {
    setStatus('請先載入地圖與同名 GAT。', true);
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

  if (!requestedTarget || !Number.isInteger(requestedTarget.x) || !Number.isInteger(requestedTarget.y)
    || requestedTarget.x < 0 || requestedTarget.y < 0
    || requestedTarget.x >= gatInfo.width || requestedTarget.y >= gatInfo.height) {
    setPlayerMotion('idle', currentFacing);
    setStatus('點擊位置在 GAT 地圖範圍之外。');
    return;
  }
  let target = requestedTarget;
  if (!isRoMapCellWalkable(gatInfo, target.x, target.y)) {
    target = findNearestRoWalkableCell(gatInfo, target.x, target.y, 12);
    if (!target) {
      setPlayerMotion('idle', currentFacing);
      setStatus('附近 12 格內找不到可走地面。', true);
      return;
    }
  }
  const snapped = target.x !== requestedTarget.x || target.y !== requestedTarget.y;
  const path = findRoPath(gatInfo, currentCell, target);
  if (!path) {
    setPlayerMotion('idle', currentFacing);
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
    setPlayerMotion('idle', currentFacing);
    setStatus('已到達目的地。');
  } else {
    updateRouteLine();
    setStatus((snapped ? '點擊處是障礙，已改到附近可走格。' : '已規劃路徑。')
      + ' 可點 3D 地面或小地圖更改目的地。');
  }
  updateStats();
}

function requestWalk(event) {
  if (!gatInfo || !mapRoot || !currentCell || !mapInfo || mapInfo.mapId !== gatInfo.mapId) {
    setStatus('請先載入地圖與同名 GAT。', true);
    return;
  }
  const hit = groundHitFromEvent(event);
  if (!hit) {
    setStatus('沒有點到可辨識的地面；請點擊地圖地板，而不是天空或牆面。');
    return;
  }
  requestWalkToCell(roMapCellFromWorldPoint(gatInfo, hit.point.x, hit.point.z, worldScale));
}

function requestMinimapWalk(event) {
  if (!gatInfo || !mapRoot || !currentCell || !mapInfo || mapInfo.mapId !== gatInfo.mapId) {
    setStatus('請先載入地圖與同名 GAT。', true);
    return;
  }
  const rect = minimapCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const target = mapRoExplorerMinimapPointToCell(
    (event.clientX - rect.left) / rect.width,
    (event.clientY - rect.top) / rect.height,
    gatInfo.width,
    gatInfo.height
  );
  if (target) requestWalkToCell(target);
}

function syncFollowCamera(previousPosition) {
  if (!followPlayerInput.checked || !previousPosition) return false;
  const delta = getRoExplorerCameraFollowDelta(previousPosition, playerRoot.position);
  if (!delta || (!delta.x && !delta.y && !delta.z)) return false;
  camera.position.x += delta.x;
  camera.position.y += delta.y;
  camera.position.z += delta.z;
  controls.target.x += delta.x;
  controls.target.y += delta.y;
  controls.target.z += delta.z;
  return true;
}

function focusCameraOnPlayer() {
  if (!followPlayerInput.checked || !currentCell || !gatInfo || !mapInfo) return false;
  const delta = getRoExplorerCameraFollowDelta(controls.target, playerRoot.position);
  if (!delta) return false;
  camera.position.x += delta.x;
  camera.position.y += delta.y;
  camera.position.z += delta.z;
  controls.target.copy(playerRoot.position);
  controls.update();
  saveCameraView();
  return true;
}

function advanceMovement(deltaSeconds) {
  if (!movementPath || !gatInfo || !currentCell) return;
  const previousPlayerPosition = followPlayerInput.checked ? playerRoot.position.clone() : null;
  let budget = Number(speedInput.value) * tileSize() * deltaSeconds;
  let changedCell = false;
  while (budget > 0 && movementPath && pathIndex < movementPath.length) {
    const nextCell = movementPath[pathIndex];
    const direction = roExplorerDirectionFromDelta(
      nextCell.x - currentCell.x,
      nextCell.y - currentCell.y
    );
    if (direction !== null && (currentMotionType !== 'walk' || currentFacing !== direction)) {
      setPlayerMotion('walk', direction);
    }
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
        setPlayerMotion('idle', currentFacing);
        setStatus('已到達目的地。');
      }
    } else {
      playerRoot.position.lerp(destination, budget / distance);
      budget = 0;
    }
  }
  const followed = syncFollowCamera(previousPlayerPosition);
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
    if (followed) saveCameraView();
  }
}

function resize() {
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  resizeRoExplorer2DCanvases(width, height);
  ro2dTerrainDirty = true;
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
    updateRoExplorerMonsterPositions();
    makeGrid();
    if (movementPath) updateRouteLine();
    updateStats();
  }
});
speedInput.addEventListener('input', () => { speedValue.textContent = speedInput.value; });
showMinimapInput.addEventListener('change', updateMinimap);
followPlayerInput.addEventListener('change', () => {
  if (followPlayerInput.checked) {
    focusCameraOnPlayer();
    setStatus('視角會跟隨角色移動；取消勾選即可自由查看地圖。');
  } else {
    saveCameraView();
    setStatus('已切換自由視角；角色移動時相機不跟隨。');
  }
});
clearMonsterTargetButton.addEventListener('click', clearSelectedRoExplorerMonster);
populateRoExplorerSkillPicker();
updateRoExplorerCombatButtons();
minimapCanvas.addEventListener('click', requestMinimapWalk);
showCellsInput.addEventListener('change', () => {
  makeGrid();
  if (showCellsInput.checked) setStatus('顯示通行格：綠色可走、紅色阻擋、橘色懸崖、藍色水域。');
});
const gndSurfaceInspector = document.getElementById('gnd-surface-inspector');
const gndSurfaceInspectorContent = document.getElementById('gnd-surface-inspector-content');
const gndSourceTextureCanvasCache = new WeakMap();
let lastGndDiagnosticPointer = null;
let pendingGndInspectorReadback = null;

function formatGndDiagnosticVector(values) {
  return (values || []).map(value => Number.isFinite(value) ? value.toFixed(4) : '—').join(', ');
}

function sampleGndSourceTexturePixel(texture, uv, uvRect = null, sourcePixelRect = null) {
  const image = texture && texture.image;
  const width = image && (image.naturalWidth || image.videoWidth || image.width);
  const height = image && (image.naturalHeight || image.videoHeight || image.height);
  if (!image || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return '原貼圖尚未載入';
  }

  let cached = gndSourceTextureCanvasCache.get(texture);
  if (!cached || cached.image !== image || cached.width !== width || cached.height !== height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return '無法建立像素取樣畫布';
    try {
      context.drawImage(image, 0, 0, width, height);
    } catch (error) {
      return '原貼圖讀取失敗：' + (error && error.message ? error.message : String(error));
    }
    cached = { image, width, height, context };
    gndSourceTextureCanvasCache.set(texture, cached);
  }

  try {
    const mapping = uvRect
      ? mapGndDiffuseUvToSourcePixel(uv, uvRect, width, height, sourcePixelRect)
      : null;
    const sampleX = mapping
      ? mapping.sourcePosition[0]
      : Math.max(0, Math.min(width - 1, uv[0] * width - 0.5));
    const sampleY = mapping
      ? mapping.sourcePosition[1]
      : Math.max(0, Math.min(height - 1, height - 0.5 - uv[1] * height));
    const x0 = Math.floor(sampleX);
    const y0 = Math.floor(sampleY);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const blockWidth = x1 - x0 + 1;
    const block = cached.context.getImageData(x0, y0, blockWidth, y1 - y0 + 1).data;
    const fx = sampleX - x0;
    const fy = sampleY - y0;
    const channelAt = (x, y, channel) =>
      block[((y - y0) * blockWidth + (x - x0)) * 4 + channel];
    const sampled = [0, 1, 2, 3].map(channel => {
      const top = channelAt(x0, y0, channel) * (1 - fx)
        + channelAt(x1, y0, channel) * fx;
      const bottom = channelAt(x0, y1, channel) * (1 - fx)
        + channelAt(x1, y1, channel) * fx;
      return Number((top * (1 - fy) + bottom * fy).toFixed(3));
    });
    const nearestX = Math.max(0, Math.min(width - 1, Math.round(sampleX)));
    const nearestY = Math.max(0, Math.min(height - 1, Math.round(sampleY)));
    const nearest = cached.context.getImageData(nearestX, nearestY, 1, 1).data;
    const cropSummary = mapping
      ? '; crop=[' + mapping.crop.x0 + ',' + mapping.crop.y0 + '–'
        + mapping.crop.x1 + ',' + mapping.crop.y1 + ']; localUV=('
        + formatGndDiagnosticVector(mapping.localUv) + ')'
      : '';
    return 'LOD0 線性預估 RGBA (' + sampled.join(', ') + '); 最近來源像素 RGBA ('
      + nearest[0] + ', ' + nearest[1] + ', ' + nearest[2] + ', ' + nearest[3]
      + ') @ (' + nearestX + ', ' + nearestY + ')' + cropSummary;
  } catch (error) {
    return '原貼圖像素不可讀（可能是跨來源 CORS 限制）：'
      + (error && error.message ? error.message : String(error));
  }
}

function sampleGndLightmapSourceCorner(surface, corner) {
  const slices = gndInfo && gndInfo.lightmapSlices;
  const index = surface && surface.lightmapIndex;
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(slices) || index >= slices.length) {
    return '無有效 lightmap slice';
  }
  const slice = slices[index];
  const width = slice.width;
  const height = slice.height;
  if (!width || !height || !slice.colorPixels) return 'lightmap 像素資料缺失';

  // RO GND reserves the outer pixel ring as a filter buffer; report the four
  // closest valid interior texels mapped to SW, SE, NW and NE surface corners.
  const x = corner % 2 === 0 ? Math.min(1, width - 1) : Math.max(0, width - 2);
  const y = corner < 2 ? Math.min(1, height - 1) : Math.max(0, height - 2);
  const channels = slice.channels || 4;
  const at = (y * width + x) * channels;
  const rgb = Array.from(slice.colorPixels.slice(at, at + 3));
  const ao = slice.shadowPixels
    ? slice.shadowPixels[y * width + x]
    : channels === 4 ? slice.colorPixels[at + 3] : 255;
  return 'RGB (' + rgb.join(', ') + '); AO ' + ao + ' @ (' + x + ', ' + y + ')';
}


function sampleGndAttributeAtHit(hit, attributeName) {
  const object = hit && hit.object;
  const geometry = object && object.geometry;
  const attribute = geometry && geometry.getAttribute(attributeName);
  const position = geometry && geometry.getAttribute('position');
  const face = hit && hit.face;
  if (!object || !attribute || !position || !face || !hit.point
    || ![face.a, face.b, face.c].every(Number.isInteger)) return null;

  object.updateWorldMatrix(true, false);
  const vertices = [face.a, face.b, face.c].map(index => {
    const vertex = new THREE.Vector3().fromBufferAttribute(position, index);
    return object.localToWorld(vertex);
  });
  const [a, b, c] = vertices;
  const v0 = b.clone().sub(a);
  const v1 = c.clone().sub(a);
  const v2 = hit.point.clone().sub(a);
  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);
  const denominator = d00 * d11 - d01 * d01;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return null;
  const weightB = (d11 * d20 - d01 * d21) / denominator;
  const weightC = (d00 * d21 - d01 * d20) / denominator;
  const weights = [1 - weightB - weightC, weightB, weightC];
  if (!weights.every(Number.isFinite)) return null;

  const indexes = [face.a, face.b, face.c];
  return Array.from({ length: attribute.itemSize }, (_, channel) =>
    weights.reduce((sum, weight, index) => {
      const vertexIndex = indexes[index];
      const value = channel === 0 ? attribute.getX(vertexIndex)
        : channel === 1 ? attribute.getY(vertexIndex)
          : channel === 2 ? attribute.getZ(vertexIndex)
            : channel === 3 ? attribute.getW(vertexIndex) : 0;
      return sum + weight * value;
    }, 0)
  );
}

function getGndLightmapAtlasUvForCorner(surface, corner) {
  const slices = gndInfo && gndInfo.lightmapSlices;
  const index = surface && surface.lightmapIndex;
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(slices) || index >= slices.length
    || !Number.isInteger(corner) || corner < 0 || corner > 3) return null;
  const slice = slices[index];
  const width = slice.width;
  const height = slice.height;
  if (!width || !height) return null;
  const columns = Math.ceil(Math.sqrt(slices.length));
  const rows = Math.ceil(slices.length / columns);
  const gutter = 4;
  const cellWidth = width + gutter * 2;
  const cellHeight = height + gutter * 2;
  const atlasWidth = columns * cellWidth;
  const atlasHeight = rows * cellHeight;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const sourceGutter = width >= 4 && height >= 4 ? 1 : 0;
  const sourceSampleInset = sourceGutter ? 0 : 0.5;
  const u0 = (column * cellWidth + gutter + sourceGutter + sourceSampleInset) / atlasWidth;
  const u1 = (column * cellWidth + gutter + width - sourceGutter - sourceSampleInset) / atlasWidth;
  const v0 = (row * cellHeight + gutter + sourceGutter + sourceSampleInset) / atlasHeight;
  const v1 = (row * cellHeight + gutter + height - sourceGutter - sourceSampleInset) / atlasHeight;
  return [[u0, v0], [u1, v0], [u0, v1], [u1, v1]][corner];
}

function sampleGndLightmapSourceAtUv(surface, atlasUv) {
  const slices = gndInfo && gndInfo.lightmapSlices;
  const index = surface && surface.lightmapIndex;
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(slices) || index >= slices.length
    || !Array.isArray(atlasUv) || atlasUv.length < 2
    || !atlasUv.every(Number.isFinite)) return null;
  const slice = slices[index];
  const width = slice.width;
  const height = slice.height;
  if (!width || !height || !slice.colorPixels) return null;

  // Match the actual atlas's LinearFilter at mip level zero. UVs land on
  // inner-border boundaries, so GPU sampling blends the border with the next
  // texel; reporting only the nearest interior byte hides that distinction.
  const columns = Math.ceil(Math.sqrt(slices.length));
  const gutter = 4;
  const cellWidth = width + gutter * 2;
  const cellHeight = height + gutter * 2;
  const atlasWidth = columns * cellWidth;
  const atlasHeight = Math.ceil(slices.length / columns) * cellHeight;
  const baseX = (index % columns) * cellWidth + gutter;
  const baseY = Math.floor(index / columns) * cellHeight + gutter;
  const sampleX = Math.max(0, Math.min(width - 1,
    atlasUv[0] * atlasWidth - baseX - 0.5));
  const sampleY = Math.max(0, Math.min(height - 1,
    atlasUv[1] * atlasHeight - baseY - 0.5));
  const x = Math.round(sampleX);
  const y = Math.round(sampleY);
  const channels = slice.channels || 4;
  const sourceRgbAt = (px, py, channel) => {
    const value = slice.colorPixels[(py * width + px) * channels + channel];
    return Math.floor(value / 16) * 16;
  };
  const sourceAoAt = (px, py) => slice.shadowPixels
    ? slice.shadowPixels[py * width + px]
    : channels === 4 ? slice.colorPixels[(py * width + px) * channels + 3] : 255;
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = sampleX - x0;
  const fy = sampleY - y0;
  const bilinear = getter => {
    const top = getter(x0, y0) * (1 - fx) + getter(x1, y0) * fx;
    const bottom = getter(x0, y1) * (1 - fx) + getter(x1, y1) * fx;
    return Number((top * (1 - fy) + bottom * fy).toFixed(3));
  };
  const nearestAt = (px, py) => {
    const at = (py * width + px) * channels;
    return {
      rgb: Array.from(slice.colorPixels.slice(at, at + 3)),
      ao: slice.shadowPixels
        ? slice.shadowPixels[py * width + px]
        : channels === 4 ? slice.colorPixels[at + 3] : 255,
    };
  };
  const nearest = nearestAt(x, y);
  return {
    x, y, rgb: nearest.rgb, ao: nearest.ao,
    samplePosition: [Number(sampleX.toFixed(3)), Number(sampleY.toFixed(3))],
    filteredRgb: [0, 1, 2].map(channel => bilinear((px, py) => sourceRgbAt(px, py, channel))),
    filteredAo: bilinear(sourceAoAt),
  };
}

const gndDiffuseSourcePixelCache = new WeakMap();

function readGndDiffuseImagePixels(image, width, height) {
  if (!image || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('GND diffuse 像素稽核需要有效的影像尺寸。');
  }
  if (typeof image.getContext === 'function') {
    const context = image.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('無法讀取 GND diffuse canvas 像素。');
    return context.getImageData(0, 0, width, height).data;
  }
  let cached = gndDiffuseSourcePixelCache.get(image);
  if (!cached || cached.width !== width || cached.height !== height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('無法建立 GND diffuse 來源像素畫布。');
    context.drawImage(image, 0, 0, width, height);
    cached = { width, height, data: context.getImageData(0, 0, width, height).data };
    gndDiffuseSourcePixelCache.set(image, cached);
  }
  return cached.data;
}

function bilinearGndDiffuseRgb(data, width, height, x, y) {
  const sx = Math.max(0, Math.min(width - 1, x));
  const sy = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = sx - x0, ty = sy - y0;
  const sample = (px, py, channel) => data[(py * width + px) * 4 + channel];
  return [0, 1, 2].map(channel => {
    const top = sample(x0, y0, channel) * (1 - tx) + sample(x1, y0, channel) * tx;
    const bottom = sample(x0, y1, channel) * (1 - tx) + sample(x1, y1, channel) * tx;
    return top * (1 - ty) + bottom * ty;
  });
}

function auditGndDiffuseCropBasePixels(sourceImage, cropImages, crops, sourceUvRect, sourceWidth, sourceHeight) {
  const sourceData = readGndDiffuseImagePixels(sourceImage, sourceWidth, sourceHeight);
  const cropDimensions = cropImages.map(image => ({
    width: image.naturalWidth || image.videoWidth || image.width,
    height: image.naturalHeight || image.videoHeight || image.height,
  }));
  const cropData = cropImages.map((image, index) =>
    readGndDiffuseImagePixels(image, cropDimensions[index].width, cropDimensions[index].height));
  let maxDelta = 0;
  let sampleCount = 0;
  let worst = null;
  const gridSize = 5;
  for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize; x++) {
    const uv = [
      sourceUvRect.minU + (x + 0.5) / gridSize * (sourceUvRect.maxU - sourceUvRect.minU),
      sourceUvRect.minV + (y + 0.5) / gridSize * (sourceUvRect.maxV - sourceUvRect.minV),
    ];
    const sourcePosition = [
      uv[0] * sourceWidth - 0.5,
      sourceHeight - 0.5 - uv[1] * sourceHeight,
    ];
    const expected = bilinearGndDiffuseRgb(sourceData, sourceWidth, sourceHeight,
      sourcePosition[0], sourcePosition[1]);
    for (let side = 0; side < 2; side++) {
      const crop = crops[side], size = cropDimensions[side];
      const actualPosition = crops[side].sourceAligned
        ? sourcePosition
        : [sourcePosition[0] - crop.x0, sourcePosition[1] - crop.y0];
      const actual = bilinearGndDiffuseRgb(cropData[side], size.width, size.height,
        actualPosition[0], actualPosition[1]);
      const delta = Math.max(...actual.map((value, channel) => Math.abs(value - expected[channel])));
      sampleCount++;
      if (delta > maxDelta) {
        maxDelta = delta;
        worst = { side: side ? 'B' : 'A', uv, expected, actual, delta };
      }
    }
  }
  return {
    status: maxDelta === 0 ? 'passed' : 'mismatch',
    maxDelta,
    sampleCount,
    worst,
    method: 'CPU base-level bilinear sample of source image versus exact crop-canvas pixels; 5×5 UV grid per crop',
  };
}

function createGndDiffuseRegionTexture(sourceTexture, uvRect) {
  const image = sourceTexture && sourceTexture.image;
  const width = image && (image.naturalWidth || image.videoWidth || image.width);
  const height = image && (image.naturalHeight || image.videoHeight || image.height);
  if (!image || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !uvRect || ![uvRect.minU, uvRect.maxU, uvRect.minV, uvRect.maxV].every(Number.isFinite)) {
    throw new Error('GND diffuse 子區域缺少有效來源影像或 UV 範圍。');
  }

  const crop = resolveGndDiffuseCropRect(uvRect, width, height);
  const { x0, y0, x1, y1 } = crop;
  const regionWidth = crop.width;
  const regionHeight = crop.height;
  if (regionWidth < 1 || regionHeight < 1) {
    throw new Error('GND diffuse UV 子區域小於一個來源像素。');
  }
  const isPowerOfTwo = value => Number.isInteger(value) && value > 0
    && (value & (value - 1)) === 0;
  const sourceAligned = isPowerOfTwo(width) && isPowerOfTwo(height);

  // For POT atlases, use the real source texture for every region. Separate
  // edge-extruded textures cannot reproduce the same GPU sample on a shared UV
  // boundary; they can diverge even at LOD0 and become a visible terrain seam.
  // Sharing the source texture also shares its exact mip chain and sampler state.
  if (sourceAligned) {
    return {
      texture: sourceTexture,
      width,
      height,
      sourcePixelRect: { x0, y0, x1, y1, width: regionWidth, height: regionHeight, sourceAligned: true },
    };
  }

  // Non-POT fallback retains a compact crop with a local UV transform.
  const canvas = document.createElement('canvas');
  canvas.width = regionWidth;
  canvas.height = regionHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('無法建立 GND diffuse 子區域畫布。');
  const sourcePixels = readGndDiffuseImagePixels(image, width, height);
  const cropPixels = context.createImageData(regionWidth, regionHeight);
  const sourceRowBytes = width * 4;
  const cropRowBytes = regionWidth * 4;
  for (let row = 0; row < regionHeight; row++) {
    const sourceStart = (y0 + row) * sourceRowBytes + x0 * 4;
    cropPixels.data.set(sourcePixels.subarray(sourceStart, sourceStart + cropRowBytes), row * cropRowBytes);
  }
  context.putImageData(cropPixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  texture.needsUpdate = true;
  return {
    texture,
    width: regionWidth,
    height: regionHeight,
    sourcePixelRect: { x0, y0, x1, y1, width: regionWidth, height: regionHeight, sourceAligned: false },
  };
}
function describeGndTextureFilters(texture) {
  if (!texture) return '無已載入貼圖';
  const filterName = value => value === THREE.LinearFilter ? 'LinearFilter'
    : value === THREE.NearestFilter ? 'NearestFilter' : 'mipmap filter (' + value + ')';
  return 'mipmap=' + (texture.generateMipmaps ? 'GPU' : Array.isArray(texture.mipmaps) && texture.mipmaps.length
    ? '手動 ' + texture.mipmaps.length + ' 層' : 'off')
    + '; min=' + filterName(texture.minFilter)
    + '; mag=' + filterName(texture.magFilter);
}

const gndSurfaceUseLookupCache = new WeakMap();
const gndSurfaceMeshLookupCache = new WeakMap();

function getGndSurfaceUseLookup(gnd) {
  let lookup = gndSurfaceUseLookupCache.get(gnd);
  if (lookup) return lookup;
  lookup = new Map();
  for (let cubeIndex = 0; cubeIndex < gnd.cubes.length; cubeIndex++) {
    const cube = gnd.cubes[cubeIndex];
    const x = cubeIndex % gnd.width;
    const y = Math.floor(cubeIndex / gnd.width);
    for (const [side, index] of [
      ['top', cube.topSurface], ['north', cube.northSurface], ['east', cube.eastSurface],
    ]) {
      if (!Number.isInteger(index) || index < 0) continue;
      if (!lookup.has(index)) lookup.set(index, []);
      lookup.get(index).push({ x, y, side });
    }
  }
  gndSurfaceUseLookupCache.set(gnd, lookup);
  return lookup;
}

function getGndSurfaceMeshLookup(root) {
  let lookup = gndSurfaceMeshLookupCache.get(root);
  if (lookup) return lookup;
  lookup = new Map();
  root.traverse(object => {
    const indices = object.userData && object.userData.rooGndSurfaceIndices;
    if (!object.userData.rooTerrainSurface || !Array.isArray(indices)) return;
    indices.forEach((index, quadIndex) => {
      if (!lookup.has(index)) lookup.set(index, { object, quadIndex });
    });
  });
  gndSurfaceMeshLookupCache.set(root, lookup);
  return lookup;
}

function describeGndSurfaceForComparison(gnd, surfaceIndex, meshLookup) {
  const surface = gnd.surfaces[surfaceIndex];
  if (!surface) return 'Surface #' + surfaceIndex + ' 無效';
  const bounds = surface.uv && surface.uv.length
    ? {
      minU: Math.min(...surface.uv.map(uv => uv[0])),
      maxU: Math.max(...surface.uv.map(uv => uv[0])),
      minV: Math.min(...surface.uv.map(uv => uv[1])),
      maxV: Math.max(...surface.uv.map(uv => uv[1])),
    } : null;
  const entry = meshLookup.get(surfaceIndex);
  let tintSummary = surface.color
    ? formatGndDiagnosticVector(surface.color.slice(0, 3))
    : '—';
  let sourceTexture = null;
  if (entry) {
    sourceTexture = entry.object.userData.rooGndDiffuseSourceTexture || null;
    const colorAttribute = entry.object.geometry.getAttribute('color');
    if (colorAttribute) {
      const base = entry.quadIndex * 4;
      const colours = [];
      for (let corner = 0; corner < 4; corner++) {
        const at = base + corner;
        if (at >= colorAttribute.count) break;
        colours.push([
          colorAttribute.getX(at), colorAttribute.getY(at), colorAttribute.getZ(at),
        ]);
      }
      if (colours.length) {
        tintSummary = formatGndDiagnosticVector([0, 1, 2].map(channel =>
          colours.reduce((sum, colour) => sum + colour[channel], 0) / colours.length
        ));
      }
    }
  }
  let diffuseCenter = '未載入／不可取樣';
  if (bounds && sourceTexture) {
    diffuseCenter = sampleGndSourceTexturePixel(sourceTexture, [
      (bounds.minU + bounds.maxU) * 0.5,
      (bounds.minV + bounds.maxV) * 0.5,
    ], bounds, entry ? entry.object.userData.rooGndDiffuseSourcePixelRect : null);
  }
  let lightSummary = '無有效 lightmap';
  const slices = gnd.lightmapSlices;
  if (Number.isInteger(surface.lightmapIndex) && surface.lightmapIndex >= 0
    && Array.isArray(slices) && surface.lightmapIndex < slices.length) {
    const slice = slices[surface.lightmapIndex];
    const x = slice.width >= 4 ? Math.max(1, Math.min(slice.width - 2, Math.floor(slice.width / 2)))
      : Math.floor(slice.width / 2);
    const y = slice.height >= 4 ? Math.max(1, Math.min(slice.height - 2, Math.floor(slice.height / 2)))
      : Math.floor(slice.height / 2);
    const channels = slice.channels || 4;
    const offset = (y * slice.width + x) * channels;
    const rgb = Array.from(slice.colorPixels.slice(offset, offset + 3));
    const ao = slice.shadowPixels ? slice.shadowPixels[y * slice.width + x]
      : channels === 4 ? slice.colorPixels[offset + 3] : 255;
    lightSummary = 'RGB (' + rgb.join(', ') + '); AO ' + ao + ' @ (' + x + ', ' + y + ')';
  }
  const uvSummary = bounds
    ? 'U[' + bounds.minU.toFixed(3) + ',' + bounds.maxU.toFixed(3) + ']'
      + ' V[' + bounds.minV.toFixed(3) + ',' + bounds.maxV.toFixed(3) + ']'
    : 'UV 無效';
  const textureName = gnd.textures[surface.textureIndex] || '(無 diffuse)';
  return 'Surface #' + surfaceIndex + ' tex#' + surface.textureIndex + ' ' + textureName
    + '；' + uvSummary + '；頂點色平均 RGB (' + tintSummary + ')'
    + '；diffuse 中心 ' + diffuseCenter
    + '；lightmap#' + surface.lightmapIndex + ' ' + lightSummary;
}

function describeGndAdjacentTopSurfaces(gnd, surfaceIndex, root) {
  const uses = getGndSurfaceUseLookup(gnd).get(surfaceIndex) || [];
  const origin = uses.find(use => use.side === 'top');
  if (!origin) return ['相鄰 TOP surface：此面未被任何 cube 當作 top（可能是牆面），不猜測相鄰關係。'];
  const meshLookup = getGndSurfaceMeshLookup(root);
  const neighbors = [
    { label: '西', x: origin.x - 1, y: origin.y },
    { label: '東', x: origin.x + 1, y: origin.y },
    { label: '南', x: origin.x, y: origin.y - 1 },
    { label: '北', x: origin.x, y: origin.y + 1 },
  ];
  return [
    '相鄰 TOP surface 對照（GND cube x=' + origin.x + ', y=' + origin.y + '）：',
    ...neighbors.map(neighbor => {
      if (neighbor.x < 0 || neighbor.y < 0
        || neighbor.x >= gnd.width || neighbor.y >= gnd.height) {
        return '  ' + neighbor.label + '：地圖邊界，沒有相鄰 cube';
      }
      const cube = gnd.cubes[neighbor.x + neighbor.y * gnd.width];
      if (!cube || !Number.isInteger(cube.topSurface) || cube.topSurface < 0) {
        return '  ' + neighbor.label + '：無 TOP surface';
      }
      return '  ' + neighbor.label + '：' + describeGndSurfaceForComparison(
        gnd, cube.topSurface, meshLookup
      );
    }),
  ];
}

function updateGndSurfaceInspector(event) {
  if (GND_DEBUG_MODE_UNIFORM.value === 0) {
    gndSurfaceInspector.hidden = true;
    pendingGndInspectorReadback = null;
    return;
  }

  gndSurfaceInspector.hidden = false;
  if (!mapRoot || !gndInfo || !event) {
    gndSurfaceInspectorContent.textContent = '請先載入原生 GND 地圖，再把滑鼠移到地表。';
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(mapRoot, true);
  const hit = hits[0];
  if (!hit || !hit.object || !hit.object.userData.rooTerrainSurface
    || !Number.isInteger(hit.faceIndex) || !hit.uv) {
    gndSurfaceInspectorContent.textContent = hits.length
      ? '游標目前先命中模型或水面，地表被遮住；請移到真正可見的地面或牆面。'
      : '目前游標沒有命中場景中的地表；請移到可見的地面或牆面。';
    pendingGndInspectorReadback = null;
    return;
  }

  const object = hit.object;
  const quadIndex = Math.floor(hit.faceIndex / 2);
  const surfaceIndices = object.userData.rooGndSurfaceIndices || [];
  const surfaceIndex = surfaceIndices[quadIndex];
  const surface = Number.isInteger(surfaceIndex) ? gndInfo.surfaces[surfaceIndex] : null;
  if (!surface) {
    gndSurfaceInspectorContent.textContent = '已命中地表網格，但無法對應回原始 GND surface。'
      + '\nmesh=' + object.name + '；triangle=' + hit.faceIndex + '；quad=' + quadIndex;
    pendingGndInspectorReadback = null;
    return;
  }

  const geometry = object.geometry;
  const uvAttribute = geometry.getAttribute('uv');
  const sourceUvAttribute = geometry.getAttribute('rooGndSourceUv');
  const colorAttribute = geometry.getAttribute('color');
  const baseVertex = quadIndex * 4;
  const actualUvs = [];
  const sourceUvs = [];
  const actualColors = [];
  for (let corner = 0; corner < 4; corner++) {
    const vertexIndex = baseVertex + corner;
    actualUvs.push(uvAttribute
      ? [uvAttribute.getX(vertexIndex), uvAttribute.getY(vertexIndex)] : [NaN, NaN]);
    sourceUvs.push(sourceUvAttribute
      ? [sourceUvAttribute.getX(vertexIndex), sourceUvAttribute.getY(vertexIndex)]
      : surface.uv && surface.uv[corner] || [NaN, NaN]);
    actualColors.push(colorAttribute
      ? [colorAttribute.getX(vertexIndex), colorAttribute.getY(vertexIndex), colorAttribute.getZ(vertexIndex)]
      : [1, 1, 1]);
  }

  const texture = object.userData.rooGndDiffuseSourceTexture
    || object.material && object.material.map;
  const textureName = gndInfo.textures[surface.textureIndex] || object.userData.rooGndTextureName || '(未指定)';
  const uvLines = sourceUvs.map((sourceUv, corner) => (
    '  幾何角 ' + corner + ': 原始來源 UV (' + formatGndDiagnosticVector(sourceUv) + ')；'
      + 'GPU 分區 UV (' + formatGndDiagnosticVector(actualUvs[corner]) + ')；來源取樣 '
      + sampleGndSourceTexturePixel(texture, sourceUv, object.userData.rooGndDiffuseUvRect,
        object.userData.rooGndDiffuseSourcePixelRect)
  ));
  const colorLines = actualColors.map((color, corner) => (
    '  幾何角 ' + corner + ': RGB (' + formatGndDiagnosticVector(color) + ')'
  ));
  const lightmapLines = [0, 1, 2, 3].map(corner => {
    const label = ['SW', 'SE', 'NW', 'NE'][corner];
    const atlasUv = getGndLightmapAtlasUvForCorner(surface, corner);
    const expected = atlasUv ? sampleGndLightmapSourceAtUv(surface, atlasUv) : null;
    return '  ' + label + ': 來源有效角落 texel ' + sampleGndLightmapSourceCorner(surface, corner)
      + (atlasUv && expected
        ? '; atlas UV (' + formatGndDiagnosticVector(atlasUv) + ')'
          + '; GPU LOD0 預期 RGB (' + expected.filteredRgb.join(', ') + ')'
          + ' AO ' + expected.filteredAo + '，參與 texel 約 (' + expected.samplePosition.join(', ') + ')'
        : '');
  });
  const cursorLightmapUv = sampleGndAttributeAtHit(hit, 'uv2');
  const cursorVertexColor = sampleGndAttributeAtHit(hit, 'color');
  const cursorSourceUv = sampleGndAttributeAtHit(hit, 'rooGndSourceUv')
    || [hit.uv.x, hit.uv.y];
  const cursorLightmapSample = cursorLightmapUv
    ? sampleGndLightmapSourceAtUv(surface, cursorLightmapUv) : null;
  const adjacentSurfaceLines = describeGndAdjacentTopSurfaces(gndInfo, surfaceIndex, mapRoot);
  const samplerDescription = sampler => {
    if (!sampler) return '未啟用';
    const filterName = value => value === THREE.LinearFilter ? 'LinearFilter'
      : value === THREE.NearestFilter ? 'NearestFilter' : 'mipmap filter (' + value + ')';
    const colorSpaceName = sampler.colorSpace === THREE.NoColorSpace ? 'NoColorSpace'
      : sampler.colorSpace === THREE.SRGBColorSpace ? 'SRGBColorSpace'
        : String(sampler.colorSpace || 'default');
    return 'mipmap=' + (sampler.generateMipmaps ? 'on' : 'off')
      + '; min=' + filterName(sampler.minFilter)
      + '; mag=' + filterName(sampler.magFilter)
      + '; colorSpace=' + colorSpaceName;
  };
  const modeSelect = document.getElementById('gnd-debug-mode');
  const debugModeLabel = modeSelect && modeSelect.options[modeSelect.selectedIndex]
    ? modeSelect.options[modeSelect.selectedIndex].textContent : '未知';
  const detail = [
    '目前診斷模式：' + GND_DEBUG_MODE_UNIFORM.value + '／' + debugModeLabel,
    '地圖：' + (mapInfo && mapInfo.mapId || '未知'),
    'Surface #' + surfaceIndex + '；triangle #' + hit.faceIndex + '；quad #' + quadIndex,
    '真實材質路徑：' + textureName,
    '實際載入 URL：' + (object.userData.rooGndTextureUrl || '無；使用純色備援'),
    'Diffuse 貼圖採樣：' + samplerDescription(object.userData.rooGndDiffuseSampler),
    'RGB lightmap/AO 採樣：' + samplerDescription(object.userData.rooGndLightmapSampler),
    '材質索引：' + surface.textureIndex + '；lightmap 索引：' + surface.lightmapIndex,
    'diffuse 原始 UV 範圍：' + (object.userData.rooGndDiffuseUvRect
      ? 'U[' + object.userData.rooGndDiffuseUvRect.minU.toFixed(4) + ','
        + object.userData.rooGndDiffuseUvRect.maxU.toFixed(4) + '] V['
        + object.userData.rooGndDiffuseUvRect.minV.toFixed(4) + ','
        + object.userData.rooGndDiffuseUvRect.maxV.toFixed(4) + ']'
      : '完整來源／Repeat UV'),
    '游標處原始來源 UV：(' + formatGndDiagnosticVector(cursorSourceUv) + ')；'
      + 'GPU 分區 UV：(' + formatGndDiagnosticVector([hit.uv.x, hit.uv.y]) + ')',
    '游標處 diffuse 來源座標／LOD0 線性預估：' + sampleGndSourceTexturePixel(
      texture, cursorSourceUv, object.userData.rooGndDiffuseUvRect,
      object.userData.rooGndDiffuseSourcePixelRect
    ),
    'GPU 使用的 diffuse crop 像素範圍：' + (object.userData.rooGndDiffuseSourcePixelRect
      ? JSON.stringify(object.userData.rooGndDiffuseSourcePixelRect) : '完整來源貼圖'),
    '游標處插值頂點色 RGB：' + (cursorVertexColor
      ? '(' + formatGndDiagnosticVector(cursorVertexColor.slice(0, 3)) + ')'
      : '無法取得'),
    ...adjacentSurfaceLines,
    '游標處 Lightmap atlas UV2：' + (cursorLightmapUv
      ? '(' + formatGndDiagnosticVector(cursorLightmapUv) + ')' : '無法取得'),
    '游標處來源 RGB lightmap / AO 最近像素（原始 GND bytes）：'
      + (cursorLightmapSample
        ? 'RGB (' + cursorLightmapSample.rgb.join(', ') + '); AO ' + cursorLightmapSample.ao
          + ' @ (' + cursorLightmapSample.x + ', ' + cursorLightmapSample.y + ')'
        : '無法取樣'),
    '游標處 RGB lightmap / AO 預期 GPU LOD0 線性取樣（RGB 已套用 RO 16階量化）：'
      + (cursorLightmapSample
        ? 'RGB (' + cursorLightmapSample.filteredRgb.join(', ') + '); AO '
          + cursorLightmapSample.filteredAo + ' @ texel ('
          + cursorLightmapSample.samplePosition.join(', ') + ')'
        : '無法取樣'),
    '原始 RGB lightmap / AO 四角取樣（來源 GND 像素，不是渲染猜測）：',
    ...lightmapLines,
    '原始四角 UV（UV0..UV3）：',
    ...(surface.uv || []).map((uv, index) => '  UV' + index + ': (' + formatGndDiagnosticVector(uv) + ')'),
    '實際 GPU 分區 UV（含半像素內縮）與對應來源貼圖像素：',
    ...uvLines,
    '實際傳入 GPU 的逐角頂點色 RGB：',
    ...colorLines,
    'GPU 最終畫面取樣 RGBA：等待下一個渲染影格。',
  ].join('\n');
  gndSurfaceInspectorContent.textContent = detail;

  const ratio = renderer.getPixelRatio();
  pendingGndInspectorReadback = {
    x: Math.floor((event.clientX - rect.left) * ratio),
    y: Math.floor((rect.bottom - event.clientY) * ratio),
    detail,
  };
}

function sampleGndInspectorFramebuffer() {
  const pending = pendingGndInspectorReadback;
  if (!pending || gndSurfaceInspector.hidden) return;
  pendingGndInspectorReadback = null;
  const gl = renderer.getContext();
  if (gl.drawingBufferWidth < 1 || gl.drawingBufferHeight < 1) return;
  const x = Math.max(0, Math.min(gl.drawingBufferWidth - 1, pending.x));
  const y = Math.max(0, Math.min(gl.drawingBufferHeight - 1, pending.y));
  const pixel = new Uint8Array(4);
  try {
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gndSurfaceInspectorContent.textContent = pending.detail
      + '\nGPU 最終畫面取樣 RGBA：(' + pixel[0] + ', ' + pixel[1] + ', '
      + pixel[2] + ', ' + pixel[3] + ') @ (' + x + ', ' + y + ')';
  } catch (error) {
    gndSurfaceInspectorContent.textContent = pending.detail
      + '\nGPU 最終畫面取樣失敗：'
      + (error && error.message ? error.message : String(error));
  }
}

document.getElementById('recenter').addEventListener('click', () => {
  fitCamera(false);
  if (followPlayerInput.checked) focusCameraOnPlayer();
  setStatus('已重置視角。');
});
document.getElementById('gnd-debug-mode').addEventListener('change', event => {
  const selected = event.currentTarget;
  const mode = Number(selected.value);
  GND_DEBUG_MODE_UNIFORM.value = Number.isInteger(mode) && mode >= 0 && mode <= 8 ? mode : 0;
  const label = selected.options[selected.selectedIndex]?.textContent || '完整合成';
  setStatus('GND 診斷模式：' + label + '。僅供分離材質通道排查；按「完整合成」回到一般地表畫面。');
  if (GND_DEBUG_MODE_UNIFORM.value !== 0) {
    gndSurfaceInspector.hidden = false;
    gndSurfaceInspectorContent.textContent = '把滑鼠移到地表，即可查看目前模式的 GPU 像素，以及 Diffuse／頂點色／AO／RGB lightmap 的來源取樣。';
    if (lastGndDiagnosticPointer) updateGndSurfaceInspector(lastGndDiagnosticPointer);
  } else {
    gndSurfaceInspector.hidden = true;
    pendingGndInspectorReadback = null;
  }
});
let pointerOrigin = null;
let pointerDragged = false;
renderer.domElement.addEventListener('pointerdown', event => {
  pointerOrigin = { x: event.clientX, y: event.clientY };
  pointerDragged = false;
});
renderer.domElement.addEventListener('pointermove', event => {
  lastGndDiagnosticPointer = { clientX: event.clientX, clientY: event.clientY };
  updateGndSurfaceInspector(lastGndDiagnosticPointer);
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
  if (!wasDrag) {
    const monster = monsterHitFromEvent(event);
    if (monster) selectRoExplorerMonster(monster);
    else requestWalk(event);
  }
});

function refreshAnimatedMonsterTextures(now) {
  if (now - lastMonsterTextureUploadAt < 110) return;
  lastMonsterTextureUploadAt = now;
  monsterTextureSet.forEach(texture => { texture.needsUpdate = true; });
}

const stopRenderLoop = createVisibilityAwareFrameLoop(
  document,
  now => {
    const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
    lastFrame = now;
    advanceMovement(delta);
    if (queuedCombatSkill && !pendingCombatRequest && !movementPath && currentCell) {
      const queued = queuedCombatSkill;
      const distance = Math.max(Math.abs(currentCell.x - queued.entry.cell.x), Math.abs(currentCell.y - queued.entry.cell.y));
      queuedCombatSkill = null;
      if (!queued.entry.dead && monsterEntries.includes(queued.entry) && distance <= 1) {
        sendRoExplorerSkillRequest(queued.entry, queued.skill);
      } else if (!queued.entry.dead && monsterEntries.includes(queued.entry)) {
        setStatus('移動未抵達技能施放距離，請重新選取目標後施放。', true);
      }
    }
    if (activeCombatTarget && !activeCombatTarget.dead && !pendingCombatRequest && !movementPath
      && currentCell && Math.max(Math.abs(currentCell.x - activeCombatTarget.cell.x), Math.abs(currentCell.y - activeCombatTarget.cell.y)) <= 1
      && now >= nextCombatAt) requestRoExplorerCombatAttack(activeCombatTarget);
    advanceNativeWater(now);
    advanceRsmAnimations(now);
    refreshAnimatedPlayerTexture(now);
    refreshAnimatedMonsterTextures(now);
    controls.update();
    updateRoExplorerCombatFeedback(now);
    if (ro2dActive) renderRoExplorer2DFrame(now);
    else {
      renderer.render(scene, camera);
      sampleGndInspectorFramebuffer();
    }
  },
  callback => window.requestAnimationFrame(callback),
  frameId => window.cancelAnimationFrame(frameId)
);


function buildGndAuditMipPyramid(texture) {
  const image = texture && texture.image;
  const width = image && (image.naturalWidth || image.videoWidth || image.width);
  const height = image && (image.naturalHeight || image.videoHeight || image.height);
  if (!image || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error('diffuse 原始影像尚未就緒。');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('無法讀取 diffuse 來源像素。');
  context.drawImage(image, 0, 0, width, height);
  const levels = [{ width, height, data: context.getImageData(0, 0, width, height).data }];
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) {
    const src = levels[levels.length - 1];
    const w = Math.max(1, Math.floor(src.width / 2));
    const h = Math.max(1, Math.floor(src.height / 2));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(src.width - 1, x * 2 + dx);
        const sy = Math.min(src.height - 1, y * 2 + dy);
        sum += src.data[(sy * src.width + sx) * 4 + c];
      }
      data[(y * w + x) * 4 + c] = Math.round(sum / 4);
    }
    levels.push({ width: w, height: h, data });
  }
  return levels;
}

function sampleGndAuditMip(levels, uv, lod, wrapS = true, wrapT = true) {
  const sampleLevel = level => {
    const image = levels[level];
    const axis = (coordinate, size, repeat) => {
      const position = coordinate * size - 0.5;
      const filtered = repeat ? position : Math.max(0, Math.min(size - 1, position));
      const lower = Math.floor(filtered);
      const wrapIndex = value => repeat
        ? ((value % size) + size) % size
        : Math.max(0, Math.min(size - 1, value));
      return { lower: wrapIndex(lower), upper: wrapIndex(lower + 1), weight: filtered - lower };
    };
    const x = axis(uv[0], image.width, wrapS);
    const y = axis(1 - uv[1], image.height, wrapT);
    return [0, 1, 2].map(c => {
      const at = (px, py) => image.data[(py * image.width + px) * 4 + c];
      const top = at(x.lower, y.lower) * (1 - x.weight) + at(x.upper, y.lower) * x.weight;
      const bottom = at(x.lower, y.upper) * (1 - x.weight) + at(x.upper, y.upper) * x.weight;
      return top * (1 - y.weight) + bottom * y.weight;
    });
  };
  const value = Math.max(0, Math.min(levels.length - 1, lod));
  const low = Math.floor(value), high = Math.min(levels.length - 1, low + 1), mix = value - low;
  const a = sampleLevel(low), b = sampleLevel(high);
  return a.map((channel, index) => Number((channel * (1 - mix) + b[index] * mix).toFixed(3)));
}

function findGndSharedUvAuditPairs() {
  if (!mapRoot || !gndInfo || !Array.isArray(gndInfo.cubes) || !Array.isArray(gndInfo.surfaces)) {
    return { status: 'pending', reason: '原生 GND 尚未載入。' };
  }
  mapRoot.updateMatrixWorld(true);
  const entriesBySurface = new Map();
  mapRoot.traverse(object => {
    const indices = object.userData && object.userData.rooGndSurfaceIndices;
    if (!object.userData.rooTerrainSurface || !Array.isArray(indices)) return;
    indices.forEach((surfaceIndex, quadIndex) => {
      if (!entriesBySurface.has(surfaceIndex)) entriesBySurface.set(surfaceIndex, []);
      entriesBySurface.get(surfaceIndex).push({ object, quadIndex, surfaceIndex });
    });
  });
  const rect = surface => {
    if (!surface || !Array.isArray(surface.uv) || surface.uv.length !== 4) return null;
    const us = surface.uv.map(v => v[0]), vs = surface.uv.map(v => v[1]);
    const r = { minU: Math.min(...us), maxU: Math.max(...us), minV: Math.min(...vs), maxV: Math.max(...vs) };
    return [r.minU, r.maxU, r.minV, r.maxV].every(Number.isFinite)
      && r.maxU - r.minU > 1e-6 && r.maxV - r.minV > 1e-6 ? r : null;
  };
  const equalVec = (a, b, e) => a && b && a.length === b.length
    && a.every((v, i) => Math.abs(v - b[i]) <= e);
  const cornerData = (entry, name) => {
    const attr = entry.object.geometry.getAttribute(name);
    if (!attr || attr.count < (entry.quadIndex + 1) * 4) return null;
    return [0, 1, 2, 3].map(c => {
      const i = entry.quadIndex * 4 + c;
      if (name === 'position') {
        return entry.object.localToWorld(new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i))).toArray();
      }
      return Array.from({ length: attr.itemSize }, (_, component) => {
        if (component === 0) return attr.getX(i);
        if (component === 1) return attr.getY(i);
        if (component === 2) return attr.getZ(i);
        if (component === 3) return attr.getW(i);
        return 0;
      });
    });
  };
  const meanVector = values => {
    if (!values || !values.length) return null;
    return values[0].map((_, component) =>
      values.reduce((sum, value) => sum + value[component], 0) / values.length);
  };
  const maxVectorDelta = (a, b) => a && b && a.length === b.length
    ? Math.max(...a.map((value, i) => Math.abs(value - b[i]))) : null;
  const meanRgb = colors => {
    const mean = meanVector(colors);
    return mean ? mean.slice(0, 3) : null;
  };
  const uvRectKey = value => [value.minU, value.maxU, value.minV, value.maxV]
    .map(number => number.toFixed(5)).join(',');
  const candidates = [];
  const seen = new Set();
  const attempt = (axis, x, y, aCube, bCube) => {
    const ia = aCube && aCube.topSurface, ib = bCube && bCube.topSurface;
    if (!Number.isInteger(ia) || !Number.isInteger(ib) || ia < 0 || ib < 0 || ia === ib) return null;
    const sa = gndInfo.surfaces[ia], sb = gndInfo.surfaces[ib];
    if (!sa || !sb || sa.textureIndex < 0 || sa.textureIndex !== sb.textureIndex
      || !Number.isInteger(sa.lightmapIndex) || sa.lightmapIndex < 0
      || !Number.isInteger(sb.lightmapIndex) || sb.lightmapIndex < 0) return null;
    const ra = rect(sa), rb = rect(sb);
    if (!ra || !rb || (Math.abs(ra.minU - rb.minU) < 1e-6
      && Math.abs(ra.maxU - rb.maxU) < 1e-6 && Math.abs(ra.minV - rb.minV) < 1e-6
      && Math.abs(ra.maxV - rb.maxV) < 1e-6)) return null;
    if (Math.abs((ra.maxU - ra.minU) - (rb.maxU - rb.minU)) > 1e-6
      || Math.abs((ra.maxV - ra.minV) - (rb.maxV - rb.minV)) > 1e-6) return null;
    const corners = axis === 'east' ? { a: [1, 3], b: [0, 2] } : { a: [2, 3], b: [0, 1] };
    const sharedSourceUv = corners.a.every((c, i) =>
      equalVec(sa.uv[c], sb.uv[corners.b[i]], 1e-6));
    const wrapAxis = axis === 'east' ? 'u' : 'v';
    const repeatWrapBoundary = !sharedSourceUv && corners.a.every((c, i) => {
      const uvA = sa.uv[c], uvB = sb.uv[corners.b[i]];
      return wrapAxis === 'u'
        ? Math.abs(Math.abs(uvA[0] - uvB[0]) - 1) <= 1e-6 && Math.abs(uvA[1] - uvB[1]) <= 1e-6
        : Math.abs(uvA[0] - uvB[0]) <= 1e-6 && Math.abs(Math.abs(uvA[1] - uvB[1]) - 1) <= 1e-6;
    });
    if (!sharedSourceUv && !repeatWrapBoundary) return null;
    for (const ea of entriesBySurface.get(ia) || []) for (const eb of entriesBySurface.get(ib) || []) {
      const ma = Array.isArray(ea.object.material) ? ea.object.material[0] : ea.object.material;
      const mb = Array.isArray(eb.object.material) ? eb.object.material[0] : eb.object.material;
      const srcA = ea.object.userData.rooGndDiffuseSourceTexture;
      const srcB = eb.object.userData.rooGndDiffuseSourceTexture;
      const cropA = ea.object.userData.rooGndDiffuseSourcePixelRect;
      const cropB = eb.object.userData.rooGndDiffuseSourcePixelRect;
      if (!ma || !mb || !ma.map || !mb.map || !cropA || !cropB
        || !srcA || !srcB || !srcA.image || srcA.image !== srcB.image
        || !(ma.map.generateMipmaps || Array.isArray(ma.map.mipmaps) && ma.map.mipmaps.length > 1)
        || !(mb.map.generateMipmaps || Array.isArray(mb.map.mipmaps) && mb.map.mipmaps.length > 1)
        || ma.map.minFilter !== THREE.LinearMipmapLinearFilter
        || mb.map.minFilter !== THREE.LinearMipmapLinearFilter) continue;
      const pa = cornerData(ea, 'position'), pb = cornerData(eb, 'position');
      const ua = cornerData(ea, 'rooGndSourceUv'), ub = cornerData(eb, 'rooGndSourceUv');
      const ca = cornerData(ea, 'color'), cb = cornerData(eb, 'color');
      const na = cornerData(ea, 'rooGndVertexNormal'), nb = cornerData(eb, 'rooGndVertexNormal');
      const uv2a = cornerData(ea, 'uv2'), uv2b = cornerData(eb, 'uv2');
      if (!pa || !pb || !ua || !ub || !ca || !cb || !na || !nb || !uv2a || !uv2b) continue;
      if (!corners.a.every((c, i) => {
        const uvA = ua[c], uvB = ub[corners.b[i]];
        const sourceUvMatches = sharedSourceUv
          ? equalVec(uvA, uvB, 1e-6)
          : wrapAxis === 'u'
            ? Math.abs(Math.abs(uvA[0] - uvB[0]) - 1) <= 1e-6 && Math.abs(uvA[1] - uvB[1]) <= 1e-6
            : Math.abs(uvA[0] - uvB[0]) <= 1e-6 && Math.abs(Math.abs(uvA[1] - uvB[1]) - 1) <= 1e-6;
        return equalVec(pa[c], pb[corners.b[i]], 1e-5) && sourceUvMatches;
      })) continue;
      // These pairs share the same real 3D edge. Their normals must remain
      // identical even if texture/UV splitting placed the quads in different meshes.
      const sharedEdgeNormalMaxDelta = Math.max(...corners.a.map((c, i) =>
        maxVectorDelta(na[c], nb[corners.b[i]])));
      const key = axis + ':' + ia + ':' + ib + ':' + uvRectKey(ra) + ':' + uvRectKey(rb);
      if (seen.has(key)) continue;
      seen.add(key);
      const edgeColorsA = corners.a.map(c => ca[c].slice(0, 3));
      const edgeColorsB = corners.b.map(c => cb[c].slice(0, 3));
      const sharedEdgeVertexColorDelta = Math.max(...edgeColorsA.map((color, i) =>
        maxVectorDelta(color, edgeColorsB[i])));
      const meanColorA = meanRgb(ca), meanColorB = meanRgb(cb);
      const centerLightmapA = sampleGndLightmapSourceAtUv(sa, meanVector(uv2a));
      const centerLightmapB = sampleGndLightmapSourceAtUv(sb, meanVector(uv2b));
      const edgeLightmapA = sampleGndLightmapSourceAtUv(sa,
        meanVector(corners.a.map(corner => uv2a[corner])));
      const edgeLightmapB = sampleGndLightmapSourceAtUv(sb,
        meanVector(corners.b.map(corner => uv2b[corner])));
      if (!centerLightmapA || !centerLightmapB || !edgeLightmapA || !edgeLightmapB) continue;
      const vertexColorMeanDelta = maxVectorDelta(meanColorA, meanColorB);
      const aoDelta = Math.abs(centerLightmapA.filteredAo - centerLightmapB.filteredAo);
      const rgbLightmapDelta = maxVectorDelta(centerLightmapA.filteredRgb, centerLightmapB.filteredRgb);
      const edgeRgbMax = Math.max(...edgeLightmapA.filteredRgb, ...edgeLightmapB.filteredRgb);
      const edgeRgbSignal = [...edgeLightmapA.filteredRgb, ...edgeLightmapB.filteredRgb]
        .reduce((sum, value) => sum + value, 0);
      const edgeRgbChroma = rgb => Math.max(...rgb) - Math.min(...rgb);
      const edgeRgbColorVariation = Math.max(
        edgeRgbChroma(edgeLightmapA.filteredRgb),
        edgeRgbChroma(edgeLightmapB.filteredRgb),
        maxVectorDelta(edgeLightmapA.filteredRgb, edgeLightmapB.filteredRgb),
        rgbLightmapDelta
      );
      candidates.push({
        status: 'ready', axis, grid: [x, y], surfaceIndexA: ia, surfaceIndexB: ib,
        surfaceA: sa, surfaceB: sb, entryA: ea, entryB: eb, rectA: ra, rectB: rb,
        corners, sharedSourceUv, wrapBoundary: repeatWrapBoundary
          ? { axis: wrapAxis, surfaceEdgeA: corners.a.map(c => sa.uv[c]),
            surfaceEdgeB: corners.b.map(c => sb.uv[c]), repeatEquivalent: true }
          : null,
        sharedUv: sharedSourceUv ? corners.a.map((c, i) => sa.uv[c]) : null,
        sourceTexture: srcA, cropA, cropB,
        coverage: {
          uvRegionKey: uvRectKey(ra) + '|' + uvRectKey(rb),
          lightmapIndices: [sa.lightmapIndex, sb.lightmapIndex],
          meanVertexColorA: meanColorA.map(v => Number(v.toFixed(4))),
          meanVertexColorB: meanColorB.map(v => Number(v.toFixed(4))),
          vertexColorMeanDelta: Number(vertexColorMeanDelta.toFixed(4)),
          sharedEdgeVertexColorDelta: Number(sharedEdgeVertexColorDelta.toFixed(4)),
          sharedEdgeNormalMaxDelta: Number(sharedEdgeNormalMaxDelta.toFixed(8)),
          sharedEdgeNormalCount: corners.a.length,
          centerLightmapA: {
            rgb: centerLightmapA.filteredRgb, ao: centerLightmapA.filteredAo,
            samplePosition: centerLightmapA.samplePosition,
          },
          centerLightmapB: {
            rgb: centerLightmapB.filteredRgb, ao: centerLightmapB.filteredAo,
            samplePosition: centerLightmapB.samplePosition,
          },
          edgeLightmapA: {
            rgb: edgeLightmapA.filteredRgb, ao: edgeLightmapA.filteredAo,
            samplePosition: edgeLightmapA.samplePosition,
          },
          edgeLightmapB: {
            rgb: edgeLightmapB.filteredRgb, ao: edgeLightmapB.filteredAo,
            samplePosition: edgeLightmapB.samplePosition,
          },
          hasNonzeroEdgeRgbLightmap: edgeRgbMax >= 16,
          edgeRgbSignal: Number(edgeRgbSignal.toFixed(3)),
          edgeRgbColorVariation: Number(edgeRgbColorVariation.toFixed(3)),
          aoDelta: Number(aoDelta.toFixed(3)),
          rgbLightmapDelta: Number(rgbLightmapDelta.toFixed(3)),
          selectedFor: [],
        },
      });
      return candidates[candidates.length - 1];
    }
    return null;
  };
  for (let y = 0; y < gndInfo.height; y++) for (let x = 0; x < gndInfo.width; x++) {
    const index = y * gndInfo.width + x, cube = gndInfo.cubes[index];
    if (!cube || cube.topSurface < 0) continue;
    if (x + 1 < gndInfo.width) attempt('east', x, y, cube, gndInfo.cubes[index + 1]);
    if (y + 1 < gndInfo.height) attempt('north', x, y, cube, gndInfo.cubes[index + gndInfo.width]);
  }
  if (!candidates.length) {
    return { status: 'pending', reason: '尚未找到貼圖已載入、幾何邊、來源 UV 與光照來源均可核對的相鄰裁切面。' };
  }
  const selected = [];
  const selectedKeys = new Set();
  const maxPairs = mapInfo && mapInfo.mapId === 'tra_fild' ? 9 : 6;
  const addBest = (label, predicate, score) => {
    if (selected.length >= maxPairs) return;
    const options = candidates.filter(pair => !selectedKeys.has(pair)
      && predicate(pair)).sort((a, b) => score(b) - score(a)
        || a.grid[1] - b.grid[1] || a.grid[0] - b.grid[0]);
    if (!options.length) return;
    selected.push(options[0]);
    selectedKeys.add(options[0]);
    options[0].coverage.selectedFor.push(label);
  };
  // First capture the requested tra_fild streak surfaces. #9965/#9967 share U=.75;
  // #9967/#9969 cross U=1/0 and #9844/#9967 cross V=1/0.
  if (mapInfo && mapInfo.mapId === 'tra_fild') {
    const hasSurfaces = (pair, a, b) => [pair.surfaceIndexA, pair.surfaceIndexB].includes(a)
      && [pair.surfaceIndexA, pair.surfaceIndexB].includes(b);
    addBest('tra_fild Surface #9965 ↔ #9967 shared UV',
      pair => hasSurfaces(pair, 9965, 9967) && !pair.wrapBoundary, () => 1e9);
    addBest('tra_fild Surface #9967 ↔ #9969 repeat U boundary',
      pair => hasSurfaces(pair, 9967, 9969) && pair.wrapBoundary && pair.wrapBoundary.axis === 'u', () => 1e9);
    addBest('tra_fild Surface #9844 ↔ #9967 repeat V boundary',
      pair => hasSurfaces(pair, 9844, 9967) && pair.wrapBoundary && pair.wrapBoundary.axis === 'v', () => 1e9);
  }
  // Use remaining slots for contrast and broader neighboring-surface coverage.
  addBest('非零 RGB＋AO 強對比', pair => pair.coverage.hasNonzeroEdgeRgbLightmap
    && pair.coverage.aoDelta >= 8,
  pair => pair.coverage.edgeRgbColorVariation * 2 + pair.coverage.edgeRgbSignal
    + pair.coverage.aoDelta * 2 + pair.coverage.rgbLightmapDelta);
  addBest('RGB 色彩變化最大', pair => pair.coverage.hasNonzeroEdgeRgbLightmap,
    pair => pair.coverage.edgeRgbColorVariation * 2 + pair.coverage.edgeRgbSignal);
  addBest('UV 東向', pair => pair.axis === 'east',
    pair => pair.coverage.aoDelta + pair.coverage.rgbLightmapDelta + pair.coverage.vertexColorMeanDelta * 255);
  addBest('UV 北向', pair => pair.axis === 'north',
    pair => pair.coverage.aoDelta + pair.coverage.rgbLightmapDelta + pair.coverage.vertexColorMeanDelta * 255);
  addBest('AO 差異', pair => pair.coverage.aoDelta >= 8, pair => pair.coverage.aoDelta);
  addBest('頂點色差異', pair => pair.coverage.vertexColorMeanDelta >= 0.04,
    pair => pair.coverage.vertexColorMeanDelta);
  const diversityScore = pair => pair.coverage.aoDelta / 255
    + pair.coverage.rgbLightmapDelta / 255
    + pair.coverage.vertexColorMeanDelta;
  const remainder = candidates.filter(pair => !selectedKeys.has(pair))
    .sort((a, b) => diversityScore(b) - diversityScore(a)
      || a.grid[1] - b.grid[1] || a.grid[0] - b.grid[0]);
  for (const pair of remainder) {
    if (selected.length >= maxPairs) break;
    if (selected.some(existing => existing.axis === pair.axis
      && existing.surfaceIndexA === pair.surfaceIndexA && existing.surfaceIndexB === pair.surfaceIndexB)) continue;
    pair.coverage.selectedFor.push('補足樣本');
    selected.push(pair);
    selectedKeys.add(pair);
  }
  return { status: 'ready', candidateCount: candidates.length, pairs: selected };
}
function buildGndAuditQuad(entry) {
  const source = entry.object.geometry, geometry = new THREE.BufferGeometry(), start = entry.quadIndex * 4;
  for (const name of Object.keys(source.attributes)) {
    const input = source.getAttribute(name);
    if (!input || input.count < start + 4) continue;
    const Ctor = input.array.constructor, values = new Ctor(4 * input.itemSize);
    for (let c = 0; c < 4; c++) {
      const from = (start + c) * input.itemSize;
      values.set(input.array.subarray(from, from + input.itemSize), c * input.itemSize);
    }
    if (name === 'position') {
      const point = new THREE.Vector3();
      for (let c = 0; c < 4; c++) {
        const at = c * 3;
        point.set(values[at], values[at + 1], values[at + 2]);
        entry.object.localToWorld(point);
        values[at] = point.x; values[at + 1] = point.y; values[at + 2] = point.z;
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, input.itemSize, input.normalized));
  }
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

function auditGndDiffuseSharedUvCrops(pair, target, width, height, sourceWidth, sourceHeight) {
  const unavailable = reason => ({
    status: 'unavailable',
    reason,
    samples: [],
    maxInterCropDelta: null,
    maxCropVsSourceDelta: null,
  });
  const entries = [pair.entryA, pair.entryB];
  const materials = entries.map(entry => Array.isArray(entry.object.material)
    ? entry.object.material[0] : entry.object.material);
  const textures = [pair.sourceTexture, materials[0] && materials[0].map, materials[1] && materials[1].map];
  const crops = [pair.cropA, pair.cropB];
  if (!textures.every(texture => texture && texture.image)
    || !crops.every(crop => crop && [crop.x0, crop.y0, crop.x1, crop.y1, crop.width, crop.height].every(Number.isInteger))) {
    return unavailable('缺少來源 diffuse 或裁切貼圖，無法做共享 UV GPU 對照。');
  }
  const cropTextureSizes = textures.slice(1).map(texture => {
    const image = texture.image;
    return {
      width: image.naturalWidth || image.videoWidth || image.width,
      height: image.naturalHeight || image.videoHeight || image.height,
    };
  });
  if (!cropTextureSizes.every(size => Number.isInteger(size.width) && size.width > 0
    && Number.isInteger(size.height) && size.height > 0)) {
    return unavailable('裁切 diffuse 缺少有效的 GPU 貼圖尺寸。');
  }
  if (!textures.slice(1).every(texture =>
    (texture.generateMipmaps || Array.isArray(texture.mipmaps) && texture.mipmaps.length > 1)
    && texture.minFilter === THREE.LinearMipmapLinearFilter)) {
    return unavailable('裁切 diffuse 未啟用完整 mipmap，無法做同級比較。');
  }

  const sharedUv = pair.sharedUv;
  const centerUv = [
    (sharedUv[0][0] + sharedUv[1][0]) / 2,
    (sharedUv[0][1] + sharedUv[1][1]) / 2,
  ];
  const minU = Math.max(crops[0].x0, crops[1].x0) / sourceWidth;
  const maxU = Math.min(crops[0].x1, crops[1].x1) / sourceWidth;
  const minV = 1 - Math.min(crops[0].y1, crops[1].y1) / sourceHeight;
  const maxV = 1 - Math.max(crops[0].y0, crops[1].y0) / sourceHeight;
  const spanU = Math.min(0.25, 1.8 * Math.max(0, Math.min(centerUv[0] - minU, maxU - centerUv[0])));
  const spanV = Math.min(0.25, 1.8 * Math.max(0, Math.min(centerUv[1] - minV, maxV - centerUv[1])));
  if (spanU * sourceWidth < 4 || spanV * sourceHeight < 4) {
    return unavailable('兩個 diffuse crop 的共同安全取樣範圍不足 4 個來源像素。');
  }
  const sourceUvRect = {
    minU: centerUv[0] - spanU / 2,
    maxU: centerUv[0] + spanU / 2,
    minV: centerUv[1] - spanV / 2,
    maxV: centerUv[1] + spanV / 2,
  };
  const sourceUvs = [
    [sourceUvRect.minU, sourceUvRect.minV],
    [sourceUvRect.maxU, sourceUvRect.minV],
    [sourceUvRect.minU, sourceUvRect.maxV],
    [sourceUvRect.maxU, sourceUvRect.maxV],
  ];
  const uvForCrop = (uv, crop, textureSize) => crop.sourceAligned
    ? [uv[0], uv[1]]
    : [
      (uv[0] * sourceWidth - crop.x0) / textureSize.width,
      (uv[1] * sourceHeight + textureSize.height - sourceHeight + crop.y0)
        / textureSize.height,
    ];
  const basePixelAudit = auditGndDiffuseCropBasePixels(
    textures[0].image, textures.slice(1).map(texture => texture.image), crops,
    sourceUvRect, sourceWidth, sourceHeight
  );
  const makeMesh = (map, uvValues, centerX) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      centerX, 0, 0,
      centerX, 0, 0,
      centerX, 0, 0,
      centerX, 0, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvValues.flat(), 2));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    const material = new THREE.MeshBasicMaterial({
      map,
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return { geometry, material, mesh, centerX };
  };
  // Align all three sample centers to the same physical pixel-center phase.
  // Otherwise a half-pixel offset can masquerade as a UV/crop mismatch on sharp atlas edges.
  const sampleCenterPixels = [96.5, 256.5, 416.5];
  const sampleCenterWorldX = sampleCenterPixels.map(pixel => pixel / 128 - 2);
  const sourceMesh = makeMesh(textures[0], sourceUvs, sampleCenterWorldX[0]);
  const cropAMesh = makeMesh(textures[1],
    sourceUvs.map(uv => uvForCrop(uv, crops[0], cropTextureSizes[0])), sampleCenterWorldX[1]);
  const cropBMesh = makeMesh(textures[2],
    sourceUvs.map(uv => uvForCrop(uv, crops[1], cropTextureSizes[1])), sampleCenterWorldX[2]);
  const meshes = [sourceMesh, cropAMesh, cropBMesh];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(...meshes.map(item => item.mesh));
  const camera = new THREE.OrthographicCamera(-2, 2, 0.5, -0.5, 0.001, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const originalColorSpace = target.texture.colorSpace;
  const originalClear = renderer.getClearColor(new THREE.Color()).clone();
  const originalClearAlpha = renderer.getClearAlpha();
  const scales = [{ name: 'near', pixels: 96 }, { name: 'mid', pixels: 16 }, { name: 'far', pixels: 4 }];
  const samples = [];
  const readAt = (x, y) => {
    const rgba = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, x, height - 1 - y, 1, 1, rgba);
    return Array.from(rgba.slice(0, 3));
  };
  const maxDelta = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
  try {
    target.texture.colorSpace = THREE.NoColorSpace;
    renderer.setRenderTarget(target);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    for (const scale of scales) {
      const size = scale.pixels / 128;
      for (const item of meshes) {
        const half = size / 2;
        item.geometry.getAttribute('position').array.set([
          item.centerX - half, 0, -half,
          item.centerX + half, 0, -half,
          item.centerX - half, 0, half,
          item.centerX + half, 0, half,
        ]);
        item.geometry.getAttribute('position').needsUpdate = true;
        item.geometry.computeBoundingSphere();
      }
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      const y = Math.floor(height / 2);
      const pixels = meshes.map((item, index) => ({
        x: Math.floor(sampleCenterPixels[index]),
        y,
      }));
      const sourceRgb = readAt(pixels[0].x, pixels[0].y);
      const cropARgb = readAt(pixels[1].x, pixels[1].y);
      const cropBRgb = readAt(pixels[2].x, pixels[2].y);
      const effectiveLod = Number(Math.max(0, Math.min(20, Math.log2(Math.max(
        1,
        spanU * sourceWidth / scale.pixels,
        spanV * sourceHeight / scale.pixels
      )))).toFixed(3));
      samples.push({
        scale: scale.name,
        projectedPixels: scale.pixels,
        effectiveLod,
        centerSourceUv: centerUv.map(value => Number(value.toFixed(6))),
        sourceRgb,
        cropARgb,
        cropBRgb,
        cropVsSourceDelta: Math.max(maxDelta(cropARgb, sourceRgb), maxDelta(cropBRgb, sourceRgb)),
        interCropDelta: maxDelta(cropARgb, cropBRgb),
      });
    }
  } finally {
    for (const item of meshes) {
      item.geometry.dispose();
      item.material.dispose();
    }
    target.texture.colorSpace = originalColorSpace;
    renderer.setClearColor(originalClear, originalClearAlpha);
  }
  const maxInterCropDelta = Math.max(...samples.map(sample => sample.interCropDelta));
  const maxCropVsSourceDelta = Math.max(...samples.map(sample => sample.cropVsSourceDelta));
  const failures = samples.filter(sample => sample.interCropDelta > 2 || sample.cropVsSourceDelta > 2);
  return {
    status: failures.length ? 'mismatch' : 'passed',
    sourceUvRect,
    cropPixelRects: crops.map(crop => ({
      x0: crop.x0, y0: crop.y0, x1: crop.x1, y1: crop.y1,
      width: crop.width, height: crop.height,
    })),
    cropTextureDimensions: cropTextureSizes,
    basePixelAudit,
    maxInterCropDelta,
    maxCropVsSourceDelta,
    maxAllowedDelta: 2,
    samples,
    failures: failures.map(sample => ({
      scale: sample.scale,
      interCropDelta: sample.interCropDelta,
      cropVsSourceDelta: sample.cropVsSourceDelta,
    })),
  };
}

function runSingleGndSharedUvGpuBoundaryAudit(pair) {
  if (!renderer.capabilities.isWebGL2 && !renderer.capabilities.isWebGL) {
    return { status: 'unavailable', reason: '瀏覽器沒有可用的 WebGL。' };
  }
  if (!pair || pair.status !== 'ready') return { status: 'unavailable', reason: '缺少已驗證的相鄰 surface 候選。' };
  let target = null;
  try {
    const image = pair.sourceTexture.image;
    const sourceWidth = image.naturalWidth || image.videoWidth || image.width;
    const sourceHeight = image.naturalHeight || image.videoHeight || image.height;
    const mips = buildGndAuditMipPyramid(pair.sourceTexture);
    const entries = [pair.entryA, pair.entryB];
    const meshes = entries.map((entry, i) => {
      const mesh = new THREE.Mesh(buildGndAuditQuad(entry), Array.isArray(entry.object.material)
        ? entry.object.material[0] : entry.object.material);
      mesh.name = 'roo-gnd-boundary-audit-' + (i ? 'B' : 'A');
      mesh.frustumCulled = false;
      mesh.userData.auditSide = i ? 'B' : 'A';
      mesh.userData.auditSurface = entry.surfaceIndex;
      return mesh;
    });
    const auditScene = new THREE.Scene();
    auditScene.background = new THREE.Color(0x000000);
    auditScene.add(...meshes);
    const width = 512, height = 128;
    target = new THREE.WebGLRenderTarget(width, height, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const auditCamera = new THREE.OrthographicCamera(-1, 1, 0.25, -0.25, 0.001, 100000);
    auditCamera.up.set(0, 0, 1);
    const ray = new THREE.Raycaster();
    const pixProject = point => {
      const p = point.clone().project(auditCamera);
      return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 };
    };
    const center = corners => corners.reduce((sum, p) => sum.add(p.clone()), new THREE.Vector3())
      .multiplyScalar(1 / corners.length);
    const getPositions = entry => {
      const attr = entry.object.geometry.getAttribute('position');
      return [0, 1, 2, 3].map(c => entry.object.localToWorld(new THREE.Vector3(
        attr.getX(entry.quadIndex * 4 + c), attr.getY(entry.quadIndex * 4 + c),
        attr.getZ(entry.quadIndex * 4 + c)
      )));
    };
    const positions = entries.map(getPositions);
    const centers = positions.map(center);
    const edgeWorld = pair.corners.a.map(c => positions[0][c])
      .reduce((sum, p) => sum.add(p.clone()), new THREE.Vector3())
      .multiplyScalar(1 / pair.corners.a.length);
    const distance = Math.hypot(centers[0].x - centers[1].x, centers[0].z - centers[1].z);
    if (distance <= 1e-8) return { status: 'unavailable', reason: '相鄰 surface 中心距離無效。' };
    const originalTarget = renderer.getRenderTarget();
    const originalViewport = renderer.getViewport(new THREE.Vector4());
    const originalScissor = renderer.getScissor(new THREE.Vector4());
    const originalScissorTest = renderer.getScissorTest();
    const originalClear = renderer.getClearColor(new THREE.Color()).clone();
    const originalClearAlpha = renderer.getClearAlpha();
    const originalMode = GND_DEBUG_MODE_UNIFORM.value;
    const scales = [{ name: 'near', pixels: 96 }, { name: 'mid', pixels: 16 }, { name: 'far', pixels: 4 }];
    const modes = [
      { key: 'diffuse', value: 7 }, { key: 'vertexColor', value: 8 },
      { key: 'rgbLightmap', value: 2 }, { key: 'ao', value: 3 },
      { key: 'rswLight', value: 4 }, { key: 'combined', value: 0 },
    ];
    const projectCenter = values => values.map(p => pixProject(p));
    const attrAt = (hit, name) => {
      const attr = hit.object.geometry.getAttribute(name);
      if (!attr) return null;
      const f = hit.face, pos = hit.object.geometry.getAttribute('position');
      const point = index => new THREE.Vector3(pos.getX(index), pos.getY(index), pos.getZ(index));
      const bary = THREE.Triangle.getBarycoord(hit.point, point(f.a), point(f.b), point(f.c), new THREE.Vector3());
      if (!bary || ![bary.x, bary.y, bary.z].every(Number.isFinite)) return null;
      const get = index => Array.from({ length: attr.itemSize }, (_, c) =>
        c === 0 ? attr.getX(index) : c === 1 ? attr.getY(index) : c === 2 ? attr.getZ(index) : attr.getW(index));
      const a = get(f.a), b = get(f.b), c = get(f.c);
      return a.map((v, i) => v * bary.x + b[i] * bary.y + c[i] * bary.z);
    };
    const hitAt = (mesh, pixel) => {
      ray.setFromCamera(new THREE.Vector2(
        ((pixel.x + 0.5) / width) * 2 - 1, 1 - ((pixel.y + 0.5) / height) * 2
      ), auditCamera);
      return ray.intersectObjects(meshes, false).find(hit => hit.object === mesh) || null;
    };
    const readPixel = pixel => {
      const rgba = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, pixel.x, height - 1 - pixel.y, 1, 1, rgba);
      return Array.from(rgba.slice(0, 3));
    };
    const mipLod = (entry, projected) => {
      const sourceUv = entry.object.geometry.getAttribute('rooGndSourceUv');
      const uv = [0, 1, 2].map(c => [
        sourceUv.getX(entry.quadIndex * 4 + c), sourceUv.getY(entry.quadIndex * 4 + c),
      ]);
      const px01 = Math.max(1e-6, Math.hypot(projected[1].x - projected[0].x, projected[1].y - projected[0].y));
      const px02 = Math.max(1e-6, Math.hypot(projected[2].x - projected[0].x, projected[2].y - projected[0].y));
      const rho01 = Math.max(Math.abs(uv[1][0] - uv[0][0]) * sourceWidth,
        Math.abs(uv[1][1] - uv[0][1]) * sourceHeight) / px01;
      const rho02 = Math.max(Math.abs(uv[2][0] - uv[0][0]) * sourceWidth,
        Math.abs(uv[2][1] - uv[0][1]) * sourceHeight) / px02;
      return Math.max(0, Math.min(mips.length - 1, Math.log2(Math.max(1, rho01, rho02))));
    };
    const maxDelta = (a, b) => a && b ? Math.max(...a.map((v, i) => Math.abs(v - b[i]))) : null;
    const scaleReports = [];
    try {
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      for (const scale of scales) {
        const mid = centers[0].clone().add(centers[1]).multiplyScalar(0.5);
        const frustumWidth = distance * width / scale.pixels;
        const frustumHeight = frustumWidth * height / width;
        auditCamera.left = -frustumWidth / 2;
        auditCamera.right = frustumWidth / 2;
        auditCamera.top = frustumHeight / 2;
        auditCamera.bottom = -frustumHeight / 2;
        auditCamera.position.set(mid.x, mid.y + Math.max(10, distance * 100), mid.z);
        auditCamera.lookAt(mid);
        auditCamera.updateProjectionMatrix();
        auditCamera.updateMatrixWorld(true);
        const centerScreen = centers.map(p => pixProject(p));
        const edgeScreen = pixProject(edgeWorld);
        const projectedTilePixels = Math.hypot(centerScreen[0].x - centerScreen[1].x,
          centerScreen[0].y - centerScreen[1].y);
        const off = pair.wrapBoundary ? 1 : Math.max(1, Math.min(4, Math.round(projectedTilePixels * 0.04)));
        const choosePixel = (which) => {
          const dx = centerScreen[which].x - edgeScreen.x;
          const dy = centerScreen[which].y - edgeScreen.y;
          const d = Math.hypot(dx, dy) || 1;
          const maxOff = pair.wrapBoundary
              ? Math.max(1, Math.min(3, Math.floor(projectedTilePixels * 0.2)))
              : Math.max(off, Math.min(20, Math.floor(projectedTilePixels * 0.4)));
          for (let n = off; n <= maxOff; n++) {
            const pixel = { x: Math.floor(edgeScreen.x + dx / d * n),
              y: Math.floor(edgeScreen.y + dy / d * n) };
            if (pixel.x < 1 || pixel.x >= width - 1 || pixel.y < 1 || pixel.y >= height - 1) continue;
            if (hitAt(meshes[which], pixel)) return pixel;
          }
          throw new Error('尺度 ' + scale.name + ' 無法在共用邊兩側命中對應地表。');
        };
        const pixels = [choosePixel(0), choosePixel(1)];
        const lods = entries.map((entry, i) => mipLod(entry, projectCenter(positions[i])));
        const samples = pixels.map((pixel, i) => {
          const hit = hitAt(meshes[i], pixel);
          const sourceUv = attrAt(hit, 'rooGndSourceUv');
          const localUv = attrAt(hit, 'uv');
          const atlasUv = attrAt(hit, 'uv2');
          const color = attrAt(hit, 'color');
          const normal = attrAt(hit, 'rooGndVertexNormal');
          const hasLightmap = attrAt(hit, 'rooGndHasLightmap');
          if (!sourceUv || !localUv || !atlasUv || !color || !normal || !hasLightmap) {
            throw new Error('GPU sample 缺少 source UV、UV2、頂點色或光照屬性。');
          }
          const surface = i === 0 ? pair.surfaceA : pair.surfaceB;
          const lightmap = sampleGndLightmapSourceAtUv(surface, atlasUv);
          const light = rswInfo && rswInfo.light;
          let rswMultiplier = [1, 1, 1];
          if (light) {
            // The shader computes directional light at each vertex, then the GPU
            // interpolates that varying across the triangle. Match that operation
            // here instead of applying the nonlinear light formula to an already
            // interpolated normal (which only matched flat, per-quad normals).
            const geometry = hit.object.geometry;
            const normalAttribute = geometry.getAttribute('rooGndVertexNormal');
            const positionAttribute = geometry.getAttribute('position');
            const face = hit.face;
            const point = index => new THREE.Vector3(
              positionAttribute.getX(index), positionAttribute.getY(index), positionAttribute.getZ(index)
            );
            const bary = THREE.Triangle.getBarycoord(
              hit.point, point(face.a), point(face.b), point(face.c), new THREE.Vector3()
            );
            if (!normalAttribute || !positionAttribute || !bary
              || ![bary.x, bary.y, bary.z].every(Number.isFinite)) {
              throw new Error('GPU sample 無法取得方向光的三角形重心座標。');
            }
            const direction = computeGndLightDirection(light.longitude, light.latitude);
            const weights = [bary.x, bary.y, bary.z];
            const vertexMultipliers = [face.a, face.b, face.c].map(index =>
              computeGndLightMultiplier([
                normalAttribute.getX(index),
                normalAttribute.getY(index),
                normalAttribute.getZ(index),
              ], direction, light.ambient, light.diffuse)
            );
            rswMultiplier = [0, 1, 2].map(axis => weights.reduce(
              (sum, weight, corner) => sum + weight * vertexMultipliers[corner][axis], 0
            ));
          }
          return {
            side: i === 0 ? 'A' : 'B',
            surfaceIndex: entries[i].surfaceIndex,
            pixel,
            sourceUv: sourceUv.map(v => Number(v.toFixed(6))),
            localUv: localUv.map(v => Number(v.toFixed(6))),
            atlasUv: atlasUv.map(v => Number(v.toFixed(6))),
            vertexColor: color.map(v => Number(v.toFixed(6))),
            hasLightmap: hasLightmap[0],
            lod: Number(lods[i].toFixed(3)),
            expected: {
              diffuseRgb: sampleGndAuditMip(mips, sourceUv, lods[i], false, false),
              diffuseRepeatRgb: pair.wrapBoundary
                ? sampleGndAuditMip(mips, sourceUv, lods[i], true, true) : null,
              vertexColorRgb: color.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)),
              rswLightRgb: rswMultiplier.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)),
              rgbLightmap: lightmap && lightmap.filteredRgb
                ? lightmap.filteredRgb.map(v => Math.round(v)) : null,
              ao: lightmap ? Number(lightmap.filteredAo.toFixed(3)) : null,
              lightmapSource: lightmap ? { texel: [lightmap.x, lightmap.y],
                rawRgb: lightmap.rgb, rawAo: lightmap.ao, samplePosition: lightmap.samplePosition } : null,
            },
            framebuffer: {},
          };
        });
        for (const mode of modes) {
          GND_DEBUG_MODE_UNIFORM.value = mode.value;
          renderer.setClearColor(0x000000, 1);
          renderer.clear(true, true, true);
          renderer.render(auditScene, auditCamera);
          samples.forEach((sample, index) => { sample.framebuffer[mode.key] = readPixel(pixels[index]); });
          if (mode.key === 'diffuse' && pair.wrapBoundary) {
            const texture = pair.sourceTexture;
            const originalWrapS = texture.wrapS;
            const originalWrapT = texture.wrapT;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.needsUpdate = true;
            renderer.clear(true, true, true);
            renderer.render(auditScene, auditCamera);
            samples.forEach((sample, index) => {
              sample.framebuffer.diffuseRepeatBoundary = readPixel(pixels[index]);
            });
            texture.wrapS = originalWrapS;
            texture.wrapT = originalWrapT;
            texture.needsUpdate = true;
          }
        }
        for (const sample of samples) {
          sample.errors = {
            diffuseMipRgb: maxDelta(sample.framebuffer.diffuse, sample.expected.diffuseRgb),
            diffuseRepeatMipRgb: pair.wrapBoundary
              ? maxDelta(sample.framebuffer.diffuseRepeatBoundary, sample.expected.diffuseRepeatRgb) : 0,
            wrapSamplerDelta: pair.wrapBoundary
              ? maxDelta(sample.framebuffer.diffuse, sample.framebuffer.diffuseRepeatBoundary) : null,
            vertexColorRgb: maxDelta(sample.framebuffer.vertexColor, sample.expected.vertexColorRgb),
            rswLightRgb: maxDelta(sample.framebuffer.rswLight, sample.expected.rswLightRgb),
            rgbLightmap: maxDelta(sample.framebuffer.rgbLightmap, sample.expected.rgbLightmap),
            ao: maxDelta(sample.framebuffer.ao, [sample.expected.ao, sample.expected.ao, sample.expected.ao]),
          };
          const a = sample.framebuffer, strength = sample.hasLightmap > 0.5 ? GND_PREVIEW_AO_STRENGTH : 0;
          sample.expected.combinedFromGpuComponents = [0, 1, 2].map(c => Math.round(Math.max(0, Math.min(1,
            a.diffuse[c] / 255 * a.vertexColor[c] / 255 * a.rswLight[c] / 255
              * (1 + (a.ao[0] / 255 - 1) * strength) + a.rgbLightmap[c] / 255
          )) * 255));
          sample.errors.combinedFromComponents = maxDelta(a.combined, sample.expected.combinedFromGpuComponents);
        }
        const max = key => Math.max(...samples.map(s => s.errors[key] === null ? 999 : s.errors[key]));
        scaleReports.push({
          scale: scale.name, targetTilePixels: scale.pixels,
          projectedTilePixels: Number(projectedTilePixels.toFixed(3)),
          effectiveLod: samples.map(s => s.lod),
          maxDelta: {
            diffuseMipRgb: max('diffuseMipRgb'), diffuseRepeatMipRgb: max('diffuseRepeatMipRgb'),
            vertexColorRgb: max('vertexColorRgb'),
            rswLightRgb: max('rswLightRgb'), rgbLightmap: max('rgbLightmap'), ao: max('ao'),
            combinedFromComponents: max('combinedFromComponents'),
          },
          maxRepeatVsClampRgbDelta: Math.max(0, ...samples.map(sample =>
            Number.isFinite(sample.errors.wrapSamplerDelta) ? sample.errors.wrapSamplerDelta : 0)),
          samples,
        });
      }
      const diffuseSharedUv = pair.wrapBoundary
        ? {
          status: 'not-applicable',
          reason: '兩側來源 UV 端點相差一個週期；比對官方 ClampToEdge 與診斷用 Repeat GPU framebuffer。',
          samples: [], maxInterCropDelta: null, maxCropVsSourceDelta: null,
        }
        : auditGndDiffuseSharedUvCrops(pair, target, width, height, sourceWidth, sourceHeight);
      const limits = { diffuseMipRgb: 12, diffuseRepeatMipRgb: 12, vertexColorRgb: 3, rswLightRgb: 4,
        rgbLightmap: 4, ao: 4, combinedFromComponents: 4 };
      const sharedNormalLimit = 1e-5;
      const sharedNormalDelta = pair.coverage.sharedEdgeNormalMaxDelta;
      const failures = [
        ...(diffuseSharedUv.status !== 'passed' && diffuseSharedUv.status !== 'not-applicable'
          ? [{ scale: 'shared-uv', channel: 'diffuseCropContinuity',
            maxDelta: Math.max(
              Number(diffuseSharedUv.maxInterCropDelta) || 999,
              Number(diffuseSharedUv.maxCropVsSourceDelta) || 999
            ), limit: diffuseSharedUv.maxAllowedDelta || 2 }] : []),
        ...(Number.isFinite(sharedNormalDelta) && sharedNormalDelta > sharedNormalLimit
          ? [{ scale: 'shared-edge', channel: 'sharedEdgeNormal',
            maxDelta: sharedNormalDelta, limit: sharedNormalLimit }] : []),
        ...scaleReports.flatMap(s => Object.entries(limits)
          .filter(([key, limit]) => s.maxDelta[key] > limit)
          .map(([key, limit]) => ({ scale: s.scale, channel: key, maxDelta: s.maxDelta[key], limit }))),
      ];
      return {
        status: failures.length ? 'mismatch' : 'passed',
        mapId: mapInfo && mapInfo.mapId, texture: gndInfo.textures[pair.surfaceA.textureIndex],
        axis: pair.axis, grid: pair.grid, surfaces: [pair.surfaceIndexA, pair.surfaceIndexB],
        sharedUv: pair.sharedUv, wrapBoundary: pair.wrapBoundary,
        diffuseRects: [pair.rectA, pair.rectB], coverage: pair.coverage,
        cropPixelRects: [pair.cropA, pair.cropB],
        samplerWrap: {
          s: pair.sourceTexture.wrapS === THREE.RepeatWrapping ? 'repeat'
            : pair.sourceTexture.wrapS === THREE.ClampToEdgeWrapping ? 'clamp-to-edge' : 'other',
          t: pair.sourceTexture.wrapT === THREE.RepeatWrapping ? 'repeat'
            : pair.sourceTexture.wrapT === THREE.ClampToEdgeWrapping ? 'clamp-to-edge' : 'other',
        },
        lightmaps: [pair.surfaceA.lightmapIndex, pair.surfaceB.lightmapIndex],
        sourceImage: { width: sourceWidth, height: sourceHeight }, mipLevels: mips.length,
        sampler: { minFilter: meshes[0].material.map.minFilter, magFilter: meshes[0].material.map.magFilter,
          generateMipmaps: meshes[0].material.map.generateMipmaps },
        limits, failures, scales: scaleReports, diffuseSharedUv,
      };
    } finally {
      renderer.setRenderTarget(originalTarget);
      renderer.setViewport(originalViewport);
      renderer.setScissor(originalScissor);
      renderer.setScissorTest(originalScissorTest);
      renderer.setClearColor(originalClear, originalClearAlpha);
      GND_DEBUG_MODE_UNIFORM.value = originalMode;
      if (target) target.dispose();
    }
  } catch (error) {
    if (target) target.dispose();
    return { status: 'error', message: error && error.message ? error.message : String(error) };
  }
}




function frameGndWhiteStreakProfileView() {
  if (!mapRoot || !gndInfo || !Array.isArray(gndInfo.surfaces)) {
    return { status: 'pending', reason: '原生 GND 尚未載入。' };
  }
  mapRoot.updateMatrixWorld(true);
  const targetIds = [9965, 9967, 9969, 9844];
  const entries = new Map();
  mapRoot.traverse(object => {
    const indices = object.userData && object.userData.rooGndSurfaceIndices;
    if (!object.userData.rooTerrainSurface || !Array.isArray(indices)) return;
    indices.forEach((surfaceIndex, quadIndex) => {
      if (!targetIds.includes(surfaceIndex)) return;
      if (!entries.has(surfaceIndex)) entries.set(surfaceIndex, { object, quadIndex, surfaceIndex });
    });
  });
  const found = targetIds.map(id => entries.get(id)).filter(Boolean);
  if (found.length !== targetIds.length) {
    return { status: 'unavailable', missingSurfaces: targetIds.filter(id => !entries.has(id)) };
  }
  const getQuadWorldPositions = entry => {
    const attr = entry.object.geometry.getAttribute('position');
    return [0, 1, 2, 3].map(corner => entry.object.localToWorld(new THREE.Vector3(
      attr.getX(entry.quadIndex * 4 + corner),
      attr.getY(entry.quadIndex * 4 + corner),
      attr.getZ(entry.quadIndex * 4 + corner)
    )));
  };
  const quads = found.map(entry => ({
    surfaceIndex: entry.surfaceIndex,
    positions: getQuadWorldPositions(entry),
  }));
  const allPoints = quads.flatMap(quad => quad.positions);
  const bounds = {
    minX: Math.min(...allPoints.map(point => point.x)),
    maxX: Math.max(...allPoints.map(point => point.x)),
    minY: Math.min(...allPoints.map(point => point.y)),
    maxY: Math.max(...allPoints.map(point => point.y)),
    minZ: Math.min(...allPoints.map(point => point.z)),
    maxZ: Math.max(...allPoints.map(point => point.z)),
  };
  const center = new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2
  );
  const referenceQuad = quads.find(quad => quad.surfaceIndex === 9967);
  const tileSpan = Math.max(
    referenceQuad.positions[0].distanceTo(referenceQuad.positions[1]),
    referenceQuad.positions[0].distanceTo(referenceQuad.positions[2]),
    1
  );
  const distance = tileSpan * 5.5;
  controls.target.copy(center);
  camera.position.set(center.x + distance * 0.9, center.y + distance * 0.85, center.z + distance * 0.9);
  camera.lookAt(center);
  controls.update();
  camera.lookAt(center);
  GND_DEBUG_MODE_UNIFORM.value = 7;
  const modeSelect = document.getElementById('gnd-debug-mode');
  if (modeSelect) modeSelect.value = '7';
  renderer.render(scene, camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const projectedCenters = quads.map(quad => {
    const point = quad.positions.reduce((sum, current) => sum.add(current), new THREE.Vector3())
      .multiplyScalar(1 / quad.positions.length);
    const ndc = point.project(camera);
    return {
      surfaceIndex: quad.surfaceIndex,
      x: Number((rect.left + (ndc.x + 1) * rect.width / 2).toFixed(2)),
      y: Number((rect.top + (1 - ndc.y) * rect.height / 2).toFixed(2)),
    };
  });
  return {
    status: 'framed',
    mode: 'diffuse-only',
    referenceSurface: 9967,
    tileSpan,
    targetWorld: center.toArray().map(value => Number(value.toFixed(4))),
    cameraPosition: camera.position.toArray().map(value => Number(value.toFixed(4))),
    canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    projectedCenters,
    uvProfile: [
      { surfaceIndex: 9965, uv: [0.6710, 0.0012] },
      { surfaceIndex: 9967, uv: [0.9210, 0.0012] },
      { surfaceIndex: 9969, uv: [0.1710, 0.0012] },
      { surfaceIndex: 9844, uv: [0.9210, 0.9988] },
    ],
  };
}

function runGndTargetSurfaceGpuAudit() {
  const targetSpecs = [
    { probeId: 'control-9963', surfaceIndex: 9963, uv: [0.4306, 0.2271] },
    { probeId: 'control-9843', surfaceIndex: 9843, uv: [0.5641, 0.9895] },
    // Follow the pale streak from the inspected #9967 point along adjacent tiles and across its V edge.
    { probeId: 'streak-west', surfaceIndex: 9965, uv: [0.6710, 0.0012] },
    { probeId: 'streak-center', surfaceIndex: 9967, uv: [0.9210, 0.0012] },
    { probeId: 'streak-east', surfaceIndex: 9969, uv: [0.1710, 0.0012] },
    { probeId: 'streak-opposite-v-edge', surfaceIndex: 9844, uv: [0.9210, 0.9988] },
  ];
  if (!mapRoot || !gndInfo || !Array.isArray(gndInfo.surfaces)) {
    return { status: 'pending', reason: '原生 GND 尚未載入。', samples: [] };
  }
  const entriesBySurface = new Map();
  mapRoot.traverse(object => {
    const indices = object.userData && object.userData.rooGndSurfaceIndices;
    if (!object.userData.rooTerrainSurface || !Array.isArray(indices)) return;
    indices.forEach((surfaceIndex, quadIndex) => {
      if (!entriesBySurface.has(surfaceIndex)) entriesBySurface.set(surfaceIndex, []);
      entriesBySurface.get(surfaceIndex).push({ object, quadIndex, surfaceIndex });
    });
  });
  const width = 512, height = 128;
  const targetTexture = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false,
  });
  targetTexture.texture.colorSpace = THREE.SRGBColorSpace;
  const auditScene = new THREE.Scene();
  auditScene.background = new THREE.Color(0x000000);
  const auditCamera = new THREE.OrthographicCamera(-1, 1, 0.25, -0.25, 0.001, 100000);
  auditCamera.up.set(0, 0, 1);
  const ray = new THREE.Raycaster();
  const originalTarget = renderer.getRenderTarget();
  const originalViewport = renderer.getViewport(new THREE.Vector4());
  const originalScissor = renderer.getScissor(new THREE.Vector4());
  const originalScissorTest = renderer.getScissorTest();
  const originalClear = renderer.getClearColor(new THREE.Color()).clone();
  const originalClearAlpha = renderer.getClearAlpha();
  const originalMode = GND_DEBUG_MODE_UNIFORM.value;
  const deltaRgb = (a, b) => a && b && a.length === 3 && b.length === 3
    ? Math.max(...a.map((value, index) => Math.abs(value - b[index]))) : null;
  const barycentric2D = (p, a, b, c) => {
    const denominator = (b[1] - c[1]) * (a[0] - c[0])
      + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-10) return null;
    const u = ((b[1] - c[1]) * (p[0] - c[0])
      + (c[0] - b[0]) * (p[1] - c[1])) / denominator;
    const v = ((c[1] - a[1]) * (p[0] - c[0])
      + (a[0] - c[0]) * (p[1] - c[1])) / denominator;
    return [u, v, 1 - u - v];
  };
  const attrPoint = (attribute, index) => new THREE.Vector3(
    attribute.getX(index), attribute.getY(index), attribute.getZ(index)
  );
  const interpolateAttribute = (attribute, indices, weights) =>
    Array.from({ length: attribute.itemSize }, (_, component) =>
      indices.reduce((sum, index, i) => {
        const value = component === 0 ? attribute.getX(index)
          : component === 1 ? attribute.getY(index)
            : component === 2 ? attribute.getZ(index)
              : component === 3 ? attribute.getW(index) : 0;
        return sum + value * weights[i];
      }, 0));
  const readPixel = pixel => {
    const rgba = new Uint8Array(4);
    renderer.readRenderTargetPixels(targetTexture, pixel.x, height - 1 - pixel.y, 1, 1, rgba);
    return Array.from(rgba.slice(0, 3));
  };
  const samples = [];
  try {
    renderer.setRenderTarget(targetTexture);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 1);
    GND_DEBUG_MODE_UNIFORM.value = 7;
    for (const spec of targetSpecs) {
      const surface = gndInfo.surfaces[spec.surfaceIndex];
      const entries = entriesBySurface.get(spec.surfaceIndex) || [];
      const entry = entries.find(candidate => {
        const material = Array.isArray(candidate.object.material)
          ? candidate.object.material[0] : candidate.object.material;
        return material && material.map && material.map.image
          && candidate.object.geometry.getAttribute('rooGndSourceUv')
          && candidate.object.geometry.getAttribute('position');
      });
      if (!surface || !entry) {
        samples.push({
          status: 'unavailable', probeId: spec.probeId, surfaceIndex: spec.surfaceIndex, requestedUv: spec.uv,
          reason: '找不到帶真實 diffuse 紋理的目標 surface mesh。',
        });
        continue;
      }
      const material = Array.isArray(entry.object.material) ? entry.object.material[0] : entry.object.material;
      const sourceTexture = material.map;
      const image = sourceTexture.image;
      const sourceWidth = image.naturalWidth || image.videoWidth || image.width;
      const sourceHeight = image.naturalHeight || image.videoHeight || image.height;
      const mipReference = buildGndAuditMipPyramid(sourceTexture);
      const sourceTextureUv = entry.object.geometry.getAttribute('rooGndSourceUv');
      const uvCorners = [0, 1, 2, 3].map(corner => [
        sourceTextureUv.getX(entry.quadIndex * 4 + corner),
        sourceTextureUv.getY(entry.quadIndex * 4 + corner),
      ]);
      const triangleCandidates = [[0, 1, 2], [2, 1, 3]].map(indices => ({
        indices,
        weights: barycentric2D(spec.uv, ...indices.map(index => uvCorners[index])),
      })).filter(candidate => candidate.weights
        && candidate.weights.every(weight => weight >= -1e-4 && weight <= 1.0001));
      if (!triangleCandidates.length) {
        samples.push({
          status: 'failed', probeId: spec.probeId, surfaceIndex: spec.surfaceIndex, requestedUv: spec.uv,
          uvCorners, reason: '固定 UV 不在該 surface 的兩個三角形內。',
        });
        continue;
      }
      const triangle = triangleCandidates[0];
      const geometry = buildGndAuditQuad(entry);
      const position = geometry.getAttribute('position');
      const sourceUv = geometry.getAttribute('rooGndSourceUv');
      const targetPoint = triangle.indices.reduce((sum, index, i) =>
        sum.add(attrPoint(position, index).multiplyScalar(triangle.weights[i])), new THREE.Vector3());
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'roo-gnd-target-surface-' + spec.surfaceIndex;
      mesh.frustumCulled = false;
      auditScene.clear();
      auditScene.add(mesh);
      const positions = [0, 1, 2, 3].map(index => attrPoint(position, index));
      const tileWidth = Math.max(
        positions[0].distanceTo(positions[1]), positions[2].distanceTo(positions[3]), 1e-4
      );
      const tileDepth = Math.max(
        positions[0].distanceTo(positions[2]), positions[1].distanceTo(positions[3]), 1e-4
      );
      const scaleReports = [];
      for (const scale of [
        { name: 'near', tilePixels: 96 },
        { name: 'mid', tilePixels: 16 },
        { name: 'far', tilePixels: 4 },
      ]) {
        const frustumWidth = Math.max(tileWidth, tileDepth) * width / scale.tilePixels;
        const frustumHeight = frustumWidth * height / width;
        auditCamera.left = -frustumWidth / 2;
        auditCamera.right = frustumWidth / 2;
        auditCamera.top = frustumHeight / 2;
        auditCamera.bottom = -frustumHeight / 2;
        // Put the requested UV exactly under the pixel center, not on a pixel corner.
        // This keeps the probed source UV stable even at far scale.
        const cameraCenter = targetPoint.clone().add(new THREE.Vector3(
          -frustumWidth / width * 0.5,
          0,
          frustumHeight / height * 0.5
        ));
        // At a four-pixel footprint, the last texel of the low/high V edge can
        // fall on a rasterizer's top-left fill boundary. Bias only the diagnostic
        // camera by 0.08 px toward the edge, so the selected pixel center remains
        // inside the same surface. The sampled UV is still measured from the
        // actual GPU pixel and must stay within the existing 0.006 UV tolerance.
        let coverageBiasPixels = 0;
        if (scale.name === 'far' && spec.probeId.startsWith('streak-')) {
          const minU = Math.min(...uvCorners.map(uv => uv[0]));
          const maxU = Math.max(...uvCorners.map(uv => uv[0]));
          const minV = Math.min(...uvCorners.map(uv => uv[1]));
          const maxV = Math.max(...uvCorners.map(uv => uv[1]));
          const lowVDistance = spec.uv[1] - minV;
          const highVDistance = maxV - spec.uv[1];
          if (lowVDistance >= -1e-6 && highVDistance >= -1e-6
            && Math.min(lowVDistance, highVDistance) <= 0.01 && maxU > minU && maxV > minV) {
            const uRatio = Math.max(0, Math.min(1, (spec.uv[0] - minU) / (maxU - minU)));
            const edgeV = lowVDistance <= highVDistance ? minV : maxV;
            const oppositeV = edgeV === minV ? maxV : minV;
            const pointAtV = v => {
              const edgeCorners = uvCorners.map((uv, index) => ({ uv, index }))
                .filter(item => Math.abs(item.uv[1] - v) <= 1e-6)
                .sort((a, b) => a.uv[0] - b.uv[0]);
              if (edgeCorners.length < 2) return null;
              return attrPoint(position, edgeCorners[0].index).lerp(
                attrPoint(position, edgeCorners[1].index), uRatio
              );
            };
            const edgePoint = pointAtV(edgeV);
            const oppositePoint = pointAtV(oppositeV);
            if (edgePoint && oppositePoint) {
              const inward = oppositePoint.sub(edgePoint);
              inward.y = 0;
              const projectedInteriorPixels = Math.hypot(
                inward.x * width / frustumWidth,
                inward.z * height / frustumHeight
              );
              if (projectedInteriorPixels > 1e-6) {
                cameraCenter.add(inward.multiplyScalar(0.08 / projectedInteriorPixels));
                coverageBiasPixels = 0.08;
              }
            }
          }
        }
        auditCamera.position.set(
          cameraCenter.x,
          targetPoint.y + Math.max(100, frustumWidth * 20),
          cameraCenter.z
        );
        auditCamera.lookAt(cameraCenter);
        auditCamera.updateProjectionMatrix();
        auditCamera.updateMatrixWorld(true);
        const projected = targetPoint.clone().project(auditCamera);
        const pixel = {
          x: Math.max(1, Math.min(width - 2, Math.floor((projected.x + 1) * width / 2))),
          y: Math.max(1, Math.min(height - 2, Math.floor((1 - projected.y) * height / 2))),
        };
        renderer.clear(true, true, true);
        renderer.render(auditScene, auditCamera);
        ray.setFromCamera(new THREE.Vector2(
          ((pixel.x + 0.5) / width) * 2 - 1,
          1 - ((pixel.y + 0.5) / height) * 2
        ), auditCamera);
        const hit = ray.intersectObject(mesh, false)[0];
        if (!hit) {
          scaleReports.push({
            scale: scale.name, pixel, status: 'failed',
            reason: '中心像素未命中目標 surface。',
          });
          continue;
        }
        const faceIndices = [hit.face.a, hit.face.b, hit.face.c];
        const bary = THREE.Triangle.getBarycoord(
          hit.point,
          attrPoint(position, faceIndices[0]),
          attrPoint(position, faceIndices[1]),
          attrPoint(position, faceIndices[2]),
          new THREE.Vector3()
        );
        const weights = bary ? [bary.x, bary.y, bary.z] : null;
        if (!weights || !weights.every(Number.isFinite)) {
          scaleReports.push({
            scale: scale.name, pixel, status: 'failed',
            reason: '無法從 GPU 取樣像素回算三角形 UV。',
          });
          continue;
        }
        const actualUv = interpolateAttribute(sourceUv, faceIndices, weights).slice(0, 2);
        const projectedCorners = positions.map(point => {
          const result = point.clone().project(auditCamera);
          return { x: (result.x + 1) * width / 2, y: (1 - result.y) * height / 2 };
        });
        const cornerUv = [0, 1, 2].map(index => uvCorners[index]);
        const edgePixels01 = Math.max(1e-6, Math.hypot(
          projectedCorners[1].x - projectedCorners[0].x,
          projectedCorners[1].y - projectedCorners[0].y
        ));
        const edgePixels02 = Math.max(1e-6, Math.hypot(
          projectedCorners[2].x - projectedCorners[0].x,
          projectedCorners[2].y - projectedCorners[0].y
        ));
        const rho01 = Math.max(
          Math.abs(cornerUv[1][0] - cornerUv[0][0]) * sourceWidth,
          Math.abs(cornerUv[1][1] - cornerUv[0][1]) * sourceHeight
        ) / edgePixels01;
        const rho02 = Math.max(
          Math.abs(cornerUv[2][0] - cornerUv[0][0]) * sourceWidth,
          Math.abs(cornerUv[2][1] - cornerUv[0][1]) * sourceHeight
        ) / edgePixels02;
        const lod = Math.max(0, Math.min(mipReference.length - 1,
          Math.log2(Math.max(1, rho01, rho02))));
        const expectedRgb = sampleGndAuditMip(mipReference, actualUv, lod, false, false);
        const framebufferRgb = readPixel(pixel);
        const maxRgbDelta = deltaRgb(framebufferRgb, expectedRgb);
        const sourceX = Math.max(0, Math.min(sourceWidth - 1, Math.floor(actualUv[0] * sourceWidth)));
        const sourceY = Math.max(0, Math.min(sourceHeight - 1,
          sourceHeight - 1 - Math.floor(actualUv[1] * sourceHeight)));
        const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
        const raw = mipReference[0].data;
        const nearestSourceRgba = Array.from(raw.slice(sourceOffset, sourceOffset + 4));
        scaleReports.push({
          status: Number.isFinite(maxRgbDelta) && maxRgbDelta <= 12 ? 'passed' : 'failed',
          scale: scale.name,
          targetTilePixels: scale.tilePixels,
          coverageBiasPixels: Number(coverageBiasPixels.toFixed(3)),
          projectedSurfacePixels: {
            width: Number(Math.max(projectedCorners[0].x, projectedCorners[1].x,
              projectedCorners[2].x, projectedCorners[3].x)
              - Math.min(projectedCorners[0].x, projectedCorners[1].x,
                projectedCorners[2].x, projectedCorners[3].x)).toFixed(3),
            height: Number(Math.max(projectedCorners[0].y, projectedCorners[1].y,
              projectedCorners[2].y, projectedCorners[3].y)
              - Math.min(projectedCorners[0].y, projectedCorners[1].y,
                projectedCorners[2].y, projectedCorners[3].y)).toFixed(3),
          },
          pixel,
          requestedUv: spec.uv,
          actualSourceUv: actualUv.map(value => Number(value.toFixed(6))),
          effectiveLod: Number(lod.toFixed(3)),
          expectedSourceMipRgb: expectedRgb,
          nearestSourcePixel: [sourceX, sourceY],
          nearestSourceRgba: nearestSourceRgba,
          framebufferRgb,
          maxRgbDelta: Number(maxRgbDelta.toFixed(3)),
          limitRgbDelta: 12,
        });
      }
      const texturePath = Array.isArray(gndInfo.textures)
        ? gndInfo.textures[surface.textureIndex] : null;
      const actualCanvasRect = renderer.domElement.getBoundingClientRect();
      const actualViewNdc = targetPoint.clone().project(camera);
      const actualViewScreenPoint = {
        x: Number((actualCanvasRect.left + (actualViewNdc.x + 1) * actualCanvasRect.width / 2).toFixed(2)),
        y: Number((actualCanvasRect.top + (1 - actualViewNdc.y) * actualCanvasRect.height / 2).toFixed(2)),
      };
      const allScalesPassed = scaleReports.length === 3
        && scaleReports.every(scale => scale.status === 'passed');
      samples.push({
        status: allScalesPassed ? 'passed'
          : (scaleReports.some(scale => scale.status === 'failed') ? 'failed' : 'unavailable'),
        probeId: spec.probeId,
        surfaceIndex: spec.surfaceIndex,
        actualViewScreenPoint,
        quadIndex: entry.quadIndex,
        cubeUseSites: gndInfo.cubes
          .map((cube, index) => cube.topSurface === spec.surfaceIndex
            ? { index, x: index % gndInfo.width, y: Math.floor(index / gndInfo.width) } : null)
          .filter(Boolean).slice(0, 12),
        textureIndex: surface.textureIndex,
        texturePath,
        imageUrl: image.currentSrc || image.src || null,
        sourceImage: [sourceWidth, sourceHeight],
        uvCorners,
        requestedUv: spec.uv,
        mipReferenceLevels: mipReference.length,
        sampler: {
          wrapS: sourceTexture.wrapS === THREE.ClampToEdgeWrapping ? 'clamp-to-edge'
            : sourceTexture.wrapS === THREE.RepeatWrapping ? 'repeat' : 'other',
          wrapT: sourceTexture.wrapT === THREE.ClampToEdgeWrapping ? 'clamp-to-edge'
            : sourceTexture.wrapT === THREE.RepeatWrapping ? 'repeat' : 'other',
          minFilter: sourceTexture.minFilter,
          magFilter: sourceTexture.magFilter,
          generateMipmaps: sourceTexture.generateMipmaps,
          originalMipmapsArrayLength: Array.isArray(sourceTexture.mipmaps)
            ? sourceTexture.mipmaps.length : 0,
        },
        scales: scaleReports,
      });
      geometry.dispose();
    }
    const failures = samples.filter(sample => sample.status !== 'passed');
    return {
      status: failures.length === 0 && samples.length === targetSpecs.length ? 'passed' : 'failed',
      mode: 'diffuse-only',
      limits: { diffuseMaxRgbDelta: 12 },
      samples,
      failures: failures.map(sample => ({
        probeId: sample.probeId || null,
        surfaceIndex: sample.surfaceIndex, status: sample.status, reason: sample.reason || null,
      })),
    };
  } catch (error) {
    return { status: 'error', message: error && error.message ? error.message : String(error), samples };
  } finally {
    renderer.setRenderTarget(originalTarget);
    renderer.setViewport(originalViewport);
    renderer.setScissor(originalScissor);
    renderer.setScissorTest(originalScissorTest);
    renderer.setClearColor(originalClear, originalClearAlpha);
    GND_DEBUG_MODE_UNIFORM.value = originalMode;
    targetTexture.dispose();
  }
}

function runGndSharedUvGpuBoundaryAudit() {
  const scan = findGndSharedUvAuditPairs();
  if (scan.status !== 'ready') return scan;
  const audits = scan.pairs.map(pair => runSingleGndSharedUvGpuBoundaryAudit(pair));
  const failures = audits.filter(audit => audit.status !== 'passed')
    .map(audit => ({ surfaces: audit.surfaces || [], status: audit.status, failures: audit.failures || [],
      reason: audit.reason || audit.message || null }));
  const axes = [...new Set(audits.map(audit => audit.axis))];
  const hasVisibleRgbLightmap = sample => Array.isArray(sample.expected && sample.expected.rgbLightmap)
    && sample.expected.rgbLightmap.some(value => value >= 16);
  const nonzeroRgbLightmapSamples = audits.flatMap(audit => audit.scales || [])
    .flatMap(scale => scale.samples || []).filter(hasVisibleRgbLightmap).length;
  const nonzeroRgbLightmapPairs = audits.filter(audit =>
    (audit.scales || []).some(scale => (scale.samples || []).some(hasVisibleRgbLightmap))).length;
  const contrast = {
    aoContrastPairs: audits.filter(audit => audit.coverage && audit.coverage.aoDelta >= 8).length,
    rgbLightmapContrastPairs: audits.filter(audit => audit.coverage && audit.coverage.rgbLightmapDelta >= 8).length,
    vertexColorContrastPairs: audits.filter(audit => audit.coverage && audit.coverage.vertexColorMeanDelta >= 0.04).length,
    nonzeroEdgeRgbLightmapPairs: audits.filter(audit =>
      audit.coverage && audit.coverage.hasNonzeroEdgeRgbLightmap).length,
    aoRgbJointPairs: audits.filter(audit => audit.coverage
      && audit.coverage.hasNonzeroEdgeRgbLightmap && audit.coverage.aoDelta >= 8).length,
    rgbColorVariationPairs: audits.filter(audit => audit.coverage
      && audit.coverage.hasNonzeroEdgeRgbLightmap && audit.coverage.edgeRgbColorVariation >= 16).length,
    maxEdgeRgbColorVariation: Math.max(0, ...audits.map(audit =>
      audit.coverage ? audit.coverage.edgeRgbColorVariation : 0)),
    maxAoContrastDelta: Math.max(0, ...audits.map(audit =>
      audit.coverage ? audit.coverage.aoDelta : 0)),
    nonzeroRgbLightmapPairs,
    nonzeroRgbLightmapSamples,
    uniqueUvRegionPairs: new Set(audits.map(audit => audit.coverage && audit.coverage.uvRegionKey)).size,
    uniqueLightmapIds: new Set(audits.flatMap(audit => audit.lightmaps || [])).size,
  };
  return {
    status: failures.length ? 'mismatch' : 'passed',
    mapId: mapInfo && mapInfo.mapId,
    candidateCount: scan.candidateCount,
    selectedPairCount: audits.length,
    axes,
    coverage: contrast,
    audits,
    failures,
  };
}
if (explorerParams.get('roo-gnd-gpu-audit') === '1') {
  window.__rooGndGpuBoundaryAudit = {
  run: runGndSharedUvGpuBoundaryAudit,
  runTargetSurfaces: runGndTargetSurfaceGpuAudit,
  frameWhiteStreakProfileView: frameGndWhiteStreakProfileView,
};
}

function handleRenderPageHide(event) {
  // BFCache pages must keep their visibility listener so rendering resumes on pageshow.
  if (event.persisted) return;
  stopRenderLoop();
  combatFeedbackEntries.forEach(item => item.element.remove());
  combatFeedbackEntries.clear();
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

function spriteMetricsForTexture(texture) {
  const image = texture && texture.image;
  const width = image && (image.naturalWidth || image.width);
  const height = image && (image.naturalHeight || image.height);
  const bounds = measureSpriteAlphaBounds(image);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('RO 動畫影格尺寸無效。');
  }
  return { width, height, bounds };
}

function applyPlayerSpriteTexture(texture, metrics, motionKey = '') {
  if (!texture || !metrics) return false;
  playerMaterial.map = texture;
  playerMaterial.needsUpdate = true;
  playerSpriteFrameMetrics = metrics;
  playerSpriteFrameLayout = buildRoExplorerSpriteLayout(
    metrics.width, metrics.height, metrics.bounds, tileSize()
  );
  activePlayerMotionTexture = motionKey ? texture : null;
  activePlayerMotionKey = motionKey;
  lastMotionTextureUploadAt = 0;
  fallbackPlayer.visible = false;
  if (currentCell) {
    playerSprite.visible = true;
    updatePlayerPosition();
  }
  updateStats();
  return true;
}

function useLocalIdleSprite() {
  activePlayerMotionTexture = null;
  activePlayerMotionKey = '';
  if (localIdleTexture && localIdleMetrics) {
    applyPlayerSpriteTexture(localIdleTexture, localIdleMetrics);
    return true;
  }
  return false;
}

function setPlayerMotion(motion, direction) {
  currentMotionType = motion;
  currentFacing = direction;
  const key = motion + ':' + direction;
  if (desiredPlayerMotionKey === key) return;
  desiredPlayerMotionKey = key;

  const url = roExplorerAnimationUrl(explorerSpriteKey, motion, direction);
  if (!url) {
    useLocalIdleSprite();
    return;
  }

  const cachedEntry = playerMotionTextureEntries.get(key);
  if (cachedEntry) {
    applyPlayerSpriteTexture(cachedEntry.texture, cachedEntry.metrics, key);
    return;
  }

  let pending = playerMotionTextureCache.get(key);
  if (!pending) {
    pending = textureLoader.loadAsync(url).then(texture => {
      try {
        texture.colorSpace = THREE.SRGBColorSpace;
        const metrics = spriteMetricsForTexture(texture);
        return { texture, metrics };
      } catch (error) {
        texture.dispose();
        return null;
      }
    }).catch(() => null);
    playerMotionTextureCache.set(key, pending);
  }

  // Do not leave an old-facing walk loop running while the next animation loads.
  useLocalIdleSprite();
  pending.then(entry => {
    if (entry) playerMotionTextureEntries.set(key, entry);
    // Direction can change while the public renderer is still responding.
    if (desiredPlayerMotionKey !== key) return;
    if (!entry) {
      useLocalIdleSprite();
      return;
    }
    applyPlayerSpriteTexture(entry.texture, entry.metrics, key);
  });
}

function refreshAnimatedPlayerTexture(now) {
  if (!activePlayerMotionTexture || playerMaterial.map !== activePlayerMotionTexture) return;
  const interval = currentMotionType === 'walk' ? 75 : 110;
  if (now - lastMotionTextureUploadAt < interval) return;
  // The public endpoint returns APNG. Re-upload its animated HTMLImageElement so
  // WebGL samples the browser's current APNG frame instead of freezing frame zero.
  activePlayerMotionTexture.needsUpdate = true;
  lastMotionTextureUploadAt = now;
}

async function loadExplorerSpriteFrames() {
  // Keep one bundled idle pose as fallback; directional RO idle/walk APNGs load lazily.
  const url = new URL(roExplorerSpriteFramePath(explorerSpriteKey, 0), import.meta.url).href;
  let texture;
  try {
    texture = await textureLoader.loadAsync(url);
  } catch (error) {
    return false;
  }

  const metrics = spriteMetricsForTexture(texture);
  texture.colorSpace = THREE.SRGBColorSpace;
  playerSpriteFrames = [texture];
  localIdleTexture = texture;
  localIdleMetrics = metrics;
  const previousTexture = playerMaterial.map;
  applyPlayerSpriteTexture(texture, metrics);
  if (previousTexture && previousTexture !== texture && previousTexture === placeholderSpriteTexture) {
    previousTexture.dispose();
    placeholderSpriteTexture = null;
  }
  return true;
}

try {
  textureLoader.load('../images/player_swordsman.svg', texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    if (playerSpriteFrames.length) {
      texture.dispose();
      return;
    }
    placeholderSpriteTexture = texture;
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
