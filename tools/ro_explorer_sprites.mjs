export const DEFAULT_RO_EXPLORER_SPRITE = 'swordsman_male';
export const RO_SPRITE_ANIMATION_BASE_URL = 'https://assets.latam-tools.com.br/image';

const SPRITE_KEY_PATTERN = /^[a-z0-9_]{1,64}$/;
const RO_SPRITE_JOB_IDS = Object.freeze({
  novice: 0,
  swordsman: 1,
  mage: 2,
  archer: 3,
  acolyte: 4,
  merchant: 5,
  thief: 6,
  knight: 7,
  priest: 8,
  wizard: 9,
  blacksmith: 10,
  hunter: 11,
  assassin: 12,
  crusader: 14,
  monk: 15,
  sage: 16,
  rogue: 17,
  alchemist: 18,
  bard: 19,
  dancer: 20,
  supernovice: 23,
  lordknight: 4008,
  highpriest: 4009,
  highwizard: 4010,
  whitesmith: 4011,
  sniper: 4012,
  assassincross: 4013,
  paladin: 4015,
  champion: 4016,
  professor: 4017,
  stalker: 4018,
  creator: 4019,
  clown: 4020,
  gypsy: 4021,
  runeknight: 4054,
  warlock: 4055,
  ranger: 4056,
  archbishop: 4057,
  mechanic: 4058,
  guillotinecross: 4059,
  royalguard: 4066,
  sorcerer: 4067,
  minstrel: 4068,
  wanderer: 4069,
  sura: 4070,
  geneticist: 4071,
  shadowchaser: 4072,
});
const RO_SPRITE_MOUNT_JOB_IDS = Object.freeze({
  knight: 13,
  crusader: 21,
  lordknight: 4014,
  paladin: 4022,
});

export function resolveRoExplorerSpriteKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return SPRITE_KEY_PATTERN.test(key) ? key : DEFAULT_RO_EXPLORER_SPRITE;
}

export function roExplorerSpriteFramePath(value, frameIndex) {
  const key = resolveRoExplorerSpriteKey(value);
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex > 19) {
    throw new RangeError('角色影格索引必須介於 0 與 19。');
  }
  return '../images/frames/' + key + '/frame_' + String(frameIndex).padStart(3, '0') + '.png';
}

export function buildRoExplorerSpriteLayout(canvasWidth, canvasHeight, bounds, tileSize) {
  if (!Number.isInteger(canvasWidth) || !Number.isInteger(canvasHeight)
    || canvasWidth < 1 || canvasHeight < 1) {
    throw new TypeError('角色影格畫布尺寸必須是正整數。');
  }
  if (!bounds || ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)
    || bounds.left < 0 || bounds.top < 0 || bounds.right > canvasWidth
    || bounds.bottom > canvasHeight || bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    throw new Error('角色影格可見範圍無效。');
  }
  if (!Number.isFinite(tileSize) || tileSize <= 0 || tileSize > 1000) {
    throw new RangeError('角色影格格子比例無效。');
  }

  const bodyWidth = bounds.right - bounds.left;
  const bodyHeight = bounds.bottom - bounds.top;
  const scale = Math.min(
    tileSize * 1.55 / bodyHeight,
    tileSize * 1.45 / bodyWidth,
    tileSize * 2.8 / canvasHeight,
    tileSize * 2.4 / canvasWidth
  );
  return {
    scale,
    width: canvasWidth * scale,
    height: canvasHeight * scale,
    offsetX: (canvasWidth / 2 - (bounds.left + bounds.right) / 2) * scale,
    offsetY: (bounds.bottom - canvasHeight / 2) * scale,
  };
}

export function resolveRoExplorerJob(value) {
  const key = resolveRoExplorerSpriteKey(value);
  const match = key.match(/^(.+)_(male|female)(?:_mount)?$/);
  if (!match) return null;

  const jobKey = match[1];
  const gender = match[2];
  const mounted = key.endsWith('_mount');
  const jobId = mounted ? RO_SPRITE_MOUNT_JOB_IDS[jobKey] : RO_SPRITE_JOB_IDS[jobKey];
  if (!Number.isInteger(jobId) || jobId < 0) return null;
  return { jobId, gender, mounted };
}

export function roExplorerAnimationUrl(value, motion, direction) {
  if (motion !== 'idle' && motion !== 'walk') {
    throw new TypeError('角色動作只能是 idle 或 walk。');
  }
  if (!Number.isInteger(direction) || direction < 0 || direction > 7) {
    throw new RangeError('RO 方向索引必須介於 0 與 7。');
  }
  const identity = resolveRoExplorerJob(value);
  if (!identity) return null;

  const url = new URL(RO_SPRITE_ANIMATION_BASE_URL);
  url.searchParams.set('job', String(identity.jobId));
  url.searchParams.set('gender', identity.gender);
  url.searchParams.set('action', String((motion === 'walk' ? 8 : 0) + direction));
  return url.toString();
}

export function roExplorerDirectionFromDelta(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new TypeError('移動方向必須是有限數值。');
  }
  if (dx === 0 && dy === 0) return null;
  // RO actions use S, SW, W, NW, N, NE, E, SE; GAT rows increase southward.
  const octant = Math.round(Math.atan2(-dx, dy) / (Math.PI / 4));
  return ((octant % 8) + 8) % 8;
}
