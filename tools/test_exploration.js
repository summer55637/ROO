/* RO 角色探索回歸：新舊存檔、位置邊界、逐格尋路與移動狀態。 */
const H = require('./harness');
const g = H.boot();
const t = H.tester();

// 新版 main 的逐格探索 API：在合併後的 PR 工作樹中執行。
if (typeof g.normalizeRoExplorationPosition === 'function') {
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
  t.ok('探索畫面左上角映射到 RO 北側格', (() => { const p = g.roExplorationPositionToTile(7, 14, mockGrid); return p.x === 0 && p.y === 4; })());
  t.ok('探索畫面右下角映射到 RO 南側格', (() => { const p = g.roExplorationPositionToTile(93, 84, mockGrid); return p.x === 4 && p.y === 0; })());
  t.ok('RO 北側格映射回探索畫面頂部', (() => { const p = g.roExplorationTileToPosition({ x: 0, y: 4 }, mockGrid); return p.x === 7 && p.y === 14; })());
  t.ok('尋路點會轉成角色可到達的畫面座標', (() => { const p = g.buildRoExplorationPath(7, 14, 93, 84, mockGrid); return p.length === 1 && p[0].x === 93 && p[0].y === 84; })());

  const traversalWall = {
    width: 5,
    height: 5,
    isWalkable: (x, y) => !(x === 2 && y === 2)
  };
  t.ok('移動線段中途遇到封鎖格會被擋住',
    !g.roExplorationCanTraverse(7, 14, 93, 84, traversalWall));
  t.ok('沿無障礙直線可以持續移動',
    g.roExplorationCanTraverse(7, 14, 7, 84, traversalWall));
}

// 分支新增的探索偏移遷移測試；不依賴 UI 的 DOM 實作。
if (typeof g.normalizeExploreOffset === 'function') {
  g.createCharacter('探索測試', { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 }, 'male');
  t.eq('新角色從預設位置開始', g.state.exploreOffset.x, 0);
  t.eq('新角色預設垂直偏移為零', g.state.exploreOffset.y, 0);

  g.state.exploreOffset = g.normalizeExploreOffset({ x: 9, y: -9 });
  t.eq('水平偏移限制在場景內', g.state.exploreOffset.x, 0.68);
  t.eq('垂直偏移限制在場景內', g.state.exploreOffset.y, -0.25);

  const field = g.MAPS.find(m => m.monsters && m.monsters.length > 0);
  t.ok('有可測試的戰鬥地圖', !!field);
  if (field) {
    g.state.exploreOffset = { x: 0.3, y: -0.2 };
    t.ok('切換到戰鬥地圖成功', g.changeMap(field.id));
    t.eq('切地圖時水平位置重設', g.state.exploreOffset.x, 0);
    t.eq('切地圖時垂直位置重設', g.state.exploreOffset.y, 0);
  }

  // 舊存檔沒有 exploreOffset 時，讀檔要回到安全預設值。
  g.state.exploreOffset = { x: 0.25, y: 0.2 };
  g.saveGame();
  const key = g.getSlotKey(0);
  const saved = JSON.parse(g.localStorage.getItem(key));
  delete saved.exploreOffset;
  g.localStorage.setItem(key, JSON.stringify(saved));
  t.ok('舊版存檔可讀回', g.loadGame());
  t.eq('舊版存檔缺少位置時水平回零', g.state.exploreOffset.x, 0);
  t.eq('舊版存檔缺少位置時垂直回零', g.state.exploreOffset.y, 0);
}

process.exit(t.report('角色探索移動'));
