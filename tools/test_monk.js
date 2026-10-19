/* 武僧（#70）：17 個官方技能全做，外加兩套新機制——氣球體與連段。

   這支要證的三件事：
     1. 氣球體真的是一份會增減的資源（自動補、被技能扣、上限跟著蓄氣等級走）
     2. 連段真的會自己往下串，而且**猛龍誇強接阿修羅時共用同一份氣球體消耗**
        （不共用的話上限 5 顆永遠湊不滿阿修羅要的 5 顆，整條鏈會死鎖）
     3. 每個技能推出去的數字都有人讀——這個專案已經有四次「推了卻沒人讀」的前科

   跑法：node tools/test_monk.js（或由 tools/test.js 一起跑）
*/
const H = require('./harness');
const t = H.tester();

const mk = (opts) => {
  const g = H.boot(Object.assign({ captureLog: true }, opts || {}));
  H.mkChar(g, { path: ['acolyte', 'monk'] });
  return g;
};
// 學技能時前置一路點上去（levelUpSkill 會擋 requires）
function learnChain(g, pairs) {
  pairs.forEach(([id, lv]) => H.learn(g, id, lv));
}

/* ---------------- 1. 職業本體 ---------------- */
{
  const g = H.boot();
  const j = g.JOB_TREE.monk;
  t.ok('武僧進了 JOB_TREE', !!j);
  t.eq('父職業是服事', j.parent, 'acolyte');
  t.eq('tier 2', j.tier, 2);
  t.eq('轉職條件 40/40', `${j.baseLevelReq}/${j.jobLevelReq}`, '40/40');
  t.eq('服事的分支有武僧', g.JOB_TREE.acolyte.next.join(','), 'priest,monk');
  t.ok('武僧已從 JOBS_TIER2_PENDING 移除',
    !g.JOBS_TIER2_PENDING.some(x => x.id === 'monk'));
  // 六條分支在 #72 全部做完，待辦清單清空
  t.eq('二轉分支的待辦清單已清空', g.JOBS_TIER2_PENDING.length, 0);

  // 官方 17 個技能一個都沒少，再加借來的服事 13 個
  const own = ['mo_ironhand', 'mo_callspirits', 'mo_absorbspirits', 'mo_explosionspirits',
    'mo_dodge', 'mo_bladestop', 'mo_spiritsrecovery', 'mo_tripleattack', 'mo_chaincombo',
    'mo_combofinish', 'mo_steelbody', 'mo_investigate', 'mo_fingeroffensive',
    'mo_extremityfist', 'mo_bodyrelocation', 'mo_balkyoung', 'mo_kitranslation'];
  own.forEach(id => t.ok(`${id} 有定義`, !!g.SKILLS[id]));
  const ids = j.skills.map(s => s.id);
  t.eq('技能總數 = 17 自有 + 15 借用', ids.length, 32);

  /* 借來的要標得出來（#99）。以前分不出自己的跟借的，技能分頁就在武僧底下
     把服事那 15 支再畫一次——而玩家本來就走過服事那一站，同一批技能出現兩次、
     借用者那份還全是 MAX，看起來像「一轉職就自動點滿」。 */
  const borrowed = j.borrowedFrom || {};
  t.eq('借來的剛好 15 支', Object.keys(borrowed).length, 15);
  t.eq('全部標成來自服事',
    [...new Set(Object.values(borrowed))].join(','), 'acolyte');
  t.eq('借來的就是服事那 15 支',
    Object.keys(borrowed).sort().join(','),
    g.JOB_TREE.acolyte.skills.map(s => s.id).sort().join(','));
  t.eq('自己的 17 支一支都沒被標成借來的',
    own.filter(id => borrowed[id]).join(','), '');
  /* 全庫的 borrowSkillsFrom 都要標到——漏一個職業，那個職業的分頁就會重複顯示。 */
  const bad = Object.values(g.JOB_TREE).filter(x => x.borrowSkillsFrom && x.borrowSkillsFrom.length
    && Object.keys(x.borrowedFrom || {}).length === 0).map(x => x.name);
  t.eq('20 個有借技的職業全部標好', bad.join('、'), '');
  t.ok('借到了服事的治癒術', ids.includes('heal'));
  t.ok('借到了服事的天使之護', ids.includes('divineprotection'));

  // HP/SP 表與職業加成
  t.ok('有官方 HP 表', Array.isArray(g.JOB_BASE_HP.monk) && g.JOB_BASE_HP.monk.length === 100);
  t.ok('有官方 SP 表', Array.isArray(g.JOB_BASE_SP.monk) && g.JOB_BASE_SP.monk.length === 100);
  t.eq('HP[1] = 35', g.JOB_BASE_HP.monk[0], 35);
  const bonusCount = Object.values(j.bonusLevels).reduce((a, b) => a + b.length, 0);
  t.eq('職業加成 30 點（與其他二轉一致）', bonusCount, 30);
  t.ok('職業加成的等級都在 1~50', Object.values(j.bonusLevels)
    .every(arr => arr.every(l => l >= 1 && l <= 50)));

  // 攻速表：拿得動空手／拳套／鈍器／法杖，拿不動劍與弓
  t.eq('攻速表指向 x_武僧_武宗術師', j.aspdFrom, 'x_武僧_武宗術師');
  const w = g.ASPD_WEAPON_BASE[j.aspdFrom].weapons;
  t.eq('拳套攻速 154', w.knuckle, 154);
  t.eq('空手攻速 154', w.bare, 154);
  t.ok('沒有弓', w.bow === undefined);
  t.ok('沒有單手劍', w.sword1 === undefined);
}

/* ---------------- 2. 拳套真的裝得上 ---------------- */
{
  const g = mk();
  const kn = H.wield(g, 'knuckle');
  t.ok('武僧穿得上拳套', !!kn);
  t.eq('穿上後攻速分類是 knuckle', g.aspdCategoryOf(g.getEquipBaseItemId('weapon')), 'knuckle');
  /* 拳套的 reqJob 寫的是 priest/acolyte，武僧走職業鏈（monk→acolyte）應該全部過得了。
     這裡**不驗拳套有幾把**——那是把資料檔抄一遍，#82 刪掉兩件孤兒裝備就會誤報。 */
  const all = Object.keys(g.ITEMS).filter(x => g.ITEMS[x].weaponCat === 'knuckle');
  const blocked = all.filter(x => g.equipBlockReason(x) && !/等級/.test(g.equipBlockReason(x)));
  /* 這裡本來寫「至少 50 把」。#142 砍孤兒時掉到 18 把，#149 又全部放回去，
     數字來回跳過兩次——所以改驗**穿得到的拳套涵蓋整條升級路**，
     而不是庫存數字。那才是這條真正在乎的事。 */
  const lv = all.map(x => g.ITEMS[x].reqLevel || 1).sort((a, b) => a - b);
  t.ok('拳套還有得穿', all.length >= 10, '實際 ' + all.length + ' 把');
  t.ok('低等就有拳套可用', lv[0] <= 20, '最低需求等級 ' + lv[0]);
  t.ok('高等也有拳套可換', lv[lv.length - 1] >= 100, '最高需求等級 ' + lv[lv.length - 1]);
  t.eq('沒有任何拳套因職業被擋下', blocked.length, 0);
  // 弓拿不動（攻速表沒有那一列）
  t.ok('武僧拿不動弓', !g.jobCanUseWeapon('monk', Object.keys(g.ITEMS).find(x => g.ITEMS[x].weaponCat === 'bow')));
}

/* ---------------- 3. 鐵沙掌：空手／拳套限定 ---------------- */
{
  const g = mk();
  const base = g.state.atk;
  H.learn(g, 'mo_ironhand', 10);
  const bare = g.state.atk;
  t.eq('空手時鐵沙掌 +30 ATK', bare - base, 30);
  H.wield(g, 'knuckle');
  const knuckleAtk = g.state.atk;
  H.wield(g, 'mace');
  t.eq('換鈍器後鐵沙掌失效', g.state.atk < knuckleAtk, true);
  // 換回拳套要回得來（確認不是一次性寫死）
  H.wield(g, 'knuckle');
  t.eq('換回拳套後恢復', g.state.atk, knuckleAtk);
}

/* ---------------- 4. 蓄氣：氣球體是會增減的資源 ---------------- */
{
  const g = mk();
  t.eq('沒點蓄氣時上限 0', g.state.spiritsMax, 0);
  H.learn(g, 'mo_ironhand', 2);
  H.learn(g, 'mo_callspirits', 3);
  t.eq('蓄氣 Lv3 → 上限 3 顆', g.state.spiritsMax, 3);
  H.learn(g, 'mo_callspirits', 2);
  t.eq('蓄氣 Lv5 → 上限 5 顆', g.state.spiritsMax, 5);

  // 補球：把時間戳往前撥，模擬 5 秒過去
  g.state.spirits = 0;
  for (let i = 0; i < 5; i++) { g.state.spiritRefillAt = 1; g.tickSpirits(); }
  t.eq('補滿 5 顆', g.state.spirits, 5);
  g.state.spiritRefillAt = 1; g.tickSpirits();
  t.eq('滿了就不再補', g.state.spirits, 5);

  // 每顆 ATK +3
  g.state.spirits = 0; g.recomputeDerived(false);
  const atk0 = g.state.atk;
  g.state.spirits = 5; g.recomputeDerived(false);
  t.eq('5 顆氣球體 = ATK +15', g.state.atk - atk0, 15);

  // 退掉蓄氣（上限歸零）時手上的球要跟著清掉，不能留著吃 ATK
  g.state.learnedSkills.mo_callspirits = 0;
  g.recomputeDerived(false); g.tickSpirits();
  t.eq('蓄氣退點後氣球體歸零', g.state.spirits, 0);
}

/* ---------------- 5. 吸氣：普攻機率回 SP ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 2], ['mo_callspirits', 5], ['mo_absorbspirits', 1]]);
  t.eq('吸氣設定有掛上', g.state.absorbSpirits.spGain, 5);
  t.eq('吸氣內部冷卻 3 秒', g.state.absorbSpirits.cdSec, 3);
  H.mon(g, { minHp: 1000 });
  // 冷卻每次清掉，量的是純機率
  const hit = H.rate(600, () => {
    g.state.sp = 1;
    g.tryMonkProcs(g.state.monsters[0], g.MONSTERS[g.state.monsters[0].defId]);
    return g.state.sp > 1;
  }, () => { g.state.songProcReadyAt = {}; });
  t.near('吸氣觸發率約 20%', hit / 600 * 100, 20, 6);
  // 冷卻真的擋得住：連打兩次只會中一次
  g.state.songProcReadyAt = {};
  g.state.sp = 1;
  let got = 0;
  for (let i = 0; i < 40; i++) {
    const before = g.state.sp;
    g.tryMonkProcs(g.state.monsters[0], g.MONSTERS[g.state.monsters[0].defId]);
    if (g.state.sp > before) got++;
    g.state.sp = 1;
  }
  t.eq('3 秒冷卻內最多只回一次 SP', got <= 1, true);
}

/* ---------------- 6. 爆氣：滿球自動啟動 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 2], ['mo_callspirits', 5], ['mo_absorbspirits', 1],
    ['mo_explosionspirits', 5]]);
  const critBefore = g.state.critRate;
  g.state.spirits = 4; g.tickSpirits();
  t.eq('4 顆時不會啟動', g.state.buffs.some(b => b.skillId === 'mo_explosionspirits'), false);
  g.state.spirits = 5; g.state.spiritRefillAt = 0; g.tickSpirits();
  t.eq('滿 5 顆自動爆氣', g.state.buffs.some(b => b.skillId === 'mo_explosionspirits'), true);
  t.eq('爆氣吃掉 5 顆', g.state.spirits, 0);
  g.recomputeDerived(false);
  const crit = g.buffMult('crit');
  t.eq('暴擊 +20（Lv5）', crit.flatBonus, 20);
  t.eq('SP 自然回復 ×0.5', g.buffMult('sprate').mult, 0.5);
  t.eq('爆氣持續 180 秒', Math.round(g.state.buffs.find(b => b.skillId === 'mo_explosionspirits').msRemaining / 1000), 180);
  t.ok('暴擊率本身沒被直接改寫（走 buff）', g.state.critRate === critBefore);
  // 爆氣中不會重複啟動
  g.state.spirits = 5; g.tickSpirits();
  t.eq('爆氣中不重複啟動', g.state.spirits, 5);
}

/* ---------------- 7. 移花接木 / 弓身彈影 / 運氣調息 ---------------- */
{
  const g = mk();
  const flee0 = g.state.flee;
  learnChain(g, [['mo_ironhand', 5], ['mo_dodge', 10]]);
  t.eq('移花接木 Lv10 迴避 +15', g.state.flee - flee0, 15);

  const g2 = mk();
  t.eq('沒點弓身彈影時沒有生怪加速', !!g2.state.hasRiding, false);
  learnChain(g2, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_absorbspirits', 1],
    ['mo_explosionspirits', 3], ['mo_dodge', 5], ['mo_tripleattack', 5],
    ['mo_chaincombo', 3], ['mo_combofinish', 3], ['mo_investigate', 3],
    ['mo_fingeroffensive', 3], ['mo_extremityfist', 3], ['mo_bodyrelocation', 1]]);
  t.eq('弓身彈影點亮生怪加速（比照騎乘術）', g2.state.hasRiding, true);
  /* 回歸測試：spawnMonster() 以前直接查 `learnedSkills['riding']`，
     `state.hasRiding` 寫了兩處、讀 0 處（這個專案第五次的「推了卻沒人讀」）。
     兩邊都改讀旗標之後，這裡量的是**生怪間隔真的縮短了**，不是旗標有沒有被設。 */
  const spawnAfter = (gg, gapMs) => {
    gg.state.mapId = gg.MAPS.find(m => m.monsters && m.monsters.length).id;
    gg.state.encounterMode = 'melee';
    gg.state.monsters = [];
    gg.state.lastSpawnTime = Date.now() - gapMs;
    gg.spawnMonster();
    return gg.state.monsters.length;
  };
  const noRide = mk();   // 沒點弓身彈影
  t.eq('沒有加速時 400ms 還生不出怪（門檻 500ms）', spawnAfter(noRide, 400), 0);
  t.eq('沒有加速時 600ms 生得出來', spawnAfter(noRide, 600), 1);
  t.eq('弓身彈影讓 400ms 就生得出來（門檻 375ms）', spawnAfter(g2, 400), 1);

  // 運氣調息：真的讓自然回復變多
  const g3 = mk();
  learnChain(g3, [['mo_ironhand', 5], ['mo_dodge', 5], ['mo_bladestop', 2]]);
  const measure = (gg) => {
    gg.state.hp = 1; gg.state.sp = 1;
    gg.passiveRegen();
    return [gg.state.hp, gg.state.sp];
  };
  const [hp0, sp0] = measure(g3);
  H.learn(g3, 'mo_spiritsrecovery', 5);
  const [hp1, sp1] = measure(g3);
  t.ok('運氣調息讓 HP 回復變多', hp1 > hp0, `${hp0} → ${hp1}`);
  t.ok('運氣調息讓 SP 回復變多', sp1 > sp0, `${sp0} → ${sp1}`);
}

/* ---------------- 8. 真劍百破道：開視窗、扣 1 顆球 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_dodge', 5], ['mo_bladestop', 5]]);
  t.eq('真劍 Lv5 內部冷卻 12 秒', g.state.bladeStop.cdSec, 12);
  t.eq('真劍持續 10 秒', g.state.bladeStop.durSec, 10);
  H.mon(g, { minHp: 1000 });
  const md = g.MONSTERS[g.state.monsters[0].defId];
  g.state.spirits = 3; g.state.bladeStopEnd = 0; g.state.songProcReadyAt = {};
  g.tryMonkProcs(g.state.monsters[0], md);
  t.eq('真劍開了視窗', g.state.bladeStopEnd > Date.now(), true);
  t.eq('真劍吃掉 1 顆氣球體', g.state.spirits, 2);
  // 沒球就開不了
  const g2 = mk();
  learnChain(g2, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_dodge', 5], ['mo_bladestop', 5]]);
  H.mon(g2, { minHp: 1000 });
  g2.state.spirits = 0; g2.state.bladeStopEnd = 0; g2.state.songProcReadyAt = {};
  g2.tryMonkProcs(g2.state.monsters[0], g.MONSTERS[g2.state.monsters[0].defId]);
  t.eq('沒有氣球體就開不了真劍', g2.state.bladeStopEnd > Date.now(), false);
}

/* ---------------- 9. 浸透勁／彈指神通：只在真劍視窗裡發動 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_dodge', 5], ['mo_bladestop', 5],
    ['mo_investigate', 5], ['mo_fingeroffensive', 5]]);
  t.eq('浸透勁 Lv5 倍率 500%', g.state.investigate.mult, 5);
  t.eq('彈指神通 Lv5 倍率 1600%', g.state.fingerOffensive.mult, 16);

  const md = () => g.MONSTERS[g.state.monsters[0].defId];
  const fire = (windowOpen) => {
    H.mon(g, { minHp: 100000 });
    g.state.spirits = 0;                    // 真劍自己不要再開一次，免得干擾
    // 發勁是轉職自動獲得的，20% 觸發也會打出傷害 —— 不關掉的話這段量到的是它
    if (g.state.balkyoung) g.state.balkyoung.chance = 0;
    g.state.songProcReadyAt = {};
    g.state.bladeStopEnd = windowOpen ? Date.now() + 10000 : 0;
    g.state.investigate.chance = 100; g.state.fingerOffensive.chance = 100;
    const hp = g.state.monsters[0].hp;
    g.tryMonkProcs(g.state.monsters[0], md());
    return hp - g.state.monsters[0].hp;
  };
  t.eq('沒開真劍時兩招都不發動', fire(false), 0);
  t.ok('開了真劍就打得出傷害', fire(true) > 0);

  // 浸透勁：無視防禦、而且傷害隨目標防禦上升
  const hitOn = (defId) => {
    H.mon(g, { defId });
    g.state.spirits = 0; g.state.songProcReadyAt = {};
    if (g.state.balkyoung) g.state.balkyoung.chance = 0;
    g.state.bladeStopEnd = Date.now() + 10000;
    g.state.investigate.chance = 100; g.state.fingerOffensive.chance = 0;
    g.state.monsters[0].hp = 9e9;
    const hp = g.state.monsters[0].hp;
    g.tryMonkProcs(g.state.monsters[0], g.MONSTERS[defId]);
    return hp - g.state.monsters[0].hp;
  };
  const lowDef = Object.values(g.MONSTERS).find(m => (m.def || 0) === 0 && !m.isBoss);
  const highDef = Object.values(g.MONSTERS).find(m => (m.def || 0) >= 100 && !m.isBoss);
  if (lowDef && highDef) {
    t.ok('浸透勁打高防怪比打零防怪痛（官方：傷害隨防禦上升）',
      hitOn(highDef.id) > hitOn(lowDef.id), `${hitOn(lowDef.id)} vs ${hitOn(highDef.id)}`);
  }
}

/* ---------------- 10. 連段：六合拳 → 連環 → 猛龍 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_dodge', 5],
    ['mo_tripleattack', 10], ['mo_chaincombo', 5], ['mo_combofinish', 5]]);
  t.eq('六合拳 Lv10 倍率 300%', g.state.tripleAttack.mult, 3);
  t.eq('六合拳觸發率 30%', g.state.tripleAttack.chance, 30);
  t.eq('連環接續率 50%', g.state.chainCombo.chance, 50);
  t.eq('猛龍接續率 30%', g.state.comboFinish.chance, 30);

  H.mon(g, { minHp: 100000 });
  const md = g.MONSTERS[g.state.monsters[0].defId];
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    g.state.spirits = 5;
    g.state.monsters[0].hp = 9e9;
    const startingHp = g.state.monsters[0].hp;
    g.tryMonkCombo(g.state.monsters[0], md);
    t.ok('六合拳在觸發門檻內會發動', g.state.monsters[0].hp < startingHp);

    Math.random = () => 0.30;
    g.state.spirits = 5;
    g.state.monsters[0].hp = 9e9;
    const boundaryHp = g.state.monsters[0].hp;
    g.tryMonkCombo(g.state.monsters[0], md);
    t.eq('六合拳在精確 30% 邊界不發動', g.state.monsters[0].hp, boundaryHp);
  } finally {
    Math.random = originalRandom;
  }

  // 拿弓時整條鏈不跑（官方：近距離普通攻擊才觸發）
  const g2 = mk();
  learnChain(g2, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_dodge', 5], ['mo_tripleattack', 10]]);
  H.mon(g2, { minHp: 100000 });
  // 武僧拿不動弓，改成直接讓 isBowWeapon 成立來驗這條分支
  const bowId = Object.keys(g2.ITEMS).find(x => g2.ITEMS[x].weaponCat === 'bow');
  const realGet = g2.getEquipBaseItemId;
  g2.getEquipBaseItemId = (slot) => (slot === 'weapon' ? bowId : realGet(slot));
  const bowHits = H.rate(200, () => {
    g2.state.monsters[0].hp = 9e9;
    const hp = g2.state.monsters[0].hp;
    g2.tryMonkCombo(g2.state.monsters[0], g2.MONSTERS[g2.state.monsters[0].defId]);
    return hp - g2.state.monsters[0].hp > 0;
  });
  g2.getEquipBaseItemId = realGet;
  t.eq('拿弓時連段完全不發動', bowHits, 0);
}

/* ---------------- 11. 連環全身掌：拳套加倍 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_dodge', 5],
    ['mo_tripleattack', 10], ['mo_chaincombo', 5]]);
  t.eq('拳套時 6 連擊', g.state.chainCombo.knuckleHits, 6);
  t.eq('拳套時傷害加倍', g.state.chainCombo.knuckleMult, 2);
  H.mon(g, { minHp: 100000 });
  const md = g.MONSTERS[g.state.monsters[0].defId];
  // 必中版：兩段都拉到 100%，量總傷害
  const total = () => {
    g.state.tripleAttack.chance = 100; g.state.chainCombo.chance = 100;
    g.state.monsters[0].hp = 9e9;
    const hp = g.state.monsters[0].hp;
    g.tryMonkCombo(g.state.monsters[0], md);
    return hp - g.state.monsters[0].hp;
  };
  H.wield(g, 'mace');
  const maceDmg = total();
  H.wield(g, 'knuckle');
  const knuckleDmg = total();
  t.ok('拳套的連環傷害明顯高於鈍器', knuckleDmg > maceDmg, `${maceDmg} → ${knuckleDmg}`);
}

/* ---------------- 12. 猛龍誇強：吃球、隨 STR 上升 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_dodge', 5],
    ['mo_tripleattack', 10], ['mo_chaincombo', 5], ['mo_combofinish', 5]]);
  H.mon(g, { minHp: 100000 });
  const md = g.MONSTERS[g.state.monsters[0].defId];
  const run = () => {
    g.state.tripleAttack.chance = 100; g.state.chainCombo.chance = 100; g.state.comboFinish.chance = 100;
    g.state.monsters[0].hp = 9e9;
    const hp = g.state.monsters[0].hp;
    g.tryMonkCombo(g.state.monsters[0], md);
    return hp - g.state.monsters[0].hp;
  };
  g.state.spirits = 3;
  run();
  t.eq('猛龍誇強吃掉 1 顆氣球體', g.state.spirits, 2);
  g.state.spirits = 0;
  const before = g.state.spirits;
  run();
  t.eq('沒球時猛龍不發動（球數不變）', g.state.spirits, before);

  // STR 越高傷害越高
  g.state.spirits = 5; g.state.stats.str = 1; g.recomputeDerived(false);
  const lowStr = (g.state.spirits = 5, run());
  g.state.stats.str = 99; g.recomputeDerived(false);
  const highStr = (g.state.spirits = 5, run());
  t.ok('猛龍誇強隨 STR 上升', highStr > lowStr, `${lowStr} → ${highStr}`);
  t.eq('倍率公式：STR 99 時約 +50%', Math.round(99 / g.state.comboFinish.strScale * 100), 50);
}

/* ---------------- 13. 阿修羅霸凰拳：連段終點 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_absorbspirits', 1],
    ['mo_explosionspirits', 5], ['mo_dodge', 5], ['mo_tripleattack', 10],
    ['mo_chaincombo', 5], ['mo_combofinish', 5], ['mo_bladestop', 5],
    ['mo_investigate', 5], ['mo_fingeroffensive', 5], ['mo_extremityfist', 5]]);
  /* 使用者 2026-08-22 調整：flatBonus ×5（1000→5000）、spScale 100→20 */
  t.eq('阿修羅 Lv5 固定傷害 5000', g.state.extremityFist.flat, 5000);
  t.eq('阿修羅消耗 5 顆氣球體', g.state.extremityFist.cost, 5);

  H.mon(g, { minHp: 100000 });
  const md = g.MONSTERS[g.state.monsters[0].defId];
  const forceAll = () => {
    g.state.tripleAttack.chance = 100; g.state.chainCombo.chance = 100;
    g.state.comboFinish.chance = 100; g.state.extremityFist.chance = 100;
  };
  const openExplosion = () => {
    g.state.buffs = g.state.buffs.filter(b => b.skillId !== 'mo_explosionspirits');
    g.state.buffs.push({ type: 'crit', mult: 1, flatBonus: 20, msRemaining: 180000, skillId: 'mo_explosionspirits' });
  };

  // 沒爆氣就接不到阿修羅：SP 不會被清空
  forceAll();
  g.state.buffs = g.state.buffs.filter(b => b.skillId !== 'mo_explosionspirits');
  g.state.spirits = 5; g.state.sp = g.state.maxSp;
  g.state.monsters[0].hp = 9e9;
  g.tryMonkCombo(g.state.monsters[0], md);
  t.eq('沒爆氣時阿修羅不發動（SP 沒被清空）', g.state.sp, g.state.maxSp);
  t.eq('沒爆氣時走一般路線：猛龍扣 1 顆', g.state.spirits, 4);

  /* 共用消耗：爆氣中、球滿 5 顆時，猛龍**不另外扣**，
     整條鏈合計只吃 5 顆——不這樣寫的話上限 5 顆永遠湊不滿阿修羅的 5 顆。 */
  forceAll(); openExplosion();
  g.state.spirits = 5; g.state.sp = g.state.maxSp;
  g.state.monsters[0].hp = 9e9;
  const hpBefore = g.state.monsters[0].hp;
  g.tryMonkCombo(g.state.monsters[0], md);
  t.eq('阿修羅發動後氣球體歸零（合計只吃 5 顆）', g.state.spirits, 0);
  t.eq('阿修羅燒光全部 SP', g.state.sp, 0);
  t.eq('阿修羅放完解除爆氣', g.state.buffs.some(b => b.skillId === 'mo_explosionspirits'), false);
  t.ok('阿修羅打出了傷害', hpBefore - g.state.monsters[0].hp > 0);

  // SP 越多打越痛（倍率 = 8 + 消耗SP/100）
  const asura = (sp) => {
    forceAll(); openExplosion();
    g.state.spirits = 5; g.state.sp = sp;
    H.mon(g, { defId: md.id }); g.state.monsters[0].hp = 9e9;
    const hp = g.state.monsters[0].hp;
    g.tryMonkCombo(g.state.monsters[0], md);
    return hp - g.state.monsters[0].hp;
  };
  const lowSp = asura(10), highSp = asura(2000);
  t.ok('阿修羅傷害隨消耗的 SP 上升', highSp > lowSp, `${lowSp} → ${highSp}`);

  // 死鎖回歸測試：連跑 20 輪，阿修羅要放得出來
  let fired = 0;
  for (let i = 0; i < 20; i++) {
    forceAll(); openExplosion();
    g.state.spirits = 5; g.state.sp = 500;
    H.mon(g, { defId: md.id }); g.state.monsters[0].hp = 9e9;
    g.tryMonkCombo(g.state.monsters[0], md);
    if (g.state.sp === 0) fired++;
  }
  t.eq('20 輪都放得出阿修羅（沒有氣球體死鎖）', fired, 20);
}

/* ---------------- 14. 金剛不壞：爆氣中滿球自動開 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 5], ['mo_callspirits', 5], ['mo_absorbspirits', 1],
    ['mo_explosionspirits', 5], ['mo_dodge', 5], ['mo_tripleattack', 10],
    ['mo_chaincombo', 5], ['mo_combofinish', 5], ['mo_steelbody', 5]]);
  t.eq('金剛不壞 Lv5 減傷 20%', g.state.steelBody.cutPct, 20);
  t.eq('金剛不壞 Lv5 持續 30 秒', g.state.steelBody.durSec, 30);

  // 沒爆氣時不會開
  g.state.buffs = g.state.buffs.filter(b => b.skillId !== 'mo_explosionspirits');
  g.state.spirits = 5; g.state.steelBodyReadyAt = 0; g.state.spiritRefillAt = 0;
  g.tickSpirits();
  t.eq('沒爆氣時金剛不壞不會開', g.state.buffs.some(b => b.skillId === 'mo_steelbody'), false);
  t.eq('（但滿球會先自動爆氣）', g.state.buffs.some(b => b.skillId === 'mo_explosionspirits'), true);

  // 爆氣中再湊滿 5 顆 → 開
  g.state.spirits = 5; g.tickSpirits();
  t.eq('爆氣中滿球自動開金剛不壞', g.state.buffs.some(b => b.skillId === 'mo_steelbody'), true);
  t.eq('金剛不壞吃掉 5 顆', g.state.spirits, 0);
  t.eq('受傷倍率 ×0.8', g.buffMult('dmgtaken').mult, 0.8);
  t.eq('playerDmgTakenMult 讀得到', g.playerDmgTakenMult(), 0.8);
  // 內部冷卻擋得住
  g.state.buffs = g.state.buffs.filter(b => b.skillId !== 'mo_steelbody');
  g.state.spirits = 5; g.tickSpirits();
  t.eq('60 秒內不會再開一次', g.state.buffs.some(b => b.skillId === 'mo_steelbody'), false);
  t.eq('（所以球留著給阿修羅）', g.state.spirits, 5);
}

/* ---------------- 15. 發勁：轉職自動獲得、不會把自己打死 ---------------- */
{
  const g = mk();
  t.eq('轉職自動獲得發勁', g.state.learnedSkills.mo_balkyoung, 1);
  t.eq('發勁不用花技能點', g.SKILLS.mo_balkyoung.autoGrant, true);
  t.eq('發勁自傷 200 HP', g.state.balkyoung.hpCost, 200);

  H.mon(g, { minHp: 100000 });
  const md = g.MONSTERS[g.state.monsters[0].defId];
  // HP 低於 25% 就不放：殘血時打 400 下，血量一點都不能掉
  let died = 0, fired = 0;
  for (let i = 0; i < 400; i++) {
    g.state.hp = 1;
    g.state.monsters[0].hp = 9e9;
    g.state.balkyoung.chance = 100;
    g.tryMonkProcs(g.state.monsters[0], md);
    if (g.state.hp < 1) died++;
    if (g.state.hp !== 1) fired++;
  }
  t.eq('殘血時發勁完全不發動', fired, 0);
  t.eq('發勁不會把自己打死', died, 0);
  // 剛好卡在下限之上時會放，而且留得住 1 HP
  t.eq('發勁內部冷卻 10 秒', g.state.balkyoung.cdSec, 10);
  g.state.songProcReadyAt = {};
  g.state.hp = Math.floor(g.state.maxHp * 0.26);
  g.state.monsters[0].hp = 9e9;
  g.state.balkyoung.chance = 100;
  g.tryMonkProcs(g.state.monsters[0], md);
  t.ok('HP 26% 時會發動', g.state.hp < Math.floor(g.state.maxHp * 0.26));
  t.ok('發動後 HP 仍 ≥ 1', g.state.hp >= 1, g.state.hp);
  // 冷卻擋得住：必中狀態下連打 40 次也只會再扣一次以內
  let extra = 0;
  for (let i = 0; i < 40; i++) {
    g.state.hp = g.state.maxHp;
    g.state.monsters[0].hp = 9e9;
    g.state.balkyoung.chance = 100;
    g.tryMonkProcs(g.state.monsters[0], md);
    if (g.state.hp < g.state.maxHp) extra++;
  }
  t.eq('10 秒冷卻內不會再發動一次', extra, 0);
  // HP 充足時真的會扣 200
  g.state.songProcReadyAt = {};
  g.state.hp = g.state.maxHp;
  g.state.monsters[0].hp = 9e9;
  g.state.balkyoung.chance = 100;
  g.tryMonkProcs(g.state.monsters[0], md);
  t.eq('HP 足夠時扣滿 200', g.state.maxHp - g.state.hp, 200);

  // 觸發率 20%
  const hits = H.rate(600, () => {
    g.state.hp = g.state.maxHp;
    g.state.monsters[0].hp = 9e9;
    g.tryMonkProcs(g.state.monsters[0], md);
    return g.state.hp < g.state.maxHp;
  }, () => { g.state.songProcReadyAt = {}; g.recomputeDerived(false); });
  t.near('發勁觸發率約 20%', hits / 600 * 100, 20, 6);
}

/* ---------------- 16. 振氣注入：沒有隊伍系統 → 什麼都不做 ---------------- */
{
  const g = mk();
  learnChain(g, [['mo_ironhand', 2], ['mo_callspirits', 5], ['mo_kitranslation', 1]]);
  t.eq('振氣注入設定有掛上', !!g.state.kiTranslation, true);
  g.state.spirits = 5; g.state.kiTranslationReadyAt = 0; g.state.spiritRefillAt = 0;
  for (let i = 0; i < 10; i++) g.tickSpirits();
  t.eq('沒有隊友時不會扣球（技能形同待命）', g.state.spirits, 5);
  t.ok('技能敘述有講明沒有隊伍系統',
    /沒有隊伍系統/.test(g.SKILLS.mo_kitranslation.desc));
}

/* ---------------- 17. 整趟跑起來不會炸 ---------------- */
{
  const g = mk();
  H.learnAll(g);
  H.wield(g, 'knuckle');
  H.mon(g, { minHp: 500000 });
  for (let i = 0; i < 300; i++) {
    if (!g.state.monsters.length) H.mon(g, { minHp: 500000 });
    g.playerAttack();
    if (i % 10 === 0) g.tickSpirits();
  }
  t.ok('300 次普攻（含連段與所有 proc）沒有例外', true);
  t.ok('氣球體沒有變成負數', (g.state.spirits || 0) >= 0, g.state.spirits);
  t.ok('氣球體沒有超過上限', (g.state.spirits || 0) <= g.state.spiritsMax, g.state.spirits);
  t.ok('HP 沒有被自己的技能打到 0 以下', g.state.hp >= 1, g.state.hp);
  t.ok('SP 沒有變成負數', g.state.sp >= 0, g.state.sp);
}

process.exit(t.report('武僧 17 技能 + 氣球體與連段'));
