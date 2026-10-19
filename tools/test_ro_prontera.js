/* 普隆德拉碰撞、A* 尋路與 3D 靜態資產驗證。 */
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

const rect = { left: 20, top: 30, width: 600, height: 320 };
const projected = g.ROProntera3D.projectExplorationPosition(40, 43, rect.width, rect.height);
const roundTrip = projected && g.ROProntera3D.screenToExplorationPosition(
  rect.left + projected.x, rect.top + projected.y, rect
);
t.ok('3D 投影後點地座標能還原探索座標',
  !!roundTrip && Math.abs(roundTrip.x - 40) < 1e-8 && Math.abs(roundTrip.y - 43) < 1e-8);
t.ok('3D 投影把地圖中心放在畫面中心',
  (() => { const p = g.ROProntera3D.projectPlanePoint(0, 0, rect.width, rect.height);
    return !!p && Math.abs(p.x - rect.width / 2) < 1e-8 && Math.abs(p.y - rect.height / 2) < 1e-8; })());
t.eq('地圖外的 3D 點擊不會被當成目的地',
  g.ROProntera3D.screenToExplorationPosition(rect.left, rect.top, rect), null);

const start = g.roExplorationPositionToTile(18, 50, prontera);
const goal = g.roExplorationPositionToTile(70, 50, prontera);
const route = prontera.findPath(start.x, start.y, goal.x, goal.y);
t.ok('普隆德拉實際起訖座標可按地形尋路',
  !!route && route.length > 0 && route.every(tile => prontera.isWalkable(tile.x, tile.y)));
t.ok('普隆德拉起點位於可走區或可鄰近校正',
  prontera.isWalkable(start.x, start.y)
  || !!prontera.findPath(start.x, start.y, Math.max(0, start.x - 1), start.y)
  || !!prontera.findPath(start.x, start.y, Math.min(prontera.width - 1, start.x + 1), start.y));

const scenePath = path.join(__dirname, '..', 'data', 'maps', 'prontera-scene.json');
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const textureDir = path.join(__dirname, '..', 'images', 'maps', 'prontera', 'textures');
t.ok('普隆德拉 3D 網格與 86 張配套貼圖完整',
  scene.version === 1 && scene.map === 'prontera'
  && scene.meshes.length === 86 && scene.textures.length === 86
  && scene.textures.every(name => fs.existsSync(path.join(textureDir, name)))
  && scene.meshes.every(mesh => mesh.texture >= 0 && mesh.texture < scene.textures.length
    && mesh.positions.length / 3 <= 65535));

process.exit(t.report('普隆德拉碰撞與尋路'));
