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
let roExplorationGatMap = null;
let roExplorationPath = [];

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

function moveRoExplorationPosition(x, y, dx, dy, distance, aspectRatio) {
  const vx = Number(dx) || 0;
  const vy = Number(dy) || 0;
  const magnitude = Math.hypot(vx, vy);
  const step = Math.max(0, Number(distance) || 0);
  const ratioValue = Number(aspectRatio);
  const ratio = Number.isFinite(ratioValue) && ratioValue > 0 ? ratioValue : 1;
  const from = normalizeRoExplorationPosition(x, y);
  if (!magnitude || !step) return from;
  return normalizeRoExplorationPosition(
    from.x + (vx / magnitude) * step,
    from.y + (vy / magnitude) * step * ratio
  );
}

function findNearestRoWalkableTile(start, mapData) {
  if (!start || !mapData || typeof mapData.isWalkable !== 'function') return null;
  let best = null;
  let bestDistance = Infinity;
  for (let y = 0; y < mapData.height; y++) {
    for (let x = 0; x < mapData.width; x++) {
      if (!mapData.isWalkable(x, y)) continue;
      const distance = (x - start.x) * (x - start.x) + (y - start.y) * (y - start.y);
      if (distance < bestDistance) {
        best = { x, y };
        bestDistance = distance;
      }
    }
  }
  return best;
}

function setRoExplorationGatMap(mapData) {
  roExplorationGatMap = mapData && typeof mapData.findPath === 'function'
    && typeof mapData.isWalkable === 'function'
    && Number.isInteger(mapData.width) && mapData.width > 0
    && Number.isInteger(mapData.height) && mapData.height > 0
    ? mapData : null;
  roExplorationPath = [];
  roExplorationTarget = null;
  clearRoExplorationTargetMarker();
  if (roExplorationFrameId !== null) cancelAnimationFrame(roExplorationFrameId);
  roExplorationFrameId = null;
  roExplorationLastFrame = 0;
  setRoExplorationMoving(false);

  if (roExplorationGatMap && typeof state !== 'undefined' && state) {
    const tile = roExplorationPositionToTile(state.explorationX, state.explorationY, roExplorationGatMap);
    if (!roExplorationGatMap.isWalkable(tile.x, tile.y)) {
      const nearest = findNearestRoWalkableTile(tile, roExplorationGatMap);
      const position = nearest && roExplorationTileToPosition(nearest, roExplorationGatMap);
      if (position) setRoExplorationPosition(position.x, position.y);
    }
  }
}

function roExplorationPositionToTile(x, y, mapData) {
  if (!mapData || mapData.width < 1 || mapData.height < 1) return null;
  const pos = normalizeRoExplorationPosition(x, y);
  const xRatio = (pos.x - RO_EXPLORATION_BOUNDS.minX)
    / (RO_EXPLORATION_BOUNDS.maxX - RO_EXPLORATION_BOUNDS.minX);
  const yRatio = (pos.y - RO_EXPLORATION_BOUNDS.minY)
    / (RO_EXPLORATION_BOUNDS.maxY - RO_EXPLORATION_BOUNDS.minY);
  return {
    x: Math.max(0, Math.min(mapData.width - 1, Math.round(xRatio * (mapData.width - 1)))),
    y: Math.max(0, Math.min(mapData.height - 1,
      mapData.height - 1 - Math.round(yRatio * (mapData.height - 1))))
  };
}

function roExplorationTileToPosition(tile, mapData) {
  if (!tile || !mapData || mapData.width < 1 || mapData.height < 1) return null;
  const xRatio = mapData.width > 1 ? tile.x / (mapData.width - 1) : 0.5;
  const yRatio = mapData.height > 1 ? (mapData.height - 1 - tile.y) / (mapData.height - 1) : 0.5;
  return normalizeRoExplorationPosition(
    RO_EXPLORATION_BOUNDS.minX + xRatio * (RO_EXPLORATION_BOUNDS.maxX - RO_EXPLORATION_BOUNDS.minX),
    RO_EXPLORATION_BOUNDS.minY + yRatio * (RO_EXPLORATION_BOUNDS.maxY - RO_EXPLORATION_BOUNDS.minY)
  );
}

function buildRoExplorationPath(startX, startY, endX, endY, mapData) {
  if (!mapData || typeof mapData.findPath !== 'function') return null;
  const start = roExplorationPositionToTile(startX, startY, mapData);
  const end = roExplorationPositionToTile(endX, endY, mapData);
  if (!start || !end) return null;
  const route = mapData.findPath(start.x, start.y, end.x, end.y, {
    diagonal: true,
    preventCornerCutting: true
  });
  if (!route) return null;
  return route.map(tile => roExplorationTileToPosition(tile, mapData)).filter(Boolean);
}

function roExplorationCanTraverse(fromX, fromY, toX, toY, mapData) {
  if (!mapData || typeof mapData.isWalkable !== 'function') return true;
  const from = roExplorationPositionToTile(fromX, fromY, mapData);
  const to = roExplorationPositionToTile(toX, toY, mapData);
  if (!from || !to || !mapData.isWalkable(from.x, from.y) || !mapData.isWalkable(to.x, to.y)) return false;

  // 每個動畫影格可能跨過數個地圖格，逐段檢查避免高速移動穿過薄牆。
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)) * 2);
  let previous = from;
  for (let step = 1; step <= steps; step++) {
    const next = {
      x: Math.round(from.x + dx * step / steps),
      y: Math.round(from.y + dy * step / steps)
    };
    if (next.x === previous.x && next.y === previous.y) continue;
    if (!mapData.isWalkable(next.x, next.y)) return false;
    if (next.x !== previous.x && next.y !== previous.y
      && (!mapData.isWalkable(next.x, previous.y)
        || !mapData.isWalkable(previous.x, next.y))) return false;
    previous = next;
  }
  return true;
}

function roExplorationDirectionForKey(key) {
  return RO_EXPLORATION_KEYS[String(key || '').toLowerCase()] || null;
}

function roExplorationGameIsActive() {
  if (typeof state === 'undefined' || !state) return false;
  const screen = document.getElementById('screen-game');
  return !!(screen && screen.classList.contains('active'));
}

function roExplorationAspectRatio() {
  const scene = document.getElementById('battle-scene');
  if (!scene || typeof scene.getBoundingClientRect !== 'function') return 1;
  const rect = scene.getBoundingClientRect();
  if (!rect.width || !rect.height) return 1;
  const ratio = rect.width / rect.height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function setRoExplorationMoving(moving) {
  const scene = document.getElementById('battle-scene');
  if (scene) scene.classList.toggle('ro-exploration-moving', !!moving);
}

function updateRoExplorationFacing(dx) {
  if (!dx) return;
  const playerArea = document.getElementById('player-area');
  if (playerArea) playerArea.dataset.facing = dx < 0 ? 'left' : 'right';
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
  if (typeof ROProntera3D !== 'undefined' && ROProntera3D.isActive()) {
    const rect = scene.getBoundingClientRect();
    const point = ROProntera3D.projectExplorationPosition(pos.x, pos.y, rect.width, rect.height);
    if (point) {
      scene.classList.add('ro-prontera-3d');
      playerArea.style.left = point.x + 'px';
      playerArea.style.top = (point.y - 52) + 'px';
      return;
    }
  }
  scene.classList.remove('ro-prontera-3d');
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
    state.explorationX, state.explorationY, vector[0], vector[1], 4,
    roExplorationAspectRatio()
  );
  if (roExplorationGatMap && !roExplorationCanTraverse(
    state.explorationX, state.explorationY, pos.x, pos.y, roExplorationGatMap
  )) return false;
  setRoExplorationPosition(pos.x, pos.y);
  return true;
}

function roExplorationTick(timestamp) {
  roExplorationFrameId = null;
  if (!roExplorationGameIsActive()) {
    setRoExplorationMoving(false);
    roExplorationLastFrame = 0;
    return;
  }

  const hasKeys = roExplorationHeldKeys.size > 0;
  if (!hasKeys && !roExplorationTarget) {
    setRoExplorationMoving(false);
    roExplorationLastFrame = 0;
    return;
  }

  const now = Number(timestamp) || Date.now();
  const elapsed = roExplorationLastFrame
    ? Math.max(0, Math.min(50, now - roExplorationLastFrame))
    : 16;
  roExplorationLastFrame = now;

  const aspectRatio = roExplorationAspectRatio();
  let dx = 0;
  let dy = 0;
  if (hasKeys) {
    roExplorationTarget = null;
    clearRoExplorationTargetMarker();
    roExplorationHeldKeys.forEach(key => {
      const direction = roExplorationDirectionForKey(key);
      const vector = RO_EXPLORATION_VECTORS[direction];
      if (!vector) return;
      dx += vector[0];
      dy += vector[1];
    });
  } else if (roExplorationPath.length) {
    const waypoint = roExplorationPath[0];
    dx = waypoint.x - state.explorationX;
    dy = (waypoint.y - state.explorationY) / aspectRatio;
  } else if (roExplorationTarget) {
    dx = roExplorationTarget.x - state.explorationX;
    dy = (roExplorationTarget.y - state.explorationY) / aspectRatio;
  }

  const distance = elapsed * 0.022;
  const activeWaypoint = roExplorationPath.length ? roExplorationPath[0] : roExplorationTarget;
  const remaining = activeWaypoint && !hasKeys
    ? Math.hypot(
      activeWaypoint.x - state.explorationX,
      (activeWaypoint.y - state.explorationY) / aspectRatio
    )
    : Math.hypot(dx, dy);

  if (!hasKeys && activeWaypoint && remaining <= distance) {
    setRoExplorationPosition(activeWaypoint.x, activeWaypoint.y, false);
    if (roExplorationPath.length) roExplorationPath.shift();
    if (!roExplorationPath.length) {
      roExplorationTarget = null;
      clearRoExplorationTargetMarker();
      setRoExplorationMoving(false);
      scheduleRoExplorationSave();
      roExplorationLastFrame = 0;
      return;
    }
    roExplorationFrameId = requestAnimationFrame(roExplorationTick);
    return;
  }

  let pos = moveRoExplorationPosition(
    state.explorationX, state.explorationY, dx, dy, distance, aspectRatio
  );
  if (roExplorationGatMap
    && !roExplorationCanTraverse(state.explorationX, state.explorationY, pos.x, pos.y, roExplorationGatMap)) {
    if (hasKeys) {
      const currentX = state.explorationX;
      const currentY = state.explorationY;
      const candidates = [
        moveRoExplorationPosition(currentX, currentY, dx, 0, distance, aspectRatio),
        moveRoExplorationPosition(currentX, currentY, 0, dy, distance, aspectRatio)
      ].filter(candidate => roExplorationCanTraverse(
        currentX, currentY, candidate.x, candidate.y, roExplorationGatMap
      ));
      if (candidates.length) {
        candidates.sort((left, right) => {
          const leftProgress = (left.x - currentX) * dx + (left.y - currentY) * dy;
          const rightProgress = (right.x - currentX) * dx + (right.y - currentY) * dy;
          return rightProgress - leftProgress;
        });
        pos = candidates[0];
      } else {
        pos = normalizeRoExplorationPosition(currentX, currentY);
      }
    } else {
      roExplorationPath = [];
      roExplorationTarget = null;
      clearRoExplorationTargetMarker();
      pos = normalizeRoExplorationPosition(state.explorationX, state.explorationY);
    }
  }
  const changed = pos.x !== state.explorationX || pos.y !== state.explorationY;
  setRoExplorationMoving(changed);
  if (changed) {
    updateRoExplorationFacing(dx);
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
  if (!roExplorationDirectionForKey(key)) return;
  if (event.preventDefault) event.preventDefault();
  roExplorationHeldKeys.add(key);
  roExplorationTarget = null;
  roExplorationPath = [];
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
  roExplorationPath = [];
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

  let pos;
  if (roExplorationGatMap && typeof ROProntera3D !== 'undefined' && ROProntera3D.isActive()) {
    pos = ROProntera3D.screenToExplorationPosition(event.clientX, event.clientY, rect);
    if (!pos) return;
    pos = normalizeRoExplorationPosition(pos.x, pos.y);
  } else {
    pos = normalizeRoExplorationPosition(
      ((event.clientX - rect.left) / rect.width) * 100,
      ((event.clientY - rect.top) / rect.height) * 100
    );
  }
  roExplorationHeldKeys.clear();
  roExplorationPath = [];
  if (roExplorationGatMap) {
    const route = buildRoExplorationPath(
      state.explorationX, state.explorationY, pos.x, pos.y, roExplorationGatMap
    );
    if (!route) {
      roExplorationTarget = null;
      clearRoExplorationTargetMarker();
      setRoExplorationMoving(false);
      if (typeof showToast === 'function') showToast('該位置不可通行，或沒有可行走路線。');
      return;
    }
    roExplorationPath = route;
    const snappedTarget = route.length ? route[route.length - 1] : normalizeRoExplorationPosition(
      state.explorationX, state.explorationY
    );
    roExplorationTarget = snappedTarget;
    pos.x = snappedTarget.x;
    pos.y = snappedTarget.y;
  } else {
    roExplorationTarget = pos;
  }
  clearRoExplorationTargetMarker();

  roExplorationTargetMarker = document.createElement('span');
  roExplorationTargetMarker.className = 'exploration-target-marker';
  roExplorationTargetMarker.setAttribute('aria-hidden', 'true');
  if (typeof ROProntera3D !== 'undefined' && ROProntera3D.isActive()) {
    const point = ROProntera3D.projectExplorationPosition(pos.x, pos.y, rect.width, rect.height);
    roExplorationTargetMarker.style.left = point ? point.x + 'px' : pos.x + '%';
    roExplorationTargetMarker.style.top = point ? point.y + 'px' : pos.y + '%';
  } else {
    roExplorationTargetMarker.style.left = pos.x + '%';
    roExplorationTargetMarker.style.top = pos.y + '%';
  }
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
    button.addEventListener('pointerdown', event => {
      if (event.currentTarget && typeof event.currentTarget.setPointerCapture === 'function'
        && event.pointerId != null) {
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch (e) { /* 不支援時仍可按住 */ }
      }
      holdRoCharacterDirection(direction, event);
    });
    const release = () => releaseRoCharacterDirection(direction);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
}

function stopRoExplorationMovement() {
  roExplorationHeldKeys.clear();
  roExplorationPath = [];
  roExplorationTarget = null;
  clearRoExplorationTargetMarker();
  if (roExplorationFrameId !== null) cancelAnimationFrame(roExplorationFrameId);
  roExplorationFrameId = null;
  roExplorationLastFrame = 0;
  setRoExplorationMoving(false);
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
