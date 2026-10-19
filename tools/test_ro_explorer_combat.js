/* 探索普攻必須沿用主引擎結算，且不能污染放置戰鬥的怪物陣列。 */
const H = require('./harness');
const g = H.boot({ captureLog: true });
const t = H.tester();

const map = g.MAPS.find(item => Array.isArray(item.monsters) && item.monsters.length > 0
  && item.monsters.some(spawn => g.MONSTERS[spawn.id] && g.MONSTERS[spawn.id].hp >= 10000
    && g.MONSTERS[spawn.id].element !== 'poison'));
if (!map) throw new Error('找不到可用於低傷害測試的非毒屬性野外地圖');
const spawn = map.monsters.find(item => g.MONSTERS[item.id] && g.MONSTERS[item.id].hp >= 10000
  && g.MONSTERS[item.id].element !== 'poison');
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

g.state.jobId = 'swordsman';
g.state.learnedSkills.bash = 5;
g.state.sp = g.state.maxSp;
g.state.cooldowns = {};
const skillSpBefore = g.state.sp;
const skillResult = g.castRoExplorerSkill('ex-skill-session', 'm1', map.id, spawn.id, 'bash');
t.eq('已學會的主動技能可經由引擎施放', skillResult.ok, true);
t.eq('技能成功消耗正式施放流程', skillResult.accepted, true);
t.eq('探索技能回傳正確技能名稱', skillResult.skillName, g.SKILLS.bash.name);
t.ok('技能造成實際怪物 HP 變化', skillResult.damageDealt > 0);
t.ok('主動技能消耗 SP', skillResult.playerSp < skillSpBefore);
t.eq('技能結算後仍復原放置戰鬥怪物陣列', g.state.monsters, idleMonsters);
t.eq('探索技能不會更改放置怪物 HP', g.state.monsters[0].hp, 777);
const skillTooSoon = g.castRoExplorerSkill('ex-skill-session', 'm1', map.id, spawn.id, 'bash');
t.eq('技能冷卻中不能重複施放', skillTooSoon.accepted, false);
const unlearnedSkill = g.castRoExplorerSkill('ex-skill-session', 'm2', map.id, spawn.id, 'heal');
t.eq('未學會的技能不得從探索頁施放', unlearnedSkill.ok, false);

g.state.jobId = 'thief';
g.state.learnedSkills.envenom = 10;
g.state.maxSp = Math.max(100, g.state.maxSp);
g.state.sp = g.state.maxSp;
g.state.cooldowns = {};
const poisonSkill = g.castRoExplorerSkill('ex-status-session', 'm0', map.id, spawn.id, 'envenom');
t.eq('探索允許施毒技能沿用主引擎施放', poisonSkill.accepted, true);
t.eq('施毒命中後回報中毒狀態', poisonSkill.hasTimedStatus, true);
const hpBeforeDot = poisonSkill.hp;
const dotTick = g.tickRoExplorerMonsterStatus('ex-status-session', 'm0', map.id, spawn.id);
t.eq('探索中毒跳傷成功結算', dotTick.accepted, true);
t.ok('中毒跳傷會扣除怪物 HP', dotTick.hp < hpBeforeDot);
t.ok('中毒跳傷回報實際傷害量', dotTick.damageDealt > 0);
const dotTickTooSoon = g.tickRoExplorerMonsterStatus('ex-status-session', 'm0', map.id, spawn.id);
t.eq('探索狀態計時有節流，不會重複連跳', dotTickTooSoon.rateLimited, true);
t.eq('狀態跳傷後仍復原放置戰鬥怪物陣列', g.state.monsters, idleMonsters);
t.eq('狀態跳傷不會污染放置怪物 HP', g.state.monsters[0].hp, 777);
process.exit(t.report('原生探索普攻、技能與持續狀態接回主引擎'));
