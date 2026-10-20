import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  RAGASSETS_BASE_URL,
  buildGndLightmapAtlasData,
  computeGndLightDirection,
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
  insetGndTextureUvs,
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

const stage = document.getElementById('stage');
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
      '#include <common>\nuniform sampler2D rooGndLightMap;'
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
        + '}'
    );
  };
  material.customProgramCacheKey = () => 'roo-gnd-baked-lightmap-v6-independent-diffuse-vertex-debug';
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
    const texturedBuckets = meshData.buckets.filter(bucket => bucket.textureIndex >= 0);
    const nextTerrainTextureDiagnostics = {
      mapId,
      total: texturedBuckets.length,
      resolved: 0,
      loaded: 0,
      failed: 0,
      missing: [],
    };
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
      if (lightmapAtlas) {
        geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(bucket.lightmapUvs, 2));
        geometry.setAttribute('rooGndHasLightmap', new THREE.Float32BufferAttribute(bucket.lightmapEnabled, 1));
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
      geometry.setIndex(bucket.indices);
      geometry.computeVertexNormals();
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

      let material;
      let texture = null;
      const textureName = bucket.textureIndex >= 0 ? parsedGnd.textures[bucket.textureIndex] : '';
      const textureUrl = resolveMapTextureUrl(urls.textures, textureName);
      if (textureUrl) {
        nextTerrainTextureDiagnostics.resolved++;
        texture = textureLoader.load(textureUrl, loadedTexture => {
          loadedTexture.colorSpace = THREE.SRGBColorSpace;
          loadedTexture.wrapS = THREE.RepeatWrapping;
          loadedTexture.wrapT = THREE.RepeatWrapping;
          // GND diffuse UVs often address sub-rectangles inside a shared texture.
          // A whole-image mip chain blends adjacent sub-rectangles at distance,
          // even after half-texel UV insetting, so sample the padded source level.
          loadedTexture.generateMipmaps = false;
          loadedTexture.minFilter = THREE.LinearFilter;
          loadedTexture.magFilter = THREE.LinearFilter;
          const textureWidth = loadedTexture.image && (loadedTexture.image.naturalWidth || loadedTexture.image.width);
          const textureHeight = loadedTexture.image && (loadedTexture.image.naturalHeight || loadedTexture.image.height);
          if (textureWidth > 0 && textureHeight > 0) {
            const uvAttribute = geometry.getAttribute('uv');
            uvAttribute.array.set(insetGndTextureUvs(uvAttribute.array, textureWidth, textureHeight));
            uvAttribute.needsUpdate = true;
          }
          loadedTexture.needsUpdate = true;
          nextTerrainTextureDiagnostics.loaded++;
          if (terrainTextureDiagnostics === nextTerrainTextureDiagnostics) updateStats();
        }, undefined, () => {
          nextTerrainTextureDiagnostics.failed++;
          if (terrainTextureDiagnostics === nextTerrainTextureDiagnostics) updateStats();
          if (material) {
            material.map = null;
            material.color.set('#9cb68c');
            material.needsUpdate = true;
          }
        });
        // Set the sampling policy before the first draw, not only when loading completes.
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
      } else if (bucket.textureIndex >= 0) {
        const missingName = textureName || '(空白材質名稱)';
        if (!nextTerrainTextureDiagnostics.missing.includes(missingName)) {
          nextTerrainTextureDiagnostics.missing.push(missingName);
        }
      }
      if (lightmapAtlas) {
        material = new THREE.MeshBasicMaterial({
          map: texture,
          color: texture ? 0xffffff : 0x9cb68c,
          vertexColors: true,
          side: THREE.DoubleSide,
        });
        applyGndBakedLighting(material, lightmapTexture, aoTexture, parsedRsw.light);
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
      mesh.userData.rooGndSurfaceIndices = bucket.surfaceIndices;
      mesh.userData.rooGndTextureIndex = bucket.textureIndex;
      mesh.userData.rooGndTextureName = textureName;
      mesh.userData.rooGndTextureUrl = textureUrl || '';
      mesh.userData.rooGndDiffuseSampler = texture ? {
        generateMipmaps: texture.generateMipmaps,
        minFilter: texture.minFilter,
        magFilter: texture.magFilter,
      } : null;
      mesh.userData.rooGndLightmapSampler = lightmapTexture ? {
        generateMipmaps: lightmapTexture.generateMipmaps,
        minFilter: lightmapTexture.minFilter,
        magFilter: lightmapTexture.magFilter,
      } : null;
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

function sampleGndSourceTexturePixel(texture, uv) {
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

  const u = ((uv[0] % 1) + 1) % 1;
  const v = ((uv[1] % 1) + 1) % 1;
  const x = Math.max(0, Math.min(width - 1, Math.floor(u * width)));
  const y = Math.max(0, Math.min(height - 1, height - 1 - Math.floor(v * height)));
  try {
    const pixel = cached.context.getImageData(x, y, 1, 1).data;
    return 'rgba(' + pixel[0] + ', ' + pixel[1] + ', ' + pixel[2] + ', ' + pixel[3]
      + ') @ (' + x + ', ' + y + ')';
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

  // Convert the interpolated GPU atlas UV back to this surface's original GND slice.
  // Round to the nearest source texel and clamp to the six interior pixels; the
  // outer ring is a filtering border, not valid surface light data.
  const columns = Math.ceil(Math.sqrt(slices.length));
  const rows = Math.ceil(slices.length / columns);
  const gutter = 4;
  const cellWidth = width + gutter * 2;
  const cellHeight = height + gutter * 2;
  const atlasWidth = columns * cellWidth;
  const atlasHeight = rows * cellHeight;
  const baseX = (index % columns) * cellWidth + gutter;
  const baseY = Math.floor(index / columns) * cellHeight + gutter;
  const x = Math.max(width >= 4 ? 1 : 0,
    Math.min(width >= 4 ? width - 2 : width - 1,
      Math.round(atlasUv[0] * atlasWidth - baseX - 0.5)));
  const y = Math.max(height >= 4 ? 1 : 0,
    Math.min(height >= 4 ? height - 2 : height - 1,
      Math.round(atlasUv[1] * atlasHeight - baseY - 0.5)));
  const channels = slice.channels || 4;
  const pixelOffset = (y * width + x) * channels;
  const rgb = Array.from(slice.colorPixels.slice(pixelOffset, pixelOffset + 3));
  const ao = slice.shadowPixels
    ? slice.shadowPixels[y * width + x]
    : channels === 4 ? slice.colorPixels[pixelOffset + 3] : 255;
  return { x, y, rgb, ao };
}

function describeGndTextureFilters(texture) {
  if (!texture) return '無已載入貼圖';
  const filterName = value => value === THREE.LinearFilter ? 'LinearFilter'
    : value === THREE.NearestFilter ? 'NearestFilter' : 'mipmap filter (' + value + ')';
  return 'mipmap=' + (texture.generateMipmaps ? 'on' : 'off')
    + '; min=' + filterName(texture.minFilter)
    + '; mag=' + filterName(texture.magFilter);
}

function updateGndSurfaceInspector(event) {
  if (GND_DEBUG_MODE_UNIFORM.value !== 7 && GND_DEBUG_MODE_UNIFORM.value !== 8) {
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
  const colorAttribute = geometry.getAttribute('color');
  const baseVertex = quadIndex * 4;
  const actualUvs = [];
  const actualColors = [];
  for (let corner = 0; corner < 4; corner++) {
    const vertexIndex = baseVertex + corner;
    actualUvs.push(uvAttribute
      ? [uvAttribute.getX(vertexIndex), uvAttribute.getY(vertexIndex)] : [NaN, NaN]);
    actualColors.push(colorAttribute
      ? [colorAttribute.getX(vertexIndex), colorAttribute.getY(vertexIndex), colorAttribute.getZ(vertexIndex)]
      : [1, 1, 1]);
  }

  const texture = object.material && object.material.map;
  const textureName = gndInfo.textures[surface.textureIndex] || object.userData.rooGndTextureName || '(未指定)';
  const uvLines = actualUvs.map((uv, corner) => (
    '  幾何角 ' + corner + ': 實際 UV (' + formatGndDiagnosticVector(uv) + ')；來源像素 '
      + sampleGndSourceTexturePixel(texture, uv)
  ));
  const colorLines = actualColors.map((color, corner) => (
    '  幾何角 ' + corner + ': RGB (' + formatGndDiagnosticVector(color) + ')'
  ));
  const lightmapLines = [0, 1, 2, 3].map(corner => (
    '  ' + ['SW', 'SE', 'NW', 'NE'][corner] + ': '
      + sampleGndLightmapSourceCorner(surface, corner)
  ));
  const cursorLightmapUv = sampleGndAttributeAtHit(hit, 'uv2');
  const cursorVertexColor = sampleGndAttributeAtHit(hit, 'color');
  const cursorLightmapSample = cursorLightmapUv
    ? sampleGndLightmapSourceAtUv(surface, cursorLightmapUv) : null;
  const samplerDescription = sampler => {
    if (!sampler) return '未啟用';
    const filterName = value => value === THREE.LinearFilter ? 'LinearFilter'
      : value === THREE.NearestFilter ? 'NearestFilter' : 'mipmap filter (' + value + ')';
    return 'mipmap=' + (sampler.generateMipmaps ? 'on' : 'off')
      + '; min=' + filterName(sampler.minFilter)
      + '; mag=' + filterName(sampler.magFilter);
  };
  const detail = [
    '地圖：' + (mapInfo && mapInfo.mapId || '未知'),
    'Surface #' + surfaceIndex + '；triangle #' + hit.faceIndex + '；quad #' + quadIndex,
    '真實材質路徑：' + textureName,
    '實際載入 URL：' + (object.userData.rooGndTextureUrl || '無；使用純色備援'),
    'Diffuse 貼圖採樣：' + samplerDescription(object.userData.rooGndDiffuseSampler),
    'RGB lightmap/AO 採樣：' + samplerDescription(object.userData.rooGndLightmapSampler),
    '材質索引：' + surface.textureIndex + '；lightmap 索引：' + surface.lightmapIndex,
    '游標處插值 UV：(' + formatGndDiagnosticVector([hit.uv.x, hit.uv.y]) + ')',
    '游標處原貼圖像素近似值：' + sampleGndSourceTexturePixel(texture, [hit.uv.x, hit.uv.y]),
    '游標處插值頂點色 RGB：' + (cursorVertexColor
      ? '(' + formatGndDiagnosticVector(cursorVertexColor.slice(0, 3)) + ')'
      : '無法取得'),
    '游標處 Lightmap atlas UV2：' + (cursorLightmapUv
      ? '(' + formatGndDiagnosticVector(cursorLightmapUv) + ')' : '無法取得'),
    '游標處來源 RGB lightmap / AO 最近像素（原始 GND bytes）：'
      + (cursorLightmapSample
        ? 'RGB (' + cursorLightmapSample.rgb.join(', ') + '); AO ' + cursorLightmapSample.ao
          + ' @ (' + cursorLightmapSample.x + ', ' + cursorLightmapSample.y + ')'
        : '無法取樣'),
    '原始 RGB lightmap / AO 四角取樣（來源 GND 像素，不是渲染猜測）：',
    ...lightmapLines,
    '原始四角 UV（UV0..UV3）：',
    ...(surface.uv || []).map((uv, index) => '  UV' + index + ': (' + formatGndDiagnosticVector(uv) + ')'),
    '渲染網格四角（含半像素內縮）與原貼圖像素近似取樣：',
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
  if (GND_DEBUG_MODE_UNIFORM.value === 7 || GND_DEBUG_MODE_UNIFORM.value === 8) {
    gndSurfaceInspector.hidden = false;
    gndSurfaceInspectorContent.textContent = '把滑鼠移到地表，即可查看來源貼圖路徑、四角 UV、貼圖像素、頂點色與 GPU 畫面取樣。';
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
    renderer.render(scene, camera);
    sampleGndInspectorFramebuffer();
  },
  callback => window.requestAnimationFrame(callback),
  frameId => window.cancelAnimationFrame(frameId)
);

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
