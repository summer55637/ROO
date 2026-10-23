import assert from 'node:assert/strict';
import {
  buildRoExplorerMonsterSpawns,
  parseRoExplorerMonsterCatalog,
  roExplorerMonsterAnimationUrl,
} from './ro_explorer_monsters.mjs';
const catalog = parseRoExplorerMonsterCatalog(JSON.stringify([
  { id: 'poring', imageId: 1002, name: '波利', level: 1, hp: 55, atk: 8, weight: 60 },
  { id: 'fabre', imageId: 1007, name: '綠棉蟲', level: 6, hp: 59, atk: 19, weight: 25 },
  { id: 'poring', imageId: 1002, name: '重複波利', level: 1, hp: 55, atk: 8, weight: 15 },
  { id: '../bad', imageId: 1, name: '不合法路徑', level: 1, hp: 1, atk: 0, weight: 1 },
  { id: 'invalid-image', imageId: 0, name: '無效圖號', level: 1, hp: 1, atk: 0, weight: 1 },
]));
assert.equal(catalog.length, 2);
assert.equal(catalog[0].id, 'poring');
assert.equal(catalog[0].weight, 60);
assert.deepEqual(parseRoExplorerMonsterCatalog('{bad json'), []);
assert.deepEqual(parseRoExplorerMonsterCatalog(JSON.stringify([])), []);
assert.equal(roExplorerMonsterAnimationUrl(1002), 'https://assets.latam-tools.com.br/image?job=1002&action=0');
assert.equal(roExplorerMonsterAnimationUrl(-1), '');
assert.equal(roExplorerMonsterAnimationUrl(1002, 'not a URL'), '');
const width = 48, height = 42, count = width * height;
const walkable = new Uint8Array(count).fill(1), water = new Uint8Array(count);
for (let x = 0; x < width; x++) water[12 * width + x] = 1;
const gat = { width, height, walkable, water }, playerCell = { x: 24, y: 21 };
const options = { maxCount: 8, attemptsPerSpawn: 300 };
const spawns = buildRoExplorerMonsterSpawns(gat, catalog, playerCell, 'prt_fild08', options);
assert.equal(spawns.length, 8);
assert.deepEqual(spawns, buildRoExplorerMonsterSpawns(gat, catalog, playerCell, 'prt_fild08', options));
assert.ok(spawns.every(s => gat.walkable[s.cell.y * width + s.cell.x]));
assert.ok(spawns.every(s => !water[s.cell.y * width + s.cell.x]));
assert.ok(spawns.every(s => Math.hypot(s.cell.x-playerCell.x, s.cell.y-playerCell.y) >= 8));
assert.ok(spawns.every(s => Math.max(
  Math.abs(s.cell.x - playerCell.x), Math.abs(s.cell.y - playerCell.y)
) <= 12), '怪物應生成在玩家附近，避免大地圖上的怪物全落在鏡頭之外。');
assert.ok(spawns.every((s,i) => spawns.slice(i+1).every(o => Math.hypot(s.cell.x-o.cell.x,s.cell.y-o.cell.y) >= 5)));

// Reproduce the real 200×200 GAT map size: default spawn radius must not grow
// with the world, otherwise mobile Canvas 2D can load with every monster off-screen.
const largeWidth = 200, largeHeight = 200;
const largeGat = {
  width: largeWidth,
  height: largeHeight,
  walkable: new Uint8Array(largeWidth * largeHeight).fill(1),
  water: new Uint8Array(largeWidth * largeHeight),
};
const largePlayerCell = { x: 100, y: 100 };
const largeMapSpawns = buildRoExplorerMonsterSpawns(
  largeGat, catalog, largePlayerCell, 'tra_fild', { maxCount: 8, attemptsPerSpawn: 300 }
);
assert.equal(largeMapSpawns.length, 8);
assert.ok(largeMapSpawns.every(spawn => Math.max(
  Math.abs(spawn.cell.x - largePlayerCell.x), Math.abs(spawn.cell.y - largePlayerCell.y)
) <= 12), '200×200 真實地圖的預設怪物應位於角色附近，避免手機純 2D 開場沒有可點目標。');
assert.deepEqual(buildRoExplorerMonsterSpawns(gat, [], playerCell, 'prontera'), []);
assert.deepEqual(buildRoExplorerMonsterSpawns({width:1,height:1,walkable:[1]},catalog,{x:0,y:0},'small'), []);
console.log('原生探索怪物測試通過：資料驗證、權重、可走格、避開玩家與穩定重現。');
