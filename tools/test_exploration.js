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


const towards = g.moveRoExplorationPosition(18, 50, 40 - 18, 70 - 50, 5);
t.ok('點地面目的地會按固定距離前進', Math.abs(Math.hypot(towards.x - 18, towards.y - 50) - 5) < 1e-9);
const destination = g.normalizeRoExplorationPosition(40, 70);
t.eq('目的地限制在場景右界內', g.normalizeRoExplorationPosition(100, 70).x, 93);
t.eq('方向鍵與觸控方向使用相同向量', g.RO_EXPLORATION_KEYS.__touch_left, g.RO_EXPLORATION_KEYS.arrowleft);

const edge = g.moveRoExplorationPosition(92, 50, 1, 0, 8);
t.eq('移動遇到右界會限制座標', edge.x, 93);

g.createCharacter('探索測試', { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 }, 'male');
g.state.explorationX = 64;
g.state.explorationY = 37;
g.saveGame();
const saved = JSON.parse(g.localStorage.getItem(g.getSlotKey(0)));
t.eq('移動 X 寫入角色存檔', saved.explorationX, 64);
t.eq('移動 Y 寫入角色存檔', saved.explorationY, 37);

process.exit(t.report('角色探索移動'));
