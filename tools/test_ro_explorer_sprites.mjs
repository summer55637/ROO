import assert from 'node:assert/strict';
import {
  DEFAULT_RO_EXPLORER_SPRITE,
  resolveRoExplorerSpriteKey,
  roExplorerSpriteFramePath,
  buildRoExplorerSpriteLayout,
  resolveRoExplorerJob,
  roExplorerAnimationUrl,
  roExplorerDirectionFromDelta,
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

const layout = buildRoExplorerSpriteLayout(175, 170, {
  left: 50, top: 30, right: 125, bottom: 145,
}, 1);
assert.ok(layout.scale > 0);
assert.ok(layout.width <= 2.4);
assert.ok(layout.height <= 2.8);
assert.ok(Math.abs(layout.width / layout.height - 175 / 170) < 1e-10);
assert.ok(Math.abs(layout.offsetX) < 1e-10, '左右置中應不位移');
assert.ok(Math.abs(layout.offsetY + (85 - 145) * layout.scale) < 1e-10,
  '腳底應對齊地面錨點');

assert.throws(() => buildRoExplorerSpriteLayout(0, 170, {
  left: 0, top: 0, right: 1, bottom: 1,
}, 1), /尺寸/);
assert.throws(() => buildRoExplorerSpriteLayout(100, 100, {
  left: 0, top: 0, right: 101, bottom: 80,
}, 1), /範圍/);
assert.throws(() => buildRoExplorerSpriteLayout(100, 100, {
  left: 0, top: 0, right: 50, bottom: 50,
}, 0), /比例/);

console.log('RO 原生探索角色素材路徑與定位驗證通過');

assert.deepEqual(resolveRoExplorerJob('swordsman_male'), {
  jobId: 1, gender: 'male', mounted: false,
});
assert.deepEqual(resolveRoExplorerJob('lordknight_female'), {
  jobId: 4008, gender: 'female', mounted: false,
});
assert.deepEqual(resolveRoExplorerJob('lordknight_male_mount'), {
  jobId: 4014, gender: 'male', mounted: true,
});
assert.equal(resolveRoExplorerJob('runeknight_male_mount'), null,
  '未映射騎乘造型應保留本機備援');
assert.equal(roExplorerAnimationUrl('swordsman_male', 'walk', 0),
  'https://assets.latam-tools.com.br/image?job=1&gender=male&action=8');
assert.equal(roExplorerAnimationUrl('swordsman_female', 'idle', 4),
  'https://assets.latam-tools.com.br/image?job=1&gender=female&action=4');
assert.equal(roExplorerAnimationUrl('lordknight_male_mount', 'walk', 6),
  'https://assets.latam-tools.com.br/image?job=4014&gender=male&action=14');
assert.equal(roExplorerAnimationUrl('runeknight_male_mount', 'walk', 0), null);
assert.throws(() => roExplorerAnimationUrl('swordsman_male', 'attack', 0), /動作/);
assert.throws(() => roExplorerAnimationUrl('swordsman_male', 'walk', 8), /方向/);
assert.deepEqual(
  [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]]
    .map(([dx, dy]) => roExplorerDirectionFromDelta(dx, dy)),
  [0, 1, 2, 3, 4, 5, 6, 7]
);
assert.equal(roExplorerDirectionFromDelta(0, 0), null);
assert.throws(() => roExplorerDirectionFromDelta(Infinity, 1), /有限/);

console.log('RO 原生八方向動畫與職業映射驗證通過');
