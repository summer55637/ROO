/* 原生探索普攻／技能擊殺：真實掉落、背包、本機存檔與重新載入一致。 */
const H = require('./harness');
const g = H.boot({ captureLog: true });
const t = H.tester();

/* 選用正式地圖清單中的真實怪物資料，並確保它有可驗證的道具掉落。 */
const scenario = g.MAPS.map(map => ({
  map,
  spawn: (map.monsters || []).find(item => {
    const def = item && g.MONSTERS[item.id];
    return def && def.hp >= 10000 && Number(def.atk) > 0 && def.element !== 'poison'
      && Number(def.atkInterval) > 0 && Array.isArray(def.drops)
      && def.drops.some(drop => drop && typeof drop.item === 'string' && g.ITEMS[drop.item]);
  }),
})).find(row => row.spawn);
if (!scenario) throw new Error('找不到有真實道具掉落與反擊間隔的野外怪物資料。');
const map = scenario.map;
const spawn = scenario.spawn;
const def = g.MONSTERS[spawn.id];
const selectedDropIndex = def.drops.findIndex(drop => drop && typeof drop.item === 'string' && g.ITEMS[drop.item]);
const selectedDropItem = def.drops[selectedDropIndex].item;
const originalMonster = {
  hp: def.hp, exp: def.exp, jobExp: def.jobExp, atk: def.atk,
  element: def.element, atkInterval: def.atkInterval,
  drops: JSON.parse(JSON.stringify(def.drops)),
};

function quantity(inventory, itemId) {
  /* 一般材料以 qty 疊加；裝備可能每件有 instanceId，仍要算進背包數量。 */
  return (inventory || []).reduce((total, row) => {
    if (!row || row.item !== itemId) return total;
    return total + (Number.isFinite(row.qty) ? row.qty : 1);
  }, 0);
}
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
  // Reward assertions must not depend on the selected field monster's flee or element.
  // Force the normal weapon-neutral test route to hit and deal non-zero damage.
  g.state.hit = 9999;
  g.state.critRate = 100;
  g.state.perfectDodge = 0;
  g.state.blockChance = 0;
  g.state.hasBackslideDodge = false;
  g.state.hasAutoRevive1 = false;
  g.state.hasAutoRevive2 = false;
  const idleMonsters = [{ defId: spawn.id, hp: 777, maxHp: 777, id: 7 }];
  g.state.monsters = idleMonsters;
  g.state.monster = idleMonsters[0];
  g.saveGame();
  return {
    idleMonsters,
    name: g.state.name,
    baseExpBefore: g.state.baseExp,
    jobExpBefore: g.state.jobExp,
    goldBefore: g.state.gold,
    hpBefore: g.state.hp,
    spBefore: g.state.sp,
    dropQtyBefore: quantity(g.state.inventory, selectedDropItem),
  };
}
function assertPersisted(label, scenarioState) {
  const saved = JSON.parse(g.localStorage.getItem('ro_idle_save_slot_0'));
  t.eq(label + '：存檔基礎等級', saved.baseLevel, g.state.baseLevel);
  t.eq(label + '：存檔職業等級', saved.jobLevel, g.state.jobLevel);
  t.eq(label + '：存檔基礎經驗', saved.baseExp, g.state.baseExp);
  t.eq(label + '：存檔職業經驗', saved.jobExp, g.state.jobExp);
  t.eq(label + '：存檔鋅幣', saved.gold, g.state.gold);
  t.eq(label + '：存檔 HP', saved.hp, g.state.hp);
  t.eq(label + '：存檔 SP', saved.sp, g.state.sp);
  t.eq(label + '：存檔背包與即時背包一致', JSON.stringify(saved.inventory), JSON.stringify(g.state.inventory));
  t.eq(label + '：主遊戲放置怪物仍保留在存檔', JSON.stringify(saved.monsters),
    JSON.stringify(scenarioState.idleMonsters));
  t.eq(label + '：主遊戲怪物陣列未被探索目標污染', g.state.monsters, scenarioState.idleMonsters);
}
function assertReloaded(label) {
  const saved = JSON.parse(g.localStorage.getItem('ro_idle_save_slot_0'));
  t.eq(label + '：可重新載入本機存檔', g.loadGame(), true);
  for (const key of ['name', 'jobId', 'mapId', 'baseLevel', 'jobLevel', 'baseExp', 'jobExp', 'gold', 'hp', 'sp']) {
    t.eq(label + '：重載後 ' + key + ' 一致', g.state[key], saved[key]);
  }
  t.eq(label + '：重載後背包內容一致', JSON.stringify(g.state.inventory), JSON.stringify(saved.inventory));
  t.eq(label + '：重載後掉落數量仍存在', quantity(g.state.inventory, selectedDropItem),
    quantity(saved.inventory, selectedDropItem));
}

g.Math = Object.create(Math);
g.Math.random = () => 0.5;
/* 讓正式 killMonster() 的第一項真實掉落必定成功，其餘一般掉落關閉。 */
def.drops = originalMonster.drops.map((drop, index) => ({
  ...drop,
  chance: index === selectedDropIndex ? 1 : 0,
}));
def.hp = 1;
def.exp = 3;
def.jobExp = 3;
def.element = 'none';
def.atk = Math.max(20, Number(def.atk) || 0);
/* 避免 1 HP 測試怪在擊殺測試中途反擊；反擊另外用原始 HP 獨立測。 */
def.atkInterval = 999999;

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
t.eq('普攻確實將真實掉落加入背包', quantity(g.state.inventory, selectedDropItem), normal.dropQtyBefore + 1);
assertPersisted('普攻擊殺', normal);
assertReloaded('普攻擊殺');

/* 已死目標重送不得多發一次金幣、經驗或背包道具。 */
const goldAfterNormal = g.state.gold;
const dropAfterNormal = quantity(g.state.inventory, selectedDropItem);
const repeatedNormal = g.attackRoExplorerMonster('ex-reward-normal', 'reward-normal', map.id, spawn.id);
t.eq('已死亡目標拒絕重複結算', repeatedNormal.accepted, false);
t.eq('重複普攻不會多發鋅幣', g.state.gold, goldAfterNormal);
t.eq('重複普攻不會多發掉落', quantity(g.state.inventory, selectedDropItem), dropAfterNormal);

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
t.eq('Bash 擊殺也將真實掉落加入背包', quantity(g.state.inventory, selectedDropItem), skill.dropQtyBefore + 1);
assertPersisted('Bash 擊殺', skill);
assertReloaded('Bash 擊殺');

/* 以原始怪物資料建立新的 spawnKey，應視為新一隻、滿 HP 的怪，而非沿用舊屍體。 */
def.hp = originalMonster.hp;
def.exp = originalMonster.exp;
def.jobExp = originalMonster.jobExp;
def.atk = originalMonster.atk;
def.element = originalMonster.element;
def.atkInterval = originalMonster.atkInterval;
def.drops = JSON.parse(JSON.stringify(originalMonster.drops));
g.state.hp = g.state.maxHp;
g.state.attackInterval = 100;
/* loadGame() 會重建角色衍生值；重生攻擊測試要自行固定命中條件，不能靠上一案例殘留。 */
g.state.hit = 9999;
g.state.critRate = 100;
g.state.perfectDodge = 0;
g.state.blockChance = 0;
g.state.hasBackslideDodge = false;
g.state.hasAutoRevive1 = false;
g.state.hasAutoRevive2 = false;
const respawnResult = g.attackRoExplorerMonster('ex-reward-respawn', 'reward-respawn-r1', map.id, spawn.id);
t.eq('新重生識別碼可建立新的探索目標', respawnResult.ok, true);
t.eq('新重生目標不會沿用死亡狀態', respawnResult.killed, false);
t.eq('新重生目標使用原始怪物最大 HP', respawnResult.maxHp, originalMonster.hp);
t.ok('對重生目標可再次造成實際傷害', respawnResult.damageDealt > 0);

/* 用可控時鐘讓同一隻真實怪物走到反擊時間，確認玩家 HP 真正下降。
   只驗普通攻擊承傷：特殊技能（例如自療）可能取代當次普攻；暫時隔離該怪物技能表，
   測完會還原原始參照，避免把「施放技能」誤判成普通攻擊沒有造成傷害。 */
const originalMonsterSkillList = g.MONSTER_SKILLS && g.MONSTER_SKILLS[spawn.id];
const hadMonsterSkillList = !!(g.MONSTER_SKILLS && Object.prototype.hasOwnProperty.call(g.MONSTER_SKILLS, spawn.id));
def.hp = originalMonster.hp;
def.exp = originalMonster.exp;
def.jobExp = originalMonster.jobExp;
def.atk = originalMonster.atk;
def.element = originalMonster.element;
def.atkInterval = 0.01; // 僅縮短測試所需等待；命中仍使用正式怪物傷害流程。
def.drops = JSON.parse(JSON.stringify(originalMonster.drops));
g.Math = Object.create(Math);
g.Math.random = () => 0.99;
if (g.MONSTER_SKILLS) g.MONSTER_SKILLS[spawn.id] = [];
g.createCharacter('探索怪物反擊測試',
  { str: 1, agi: 1, vit: 1, int: 1, dex: 99, luk: 1 }, 'male');
g.state.jobId = 'swordsman';
g.state.mapId = map.id;
g.state.farmMode = 0;
g.state.learnedSkills.bash = 5;
g.recomputeDerived(true);
g.state.hp = g.state.maxHp;
g.state.sp = g.state.maxSp;
g.state.attackInterval = 100;
g.state.hit = 999;
g.state.critRate = 0;
g.state.flee = 0;
g.state.perfectDodge = 0;
g.state.blockChance = 0;
g.state.hasBackslideDodge = false;
g.state.hasAutoRevive1 = false;
g.state.hasAutoRevive2 = false;
const retaliationIdleMonsters = [{ defId: spawn.id, hp: 777, maxHp: 777, id: 7 }];
g.state.monsters = retaliationIdleMonsters;
g.state.monster = retaliationIdleMonsters[0];
const firstRetaliationProbe = g.attackRoExplorerMonster(
  'ex-retaliation', 'retaliation-target', map.id, spawn.id);
t.eq('反擊測試首次普攻成功結算', firstRetaliationProbe.accepted, true);
t.ok('反擊測試首次普攻有實際傷害', firstRetaliationProbe.damageDealt > 0);
const playerHpBeforeRetaliation = g.state.hp;
/* attackRoExplorerMonster 有 100ms 最短攻速與 75% 節流門檻。
   用真實時鐘等待，避免替換 VM 的 Date 屬性卻沒有推進引擎內部時鐘，導致怪物反擊分支未觸發。 */
const retaliationReadyAt = Date.now() + 150;
while (Date.now() < retaliationReadyAt) { /* 此段僅等待測試冷卻，不推進遊戲狀態。 */ }
const retaliationResult = g.attackRoExplorerMonster(
  'ex-retaliation', 'retaliation-target', map.id, spawn.id);
t.eq('等待怪物攻擊間隔後普攻可再次結算', retaliationResult.accepted, true);
t.ok('怪物反擊確實讓玩家 HP 下降', retaliationResult.playerHp < playerHpBeforeRetaliation,
  '反擊前 HP ' + playerHpBeforeRetaliation + '；反擊後 HP ' + retaliationResult.playerHp);
t.eq('反擊回覆 HP 與即時角色狀態一致', retaliationResult.playerHp, g.state.hp);

/* 還原測試對正式怪物資料與時鐘的所有臨時修改。 */
def.hp = originalMonster.hp;
def.exp = originalMonster.exp;
def.jobExp = originalMonster.jobExp;
def.atk = originalMonster.atk;
def.element = originalMonster.element;
def.atkInterval = originalMonster.atkInterval;
def.drops = JSON.parse(JSON.stringify(originalMonster.drops));
if (g.MONSTER_SKILLS) {
  if (hadMonsterSkillList) g.MONSTER_SKILLS[spawn.id] = originalMonsterSkillList;
  else delete g.MONSTER_SKILLS[spawn.id];
}

process.exit(t.report('原生探索普攻／Bash 掉落、背包、重載、重生與怪物反擊'));
