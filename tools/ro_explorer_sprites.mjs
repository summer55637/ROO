export const DEFAULT_RO_EXPLORER_SPRITE = 'swordsman_male';
const SPRITE_KEY_PATTERN = /^[a-z0-9_]{1,64}$/;

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
