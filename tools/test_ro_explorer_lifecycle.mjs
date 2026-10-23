import assert from 'node:assert/strict';
import {
  findRoExplorerMonsterRespawnCell,
  reviveRoExplorerMonster,
  scheduleRoExplorerMonsterRespawn,
} from './ro_explorer_lifecycle.mjs';

const entry = {
  spawnKey: 'm2', spawnBaseKey: 'm2', respawnCount: 0,
  monster: { hp: 55 }, currentHp: 0, maxHp: 55, dead: false,
  statusLabels: ['中毒'], nextStatusTickAt: 123,
};
assert.equal(scheduleRoExplorerMonsterRespawn(entry, 1000, 800), true);
assert.equal(entry.dead, true);
assert.equal(entry.respawnAt, 1800);
assert.equal(reviveRoExplorerMonster(entry, 1799), false);
assert.equal(reviveRoExplorerMonster(entry, 1800), true);
assert.equal(entry.dead, false);
assert.equal(entry.respawnAt, 0);
assert.equal(entry.spawnKey, 'm2-r1');
assert.equal(entry.currentHp, 55);
assert.deepEqual(entry.statusLabels, []);
assert.equal(entry.nextStatusTickAt, 0);
assert.equal(reviveRoExplorerMonster(entry, 2000), false);
entry.currentHp = 3;
entry.statusLabels = ['出血'];
assert.equal(scheduleRoExplorerMonsterRespawn(entry, 3000, 0), true);
assert.equal(reviveRoExplorerMonster(entry, 3000), true);
assert.equal(entry.spawnKey, 'm2-r2');
assert.equal(entry.currentHp, 55);

const width = 12, height = 12;
const walkable = new Uint8Array(width * height).fill(1);
const water = new Uint8Array(width * height);
water[5 * width + 6] = 1;
walkable[5 * width + 7] = 0;
const gat = { width, height, walkable, water };
const playerCell = { x: 5, y: 5 };
const occupied = [{ x: 8, y: 5 }];
const cell = findRoExplorerMonsterRespawnCell(gat, playerCell, { x: 5, y: 5 }, occupied);
assert.ok(cell);
assert.ok(walkable[cell.y * width + cell.x]);
assert.equal(water[cell.y * width + cell.x], 0);
assert.ok(Math.hypot(cell.x - playerCell.x, cell.y - playerCell.y) >= 3);
assert.ok(occupied.every(other => Math.hypot(cell.x - other.x, cell.y - other.y) >= 2.5));
assert.deepEqual(cell, findRoExplorerMonsterRespawnCell(gat, playerCell, { x: 5, y: 5 }, occupied));
assert.equal(findRoExplorerMonsterRespawnCell({ width: 1, height: 1, walkable: [1] }, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
console.log('原生探索怪物重生測試通過：等待時間、唯一識別、HP/狀態重置、避開角色/怪物/水域。');
