/* 原生探索普攻／技能擊殺：驗證獎勵、升級與本機存檔一致。 */
const H = require('./harness');
const g = H.boot({ captureLog: true });
const t = H.tester();

const map = g.MAPS.find(item => Array.isArray(item.monsters) && item.monsters.length > 0
  && item.monsters.some(spawn => g.MONSTERS[spawn.id] && g.MONSTERS[spawn.id].hp >= 10000
    && g.MONSTERS[spawn.id].element !== 'poison'));
if (!map) throw new Error('找不到可用於擊殺獎勵測試的非毒屬性野外地圖');
const spawn = map.monsters.find(item => g.MONSTERS[item.id] && g.MONSTERS[item.id].hp >= 10000
  && g.MONSTERS[item.id].element !== 'poison');
const def = g.MONSTERS[spawn.id];
const originalMonster = { hp: def.hp, exp: def.exp, jobExp: def.jobExp, atkInterval: def.atkInterval };

/* 固定命中；把測試怪設成 1 HP，讓真實引擎擊殺一次就能穩定驗證獎勵。 */
g.Math = Object.create(Math);
g.Math.random = () => 0;
def.hp = 1;
def.exp = 3;
def.jobExp = 3;
def.atkInterval = 999999;

function prepareScenario(name) {
  g.createCharacter(name, { str: 1, agi: 1, vit: 1, int: 1, dex: 99, luk: 1 }, 'male');
  g.state.jobId = 'swordsman';
  g.state.baseLevel = 1;
  g.state.jobLevel = 1;
  g.state.baseExp = 0;
  g.state.jobExp = 0;
  g.state.farmMode = 0;
  g.state.mapId = map.id;
  g.state.learnedSkills.bash = 5;
  g.state.cooldowns = {};
  g.recomputeDerived(true);

  const baseNeed = g.expToNextBaseLevel(g.state.baseLevel);
  const jobNeed = g.expToNextJobLevel(g.state.jobLevel, g.currentJob().tier);
  g.state.baseExp = Math.max(0, baseNeed - 1);
  g.state.jobExp = Math.max(0, jobNeed - 1);
  g.state.hp = Math.max(1, g.state.maxHp - 7);
  g.state.sp = g.state.maxSp;
  const idleMonsters = [{ defId: spawn.id, hp: 777, maxHp: 777, id: 7 }];
  g.state.monsters = idleMonsters;
  g.state.monster = idleMonsters[0];
  g.saveGame();
  return {
    idleMonsters,
    baseExpBefore: g.state.baseExp,
    jobExpBefore: g.state.jobExp,
    goldBefore: g.state.gold,
    hpBefore: g.state.hp,
    spBefore: g.state.sp,
  };
}

function assertPersisted(label, scenario) {
  const saved = JSON.parse(g.localStorage.getItem('ro_idle_save_slot_0'));
  t.eq(label + '：存檔基礎等級', saved.baseLevel, g.state.baseLevel);
  t.eq(label + '：存檔職業等級', saved.jobLevel, g.state.jobLevel);
  t.eq(label + '：存檔基礎經驗', saved.baseExp, g.state.baseExp);
  t.eq(label + '：存檔職業經驗', saved.jobExp, g.state.jobExp);
  t.eq(label + '：存檔鋅幣', saved.gold, g.state.gold);
  t.eq(label + '：存檔 HP', saved.hp, g.state.hp);
  t.eq(label + '：存檔 SP', saved.sp, g.state.sp);
  t.eq(label + '：存檔仍保留原放置怪物場', JSON.stringify(saved.monsters),
    JSON.stringify(scenario.idleMonsters));
  t.eq(label + '：主遊戲怪物陣列未被探索目標污染', g.state.monsters, scenario.idleMonsters);
}

const normal = prepareScenario('探索普攻擊殺測試');
const normalResult = g.attackRoExplorerMonster('ex-reward-normal', 'reward-normal', map.id, spawn.id);
t.eq('普攻確實擊殺探索目標', normalResult.killed, true);
t.eq('普攻擊殺後基礎等級提升', g.state.baseLevel, 2);
t.eq('普攻擊殺後職業等級提升', g.state.jobLevel, 2);
t.eq('普攻擊殺後基礎經驗跨級剩餘正確', g.state.baseExp, 2);
t.eq('普攻擊殺後職業經驗跨級剩餘正確', g.state.jobExp, 2);
t.ok('普攻擊殺獲得鋅幣', g.state.gold > normal.goldBefore);
t.eq('普攻回覆 HP 與即時角色狀態一致', normalResult.playerHp, g.state.hp);
t.eq('普攻回覆 SP 與即時角色狀態一致', normalResult.playerSp, g.state.sp);
assertPersisted('普攻擊殺', normal);

const skill = prepareScenario('探索技能擊殺測試');
const skillResult = g.castRoExplorerSkill('ex-reward-skill', 'reward-skill', map.id, spawn.id, 'bash');
t.eq('Bash 確實擊殺探索目標', skillResult.killed, true);
t.eq('技能擊殺後基礎等級提升', g.state.baseLevel, 2);
t.eq('技能擊殺後職業等級提升', g.state.jobLevel, 2);
t.eq('技能擊殺後基礎經驗跨級剩餘正確', g.state.baseExp, 2);
t.eq('技能擊殺後職業經驗跨級剩餘正確', g.state.jobExp, 2);
t.ok('技能擊殺獲得鋅幣', g.state.gold > skill.goldBefore);
t.ok('Bash 實際消耗 SP', g.state.sp < skill.spBefore);
t.eq('技能回覆 HP 與即時角色狀態一致', skillResult.playerHp, g.state.hp);
t.eq('技能回覆 SP 與即時角色狀態一致', skillResult.playerSp, g.state.sp);
assertPersisted('技能擊殺', skill);

def.hp = originalMonster.hp;
def.exp = originalMonster.exp;
def.jobExp = originalMonster.jobExp;
def.atkInterval = originalMonster.atkInterval;
process.exit(t.report('原生探索普攻／技能擊殺獎勵、升級與存檔'));
