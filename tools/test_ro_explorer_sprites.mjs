import assert from 'node:assert/strict';
import {
  DEFAULT_RO_EXPLORER_SPRITE,
  resolveRoExplorerSpriteKey,
  roExplorerSpriteFramePath,
} from './ro_explorer_sprites.mjs';

assert.equal(DEFAULT_RO_EXPLORER_SPRITE, 'swordsman_male');
assert.equal(resolveRoExplorerSpriteKey('lordknight_male'), 'lordknight_male');
assert.equal(resolveRoExplorerSpriteKey('lordknight_male_mount'), 'lordknight_male_mount');
assert.equal(resolveRoExplorerSpriteKey(' NOVICE_FEMALE '), 'novice_female');
assert.equal(resolveRoExplorerSpriteKey('../../secret'), DEFAULT_RO_EXPLORER_SPRITE);
assert.equal(resolveRoExplorerSpriteKey(''), DEFAULT_RO_EXPLORER_SPRITE);
assert.equal(resolveRoExplorerSpriteKey('job-name'), DEFAULT_RO_EXPLORER_SPRITE);
assert.equal(
  roExplorerSpriteFramePath('lordknight_male', 0),
  '../images/frames/lordknight_male/frame_000.png'
);
assert.equal(
  roExplorerSpriteFramePath('lordknight_male_mount', 19),
  '../images/frames/lordknight_male_mount/frame_019.png'
);
assert.throws(() => roExplorerSpriteFramePath('swordsman_male', -1), /索引/);
assert.throws(() => roExplorerSpriteFramePath('swordsman_male', 20), /索引/);
assert.throws(() => roExplorerSpriteFramePath('swordsman_male', 1.5), /索引/);

console.log('RO 原生探索角色素材路徑驗證通過');
