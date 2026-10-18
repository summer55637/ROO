/* 角色探索座標：邊界、方向、斜向速度、到點移動與存檔回寫。 */
const H = require('./harness');
const g = H.boot();
const t = H.tester();

const origin = g.normalizeRoExplorationPosition(undefined, undefined);
t.eq('新角色探索位置有安全預設 X', origin.x, 18);
t.eq('新角色探索位置有安全預設 Y', origin.y, 50);

const clamped = g.normalizeRoExplorationPosition(-30, 999);
t.eq('X 不會移出場景左界', clamped.x, 7);
t.eq('Y 不會移出場景下界', clamped.y, 84);

const right = g.moveRoExplorationPosition(18, 50, 1, 0, 4);
t.eq('向右按一次移動四個座標單位', right.x, 22);
t.eq('水平移動不改變 Y', right.y, 50);

const diagonal = g.moveRoExplorationPosition(18, 50, 1, -1, Math.sqrt(2));
t.ok('斜向移動不會超出指定距離', Math.abs(Math.hypot(diagonal.x - 18, diagonal.y - 50) - Math.sqrt(2)) < 1e-9);

const aimed = g.moveRoExplorationPosition(18, 50, 22, 20, 5);
t.ok('大座標向量不會被截斷成錯誤方向', Math.abs((aimed.y - 50) / (aimed.x - 18) - 20 / 22) < 1e-9);
const wideVertical = g.moveRoExplorationPosition(18, 50, 0, 1, 1, 2);
t.eq('寬畫面垂直移動按比例補償座標', wideVertical.y, 52);
const wideHorizontal = g.moveRoExplorationPosition(18, 50, 1, 0, 1, 2);
t.eq('寬畫面水平移動不受座標校正影響', wideHorizontal.x, 19);
const wideTarget = g.moveRoExplorationPosition(18, 50, 22, 20 / 2, 5, 2);
t.ok('寬畫面點擊移動維持目的地方向', Math.abs((wideTarget.y - 50) / (wideTarget.x - 18) - 20 / 22) < 1e-9);

const towards = g.moveRoExplorationPosition(18, 50, 40 - 18, 70 - 50, 5);
t.ok('點地面目的地會按固定距離前進', Math.abs(Math.hypot(towards.x - 18, towards.y - 50) - 5) < 1e-9);
const destination = g.normalizeRoExplorationPosition(40, 70);
t.eq('目的地限制在場景右界內', g.normalizeRoExplorationPosition(100, 70).x, 93);
t.eq('觸控左鍵與鍵盤左鍵共用方向', g.roExplorationDirectionForKey('__touch_left'), g.roExplorationDirectionForKey('ArrowLeft'));
t.eq('WASD 與方向鍵共用向上方向', g.roExplorationDirectionForKey('w'), g.roExplorationDirectionForKey('ArrowUp'));

const edge = g.moveRoExplorationPosition(92, 50, 1, 0, 8);
t.eq('移動遇到右界會限制座標', edge.x, 93);

g.createCharacter('探索測試', { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 }, 'male');
g.state.explorationX = 64;
g.state.explorationY = 37;
g.saveGame();
const saved = JSON.parse(g.localStorage.getItem(g.getSlotKey(0)));
t.eq('移動 X 寫入角色存檔', saved.explorationX, 64);
t.eq('移動 Y 寫入角色存檔', saved.explorationY, 37);

const mockGrid = {
  width: 5,
  height: 5,
  findPath: (sx, sy, ex, ey) => [{ x: ex, y: ey }]
};
t.eq('探索畫面左上角映射到 RO 北側格', g.roExplorationPositionToTile(7, 14, mockGrid), { x: 0, y: 4 });
t.eq('探索畫面右下角映射到 RO 南側格', g.roExplorationPositionToTile(93, 84, mockGrid), { x: 4, y: 0 });
t.eq('RO 北側格映射回探索畫面頂部', g.roExplorationTileToPosition({ x: 0, y: 4 }, mockGrid), { x: 7, y: 14 });
t.eq('尋路點會轉成角色可到達的畫面座標',
  g.buildRoExplorationPath(7, 14, 93, 84, mockGrid), [{ x: 93, y: 84 }]);

process.exit(t.report('角色探索移動'));
