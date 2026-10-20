/* 原生探索恢復／輔助技能：實際沿用主引擎結算與存檔。 */
const H = require('./harness');
const g = H.boot({ captureLog: true });
const t = H.tester();

const map = g.MAPS.find(item => item.id === 'prontera')
  || g.MAPS.find(item => Array.isArray(item.monsters) && item.monsters.length);
if (!map) throw new Error('找不到可用於恢復／輔助技能測試的地圖');

g.createCharacter('探索恢復輔助測試', { str: 1, agi: 1, vit: 1, int: 99, dex: 1, luk: 1 }, 'male');
g.state.jobId = 'priest';
g.state.learnedSkills.heal = 5;
g.state.learnedSkills.sanctuary = 3;
g.state.learnedSkills.magnificat = 1;
g.state.learnedSkills.strecovery = 1;
g.state.learnedSkills.bash = 5;
g.state.mapId = map.id;
g.state.cooldowns = {};
g.recomputeDerived(true);
g.state.maxSp = Math.max(150, g.state.maxSp);
g.state.hp = Math.max(1, g.state.maxHp - 100);
g.state.sp = g.state.maxSp;
const idleMonsters = [{ defId: map.monsters && map.monsters[0] ? map.monsters[0].id : 'poring',
  hp: 777, maxHp: 777, id: 7 }];
g.state.monsters = idleMonsters;
g.state.monster = idleMonsters[0];
g.saveGame();

const hpBefore = g.state.hp;
const spBefore = g.state.sp;
const healed = g.castRoExplorerSupportSkill('ex-support-session', map.id, 'heal');
t.eq('探索可直接施放治癒術', healed.accepted, true);
t.ok('治癒術實際恢復 HP', g.state.hp > hpBefore);
t.eq('治癒結果 HP 與主引擎一致', healed.playerHp, g.state.hp);
t.ok('治癒術沿用正式 SP 消耗', g.state.sp < spBefore);
const savedHeal = JSON.parse(g.localStorage.getItem('ro_idle_save_slot_0'));
t.eq('治癒後 HP 已寫入存檔', savedHeal.hp, g.state.hp);
t.eq('治癒後 SP 已寫入存檔', savedHeal.sp, g.state.sp);
t.eq('恢復技能不更動原放置怪物陣列', g.state.monsters, idleMonsters);
t.eq('恢復技能不修改放置怪物 HP', g.state.monsters[0].hp, 777);

const healCooldown = g.castRoExplorerSupportSkill('ex-support-session', map.id, 'heal');
t.eq('同一恢復技能會遵守正式冷卻', healCooldown.accepted, false);
t.ok('冷卻拒絕帶有原因', String(healCooldown.error).includes('冷卻'));

g.state.cooldowns = {};
const ailmentEnd = Date.now() + 10000;
g.state.playerAil = { blind: ailmentEnd, poison: ailmentEnd };
const cure = g.castRoExplorerSupportSkill('ex-support-session', map.id, 'strecovery');
t.eq('探索可施放痊癒術', cure.accepted, true);
t.eq('痊癒術清除角色異常狀態', Object.keys(g.state.playerAil || {}).length, 0);

g.state.cooldowns = {};
g.state.sp = g.state.maxSp;
const spBeforeBuff = g.state.sp;
const magnificat = g.castRoExplorerSupportSkill('ex-support-session', map.id, 'magnificat');
t.eq('探索可施放聖母之頌歌', magnificat.accepted, true);
t.ok('SP 自然恢復 buff 實際寫入角色狀態',
  g.state.buffs.some(buff => buff.type === 'sprate'));
t.ok('輔助技能沿用正式 SP 消耗', g.state.sp < spBeforeBuff);
const savedMagnificat = JSON.parse(g.localStorage.getItem('ro_idle_save_slot_0'));
t.ok('SP 恢復 buff 持續效果寫入存檔',
  savedMagnificat.buffs.some(buff => buff.type === 'sprate'));

g.state.cooldowns = {};
g.state.sp = g.state.maxSp;
const sanctuary = g.castRoExplorerSupportSkill('ex-support-session', map.id, 'sanctuary');
t.eq('探索可施放光耀之堂', sanctuary.accepted, true);
t.ok('光耀之堂沿用主引擎持續恢復場域',
  Array.isArray(g.state.activeFieldEffects)
    && g.state.activeFieldEffects.some(effect => effect.kind === 'selfheal' && effect.endsAt > Date.now()));
t.eq('光耀之堂結算後仍保留原怪物陣列', g.state.monsters, idleMonsters);
t.eq('光耀之堂未更動放置怪物 HP', g.state.monsters[0].hp, 777);

const beforeInvalid = { hp: g.state.hp, sp: g.state.sp };
const wrongMap = g.castRoExplorerSupportSkill('ex-support-session', 'wrong_map', 'heal');
t.eq('錯誤地圖不能施放恢復技能', wrongMap.ok, false);
const wrongType = g.castRoExplorerSupportSkill('ex-support-session', map.id, 'bash');
t.eq('攻擊技能不能從無目標輔助入口施放', wrongType.ok, false);
t.eq('無效支援請求不會修改 HP', g.state.hp, beforeInvalid.hp);
t.eq('無效支援請求不會修改 SP', g.state.sp, beforeInvalid.sp);
t.eq('輔助技能操作不會污染主遊戲怪物陣列', g.state.monsters, idleMonsters);

process.exit(t.report('原生探索恢復與輔助技能'));
