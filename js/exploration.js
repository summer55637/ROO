/* ---------------- RO 角色探索移動 ----------------
   第一階段：在現有場景中提供鍵盤與觸控移動，座標跟角色存檔。
   第二階段再接入原生 GAT 可行走格，取代目前的自由移動邊界。 */

const RO_EXPLORATION_BOUNDS = Object.freeze({
  minX: 7, maxX: 93,
  minY: 14, maxY: 84
});

const RO_EXPLORATION_VECTORS = Object.freeze({
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0]
});

const RO_EXPLORATION_KEYS = Object.freeze({
  arrowup: 'up', w: 'up', __touch_up: 'up',
  arrowdown: 'down', s: 'down', __touch_down: 'down',
  arrowleft: 'left', a: 'left', __touch_left: 'left',
  arrowright: 'right', d: 'right', __touch_right: 'right'
});

let roExplorationHeldKeys = new Set();
let roExplorationFrameId = null;
let roExplorationLastFrame = 0;
let roExplorationSaveTimer = null;
let roExplorationTarget = null;
let roExplorationTargetMarker = null;
let roExplorationControlsBound = false;

function normalizeRoExplorationPosition(x, y) {
  const px = Number(x);
  const py = Number(y);
  return {
    x: Math.max(RO_EXPLORATION_BOUNDS.minX, Math.min(RO_EXPLORATION_BOUNDS.maxX,
      Number.isFinite(px) ? px : 18)),
    y: Math.max(RO_EXPLORATION_BOUNDS.minY, Math.min(RO_EXPLORATION_BOUNDS.maxY,
      Number.isFinite(py) ? py : 50))
  };
}

function moveRoExplorationPosition(x, y, dx, dy, distance) {
  let vx = Math.max(-1, Math.min(1, Number(dx) || 0));
  let vy = Math.max(-1, Math.min(1, Number(dy) || 0));
  const magnitude = Math.hypot(vx, vy);
  if (magnitude > 1) {
    vx /= magnitude;
    vy /= magnitude;
  }
  const step = Math.max(0, Number(distance) || 0);
  const from = normalizeRoExplorationPosition(x, y);
  return normalizeRoExplorationPosition(from.x + vx * step, from.y + vy * step);
}

function roExplorationGameIsActive() {
  if (typeof state === 'undefined' || !state) return false;
  const screen = document.getElementById('screen-game');
  return !!(screen && screen.classList.contains('active'));
}

function roExplorationEditableTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select'
    || !!target.isContentEditable;
}

function renderRoExplorationPosition() {
  if (typeof state === 'undefined' || !state) return;
  const pos = normalizeRoExplorationPosition(state.explorationX, state.explorationY);
  state.explorationX = pos.x;
  state.explorationY = pos.y;
  const scene = document.getElementById('battle-scene');
  const playerArea = document.getElementById('player-area');
  if (!scene || !playerArea) return;
  scene.classList.add('ro-exploration-active');
  playerArea.style.left = pos.x + '%';
  playerArea.style.top = pos.y + '%';
}

function scheduleRoExplorationSave() {
  if (roExplorationSaveTimer) clearTimeout(roExplorationSaveTimer);
  roExplorationSaveTimer = setTimeout(() => {
    roExplorationSaveTimer = null;
    if (typeof state !== 'undefined' && state && typeof saveGame === 'function') saveGame();
  }, 450);
}

function flushRoExplorationSave() {
  if (roExplorationSaveTimer) {
    clearTimeout(roExplorationSaveTimer);
    roExplorationSaveTimer = null;
  }
  if (typeof state !== 'undefined' && state && typeof saveGame === 'function') saveGame();
}

function setRoExplorationPosition(x, y, save) {
  if (typeof state === 'undefined' || !state) return;
  const pos = normalizeRoExplorationPosition(x, y);
  state.explorationX = pos.x;
  state.explorationY = pos.y;
  renderRoExplorationPosition();
  if (save !== false) scheduleRoExplorationSave();
}

function stepRoCharacter(direction) {
  if (!roExplorationGameIsActive()) return false;
  const vector = RO_EXPLORATION_VECTORS[direction];
  if (!vector) return false;
  const pos = moveRoExplorationPosition(
    state.explorationX, state.explorationY, vector[0], vector[1], 4
  );
  setRoExplorationPosition(pos.x, pos.y);
  return true;
}

function roExplorationTick(timestamp) {
  roExplorationFrameId = null;
  if (!roExplorationGameIsActive()) {
    roExplorationLastFrame = 0;
    return;
  }

  const hasKeys = roExplorationHeldKeys.size > 0;
  if (!hasKeys && !roExplorationTarget) {
    roExplorationLastFrame = 0;
    return;
  }

  const now = Number(timestamp) || Date.now();
  const elapsed = roExplorationLastFrame
    ? Math.max(0, Math.min(50, now - roExplorationLastFrame))
    : 16;
  roExplorationLastFrame = now;

  let dx = 0;
  let dy = 0;
  if (hasKeys) {
    roExplorationTarget = null;
    clearRoExplorationTargetMarker();
    roExplorationHeldKeys.forEach(key => {
      const direction = RO_EXPLORATION_KEYS[key];
      const vector = RO_EXPLORATION_VECTORS[direction];
      if (!vector) return;
      dx += vector[0];
      dy += vector[1];
    });
  } else if (roExplorationTarget) {
    dx = roExplorationTarget.x - state.explorationX;
    dy = roExplorationTarget.y - state.explorationY;
  }

  const distance = elapsed * 0.022;
  const remaining = Math.hypot(dx, dy);
  if (!hasKeys && roExplorationTarget && remaining <= distance) {
    setRoExplorationPosition(roExplorationTarget.x, roExplorationTarget.y, false);
    roExplorationTarget = null;
    clearRoExplorationTargetMarker();
    scheduleRoExplorationSave();
    roExplorationLastFrame = 0;
    return;
  }

  const pos = moveRoExplorationPosition(
    state.explorationX, state.explorationY, dx, dy, distance
  );
  if (pos.x !== state.explorationX || pos.y !== state.explorationY) {
    setRoExplorationPosition(pos.x, pos.y, false);
    scheduleRoExplorationSave();
  }
  roExplorationFrameId = requestAnimationFrame(roExplorationTick);
}
function startRoExplorationFrame() {
  if (roExplorationFrameId !== null || (!roExplorationHeldKeys.size && !roExplorationTarget)) return;
  roExplorationLastFrame = 0;
  roExplorationFrameId = requestAnimationFrame(roExplorationTick);
}

function onRoExplorationKeyDown(event) {
  if (!roExplorationGameIsActive() || roExplorationEditableTarget(event.target)) return;
  const key = String(event.key || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(RO_EXPLORATION_KEYS, key)) return;
  if (event.preventDefault) event.preventDefault();
  roExplorationHeldKeys.add(key);
  roExplorationTarget = null;
  clearRoExplorationTargetMarker();
  startRoExplorationFrame();
}

function onRoExplorationKeyUp(event) {
  const key = String(event.key || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(RO_EXPLORATION_KEYS, key)) return;
  roExplorationHeldKeys.delete(key);
  if (!roExplorationHeldKeys.size && !roExplorationTarget) {
    if (roExplorationFrameId !== null) cancelAnimationFrame(roExplorationFrameId);
    roExplorationFrameId = null;
    roExplorationLastFrame = 0;
    scheduleRoExplorationSave();
  }
}

function holdRoCharacterDirection(direction, event) {
  if (!roExplorationGameIsActive() || !RO_EXPLORATION_VECTORS[direction]) return;
  if (event && event.preventDefault) event.preventDefault();
  roExplorationHeldKeys.add('__touch_' + direction);
  roExplorationTarget = null;
  clearRoExplorationTargetMarker();
  startRoExplorationFrame();
}

function releaseRoCharacterDirection(direction) {
  roExplorationHeldKeys.delete('__touch_' + direction);
  if (!roExplorationHeldKeys.size && !roExplorationTarget) {
    if (roExplorationFrameId !== null) cancelAnimationFrame(roExplorationFrameId);
    roExplorationFrameId = null;
    roExplorationLastFrame = 0;
    scheduleRoExplorationSave();
  }
}

function clearRoExplorationTargetMarker() {
  if (roExplorationTargetMarker && roExplorationTargetMarker.parentNode) {
    roExplorationTargetMarker.parentNode.removeChild(roExplorationTargetMarker);
  }
  roExplorationTargetMarker = null;
}

function onRoExplorationSceneClick(event) {
  if (!roExplorationGameIsActive() || !event || event.button > 0) return;
  const target = event.target;
  if (target && typeof target.closest === 'function'
    && target.closest('button, a, input, select, textarea, .monster-slot, .damage-float, .exploration-controls, .ally-panel, .gm-panel, .idle-report-panel')) return;
  const scene = document.getElementById('battle-scene');
  if (!scene) return;
  const rect = scene.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const pos = normalizeRoExplorationPosition(
    ((event.clientX - rect.left) / rect.width) * 100,
    ((event.clientY - rect.top) / rect.height) * 100
  );
  roExplorationHeldKeys.clear();
  roExplorationTarget = pos;
  clearRoExplorationTargetMarker();

  roExplorationTargetMarker = document.createElement('span');
  roExplorationTargetMarker.className = 'exploration-target-marker';
  roExplorationTargetMarker.setAttribute('aria-hidden', 'true');
  roExplorationTargetMarker.style.left = pos.x + '%';
  roExplorationTargetMarker.style.top = pos.y + '%';
  scene.appendChild(roExplorationTargetMarker);

  startRoExplorationFrame();
}

function bindRoExplorationControls() {
  if (roExplorationControlsBound) return;
  roExplorationControlsBound = true;
  const scene = document.getElementById('battle-scene');
  if (scene) scene.addEventListener('click', onRoExplorationSceneClick);

  document.querySelectorAll('.exploration-controls button[data-direction]').forEach(button => {
    const direction = button.dataset.direction;
    button.addEventListener('pointerdown', event => holdRoCharacterDirection(direction, event));
    const release = () => releaseRoCharacterDirection(direction);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
}

function stopRoExplorationMovement() {
  roExplorationHeldKeys.clear();
  roExplorationTarget = null;
  clearRoExplorationTargetMarker();
  if (roExplorationFrameId !== null) cancelAnimationFrame(roExplorationFrameId);
  roExplorationFrameId = null;
  roExplorationLastFrame = 0;
  flushRoExplorationSave();
}

function initRoExploration() {
  if (typeof state === 'undefined' || !state) return;
  bindRoExplorationControls();
  renderRoExplorationPosition();
}

document.addEventListener('keydown', onRoExplorationKeyDown);
document.addEventListener('keyup', onRoExplorationKeyUp);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRoExplorationMovement();
});
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('blur', stopRoExplorationMovement);
}
