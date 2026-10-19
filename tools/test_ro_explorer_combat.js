/* 探索普攻必須沿用主引擎結算，且不能污染放置戰鬥的怪物陣列。 */
const H = require('./harness');
const g = H.boot({ captureLog: true });
const t = H.tester();

const map = g.MAPS.find(item => Array.isArray(item.monsters) && item.monsters.length > 0
  && item.monsters.some(spawn => g.MONSTERS[spawn.id] && g.MONSTERS[spawn.id].hp >= 10000));
if (!map) throw new Error('找不到可用於低傷害測試的野外地圖');
const spawn = map.monsters.find(item => g.MONSTERS[item.id] && g.MONSTERS[item.id].hp >= 10000);
const def = g.MONSTERS[spawn.id];

g.createCharacter('探索普攻測試', { str: 1, agi: 1, vit: 1, int: 1, dex: 99, luk: 1 }, 'male');
g.state.baseLevel = 1;
g.state.jobLevel = 1;
g.state.mapId = map.id;
g.state.hp = g.state.maxHp;
g.state.monsters = [{ defId: spawn.id, hp: 777, maxHp: 777, id: 7 }];
g.state.monster = g.state.monsters[0];
const idleMonsters = g.state.monsters;
g.Math = Object.create(Math);
g.Math.random = () => 0;

const wrongMapId = g.MAPS.find(item => item.id !== map.id).id;
const wrongMap = g.attackRoExplorerMonster('ex-test-session', 'm0', wrongMapId, spawn.id);
t.eq('錯誤地圖不會啟動探索戰鬥', wrongMap.ok, false);
const wrongSpawn = g.attackRoExplorerMonster('ex-test-session', 'm0', map.id, '__not_on_map__');
t.eq('不在地圖怪物清單的目標會被拒絕', wrongSpawn.ok, false);

const result = g.attackRoExplorerMonster('ex-test-session', 'm0', map.id, spawn.id);
t.eq('合法目標經由主引擎攻擊', result.ok, true);
t.eq('攻擊已執行', result.accepted, true);
t.ok('探索目標沿用怪物正式 HP', result.maxHp >= def.hp);
t.ok('普通攻擊造成實際 HP 變化', result.hp < result.maxHp);
t.eq('原本放置戰鬥怪物陣列被復原', g.state.monsters, idleMonsters);
t.eq('放置戰鬥怪物 HP 不受探索傷害', g.state.monsters[0].hp, 777);

const tooSoon = g.attackRoExplorerMonster('ex-test-session', 'm0', map.id, spawn.id);
t.eq('過快重送不會重複結算', tooSoon.rateLimited, true);
g.state.hp = 0;
const downed = g.attackRoExplorerMonster('ex-test-session', 'm2', map.id, spawn.id);
t.eq('倒地角色不能用探索普攻', downed.ok, false);
g.state.hp = g.state.maxHp;
const wrongSession = g.attackRoExplorerMonster('../bad', 'm0', map.id, spawn.id);
t.eq('不合法分頁識別碼被拒絕', wrongSession.ok, false);
process.exit(t.report('原生探索普攻接回主引擎'));
