/* 舊版探索偏移：範圍限制、換圖重設與存檔遷移。 */
const H = require('./harness');
const g = H.boot();
const t = H.tester();

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

process.exit(t.report('探索移動'));
