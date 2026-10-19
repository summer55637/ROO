/* 普隆德拉 GAT 衍生阻擋區轉換與 A* 尋路。 */
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const g = H.boot();
const t = H.tester();

const small = g.ROPronteraMap.buildGrid([
  { kind: 'rect', x: 0, z: 0, width: 2, depth: 2 }
], 4, 2);
t.ok('阻擋區轉換為不可通行格', !small.isWalkable(1, 1) && !small.isWalkable(2, 2));
t.ok('阻擋區外仍可通行', small.isWalkable(0, 0) && small.isWalkable(3, 3));
const detour = small.findPath(0, 0, 3, 3);
t.ok('A* 可繞過阻擋區抵達另一側',
  !!detour && detour.length > 3 && detour[detour.length - 1].x === 3
  && detour[detour.length - 1].y === 3
  && detour.every(tile => small.isWalkable(tile.x, tile.y)));
t.eq('不可走起點拒絕尋路', small.findPath(1, 1, 3, 3), null);

const zonesPath = path.join(__dirname, '..', 'data', 'maps', 'prontera-blocked-zones.json');
const zones = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
const prontera = g.ROPronteraMap.buildGrid(zones);
let blockedCount = 0;
let walkableCount = 0;
for (let y = 0; y < prontera.height; y++) {
  for (let x = 0; x < prontera.width; x++) {
    if (prontera.isWalkable(x, y)) walkableCount++;
    else blockedCount++;
  }
}
t.ok('普隆德拉資料可建立 104×104 導航格',
  prontera.width === 104 && prontera.height === 104 && blockedCount > 0 && walkableCount > blockedCount);
const start = g.roExplorationPositionToTile(18, 50, prontera);
const goal = g.roExplorationPositionToTile(70, 50, prontera);
const route = prontera.findPath(start.x, start.y, goal.x, goal.y);
t.ok('普隆德拉實際起訖座標可按地形尋路',
  !!route && route.length > 0 && route.every(tile => prontera.isWalkable(tile.x, tile.y)));
t.ok('普隆德拉起點位於可走區或可鄰近校正',
  prontera.isWalkable(start.x, start.y)
  || !!prontera.findPath(start.x, start.y, Math.max(0, start.x - 1), start.y)
  || !!prontera.findPath(start.x, start.y, Math.min(prontera.width - 1, start.x + 1), start.y));

process.exit(t.report('普隆德拉碰撞與尋路'));
