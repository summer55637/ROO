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
