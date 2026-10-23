/* 神行太保 + 武術宗師（#79）。兩邊各 4 個，官方全做。

   只驗會壞的東西：
     - 霸王魂：半傷、反射、次數用完消失
     - 所有卸除：一次判定四個一起掛
     - 自由保護：抄襲候選名單真的變寬，而且分組表推得出來
     - 連段延伸：猛虎硬派山／伏虎拳／氣絕崩擊 → 阿修羅，以及**氣球體不會被擠光**
       （#70 踩過一次死鎖，這次多插兩招花球，上限提到 7 就是為了這件事）
*/
const H = require('./harness');
const t = H.tester();

const ST = () => {
  const g = H.boot({ captureLog: true });
  H.mkChar(g, { path: ['thief', 'rogue'], rebirth: true, job: 'stalker' });
  ['thief', 'rogue', 'stalker'].forEach(j => { g.state.jobSkillPoints[j] = 400; });
  return g;
};
const CH = () => {
  const g = H.boot({ captureLog: true });
  H.mkChar(g, { path: ['acolyte', 'monk'], rebirth: true, job: 'champion' });
  ['acolyte', 'monk', 'champion'].forEach(j => { g.state.jobSkillPoints[j] = 400; });
  return g;
};
const deep = (g, id, lv) => {
  const sk = g.SKILLS[id];
  const rs = sk.requires ? (Array.isArray(sk.requires) ? sk.requires : [sk.requires]) : [];
  rs.forEach(r => deep(g, r.skillId, r.level));
  return H.learn(g, id, lv);
};
const anyMon = g => Object.keys(g.MONSTERS)[0];

/* ---- 1. 霸王魂 ---- */
{
  const g = ST();
  H.learn(g, 'st_rejectsword', 5);
  g.state.sp = g.state.maxSp; g.state.cooldowns = {};
  t.eq('放得出來', g.castSkill('st_rejectsword'), true);
  const b = g.state.buffs.find(x => x.type === 'reject');
  t.eq('3 次', b.charges, 3);
  t.eq('Lv5 機率 75', b.flatBonus, 75);

  const md = g.MONSTERS[anyMon(g)];
  const mon = H.mon(g, { defId: md.id, hp: 9e9 });
  b.flatBonus = 100;                       // 拉滿，測結果不是測機率
  const hpBefore = g.state.hp;
  const kept = g.rejectSwordAbsorb(1000, mon, md);
  t.eq('只吃一半', kept, 500);
  t.eq('扣一次', b.charges, 2);
  t.eq('反射打的是怪不是自己', 9e9 - mon.hp, 500);
  t.eq('自己沒有因為反射掉血', g.state.hp, hpBefore);

  g.rejectSwordAbsorb(1000, mon, md);
  g.rejectSwordAbsorb(1000, mon, md);
  t.ok('次數用完 buff 消失', !g.state.buffs.some(x => x.type === 'reject'));
  t.eq('沒有 buff 時原樣回傳', g.rejectSwordAbsorb(1000, mon, md), 1000);
}

/* ---- 2. 所有卸除 ---- */
{
  const g = ST();
  ['rg_striphelm', 'rg_stripshield', 'rg_striparmor', 'rg_stripweapon'].forEach(id => deep(g, id, 5));
  deep(g, 'st_fullstrip', 5);
  t.eq('Lv5 機率 15', g.state.fullStrip.chance, 15);
  t.eq('四個卸除都在桶裡', g.state.stripProcs.length, 4);

  H.wield(g, 'dagger');
  const m = H.mon(g, { defId: anyMon(g), hp: 9e9 });
  g.state.fullStrip.chance = 100;
  g.state.songProcReadyAt = {};
  // 把單發的四個機率歸零，確定掛上去的是合體版而不是它們各自擲中
  g.state.stripProcs.forEach(p => { p.chance = 0; });
  g.tryRogueProcs(m, g.MONSTERS[m.defId]);
  const stripped = Object.keys(m.strip || {}).length;
  t.eq('一次掛上四個', stripped, 4);
}

/* ---- 3. 自由保護：抄襲名單變寬 + 分組 ---- */
{
  const g = ST();
  deep(g, 'rg_plagiarism', 10);
  const before = g.plagiarismChoices().length;
  t.ok('沒學自由保護時只有主動攻擊技', g.plagiarismChoices().every(s => s.type !== 'passive'));
  deep(g, 'st_preserve', 1);
  const after = g.plagiarismChoices().length;
  t.ok('學了之後名單變多', after > before, `${before} → ${after}`);
  t.ok('被動攻擊技進來了', g.plagiarismChoices().some(s => s.type === 'passive'));

  // 分組：主系是一路 parent 走到 tier<=1
  const groups = g.plagiarismGroups();
  t.ok('分組不只一組', groups.length > 1);
  t.eq('每組的技能數加起來等於候選總數',
    groups.reduce((n, x) => n + x.skills.length, 0), after);
  const famOf = id => {
    const gr = groups.find(x => x.skills.some(s => s.id === id));
    return gr ? gr.id : null;
  };
  t.eq('騎士的技能歸劍士系', famOf('bowlingbash'), 'swordsman');
  t.eq('鍊金術士的技能歸商人系', famOf('am_acidterror'), 'merchant');
  t.eq('武僧的技能歸見習修女系', famOf('mo_investigate'), 'acolyte');

  /* 抄來的**被動**要真的生效（#102）。使用者 2026-08-16：「抄襲的被動技 六合拳沒有觸發」。
     `skillLv()` 早就把抄襲等級算進去了，所以主動技抄了就放得出來，但被動的效果是
     `recomputeDerived()` 照 passiveStat 掛上去的，而抄來的技能不在任何已學職業的
     技能表也不是卡片給的——一輩子進不了 `passiveSourceSkills()` 那份清單。 */
  t.eq('抄六合拳', g.setPlagiarismSkill('mo_tripleattack'), true);
  g.recomputeDerived(true);
  t.ok('抄來的被動有掛上去', !!g.state.tripleAttack);
  t.eq('等級照抄襲上限夾', g.skillLv('mo_tripleattack'), 10);
  H.wield(g, 'knuckle');
  g.changeMap(g.MAPS.find(m => (m.monsters || []).length > 0).id);
  const mon = H.mon(g, { minHp: 9e8 });
  g.state.tripleAttack.chance = 100;
  const before2 = g.__log.length;
  for (let i = 0; i < 5; i++) { mon.hp = 9e8; g.playerAttack(); }
  t.ok('普攻真的觸發六合拳', g.__log.slice(before2).some(l => l.includes('六合拳')));
  // 換掉抄襲對象就要跟著消失，不能留在身上
  g.setPlagiarismSkill(null);
  g.recomputeDerived(true);
  t.eq('取消抄襲後被動跟著消失', g.state.tripleAttack, null);
}

/* ---- 4. 武術宗師：氣球體上限與連段 ---- */
{
  const g = CH();
  deep(g, 'mo_callspirits', 5);
  t.eq('武術宗師的氣球體上限是 7', g.state.spiritsMax, 7);
  // 武僧本人維持 5
  const g2 = H.boot();
  H.mkChar(g2, { path: ['acolyte', 'monk'] });
  ['acolyte', 'monk'].forEach(j => { g2.state.jobSkillPoints[j] = 300; });
  deep(g2, 'mo_callspirits', 5);
  t.eq('武僧維持 5', g2.state.spiritsMax, 5);
}
{
  const g = CH();
  ['mo_ironhand', 'mo_callspirits', 'mo_tripleattack', 'mo_combofinish', 'mo_explosionspirits',
    'mo_chaincombo', 'mo_extremityfist'].forEach(id => deep(g, id));
  ['ch_soulcollect', 'ch_palmstrike', 'ch_tigerfist', 'ch_chaincrush'].forEach(id => deep(g, id));
  t.ok('四個數字都有人讀',
    !!g.state.soulCollect && !!g.state.palmStrike && !!g.state.tigerFist && !!g.state.chainCrush);

  H.wield(g, 'knuckle');
  // 猛虎硬派山限爆氣狀態
  const m0 = H.mon(g, { defId: anyMon(g), hp: 9e9 });
  g.state.buffs = g.state.buffs.filter(b => b.skillId !== 'mo_explosionspirits');
  g.state.songProcReadyAt = {};
  g.state.palmStrike.chance = 100; g.state.palmStrike.chainChance = 0;
  g.tryChampionProcs(m0, g.MONSTERS[m0.defId]);
  t.eq('沒爆氣時猛虎硬派山不發動', m0.hp, 9e9);

  // 爆氣中才打得出來
  g.state.buffs.push({ type: 'crit', mult: 1, flatBonus: 0, msRemaining: 99999, skillId: 'mo_explosionspirits' });
  g.state.spirits = 7;
  g.state.songProcReadyAt = {};
  const m1 = H.mon(g, { defId: anyMon(g), hp: 9e9 });
  // This block is testing Palm Strike's stun. Prevent the separate direct-Asura
  // proc from winning the random branch and returning before Palm Strike executes.
  g.state.extremityFist.directChance = 0;
  g.tryChampionProcs(m1, g.MONSTERS[m1.defId]);
  t.ok('爆氣中打得出來', m1.hp < 9e9);
  t.ok('目標被暈', g.ailActive(m1, 'stun'));
}
{
  /* 死鎖回歸（#70 那個坑的第二版）：伏虎拳與氣絕崩擊各花 1 顆，
     阿修羅要 5 顆。上限 7 的話「兩招都放完還留得下 5 顆」必須成立。 */
  const g = CH();
  ['mo_ironhand', 'mo_callspirits', 'mo_tripleattack', 'mo_combofinish', 'mo_explosionspirits',
    'mo_chaincombo', 'mo_extremityfist'].forEach(id => deep(g, id));
  ['ch_tigerfist', 'ch_chaincrush'].forEach(id => deep(g, id));
  H.wield(g, 'knuckle');
  g.state.buffs.push({ type: 'crit', mult: 1, flatBonus: 0, msRemaining: 99999, skillId: 'mo_explosionspirits' });
  g.state.tigerFist.chance = 100; g.state.tigerFist.chainChance = 100;
  g.state.extremityFist.chance = 100;
  g.state.spirits = 7;
  g.state.sp = g.state.maxSp;
  const m = H.mon(g, { defId: anyMon(g), hp: 9e9 });
  g.tryTigerFist(m, g.MONSTERS[m.defId]);
  t.ok('伏虎拳→氣絕崩擊→阿修羅整條走得完',
    g.__log.some(l => l.includes('阿修羅')), g.__log.slice(-4).join(' / '));

  // 球不夠時整條要停住，不能扣成負數
  const g3 = CH();
  ['mo_ironhand', 'mo_callspirits', 'ch_tigerfist', 'ch_chaincrush'].forEach(id => deep(g3, id));
  H.wield(g3, 'knuckle');
  g3.state.tigerFist.chance = 100;
  g3.state.spirits = 0;
  const m3 = H.mon(g3, { defId: anyMon(g3), hp: 9e9 });
  g3.tryTigerFist(m3, g3.MONSTERS[m3.defId]);
  t.eq('沒球時不發動', m3.hp, 9e9);
  t.eq('球沒有被扣成負數', g3.state.spirits, 0);
}
{
  // 狂蓄氣
  const g = CH();
  ['mo_callspirits', 'mo_explosionspirits', 'ch_soulcollect'].forEach(id => deep(g, id));
  g.state.spirits = 0;
  g.state.soulCollect.chance = 100;
  g.state.songProcReadyAt = {};
  g.tryChampionProcs(null, null);
  t.eq('一口氣補 5 顆', g.state.spirits, 5);
  g.state.spirits = 0;
  g.tryChampionProcs(null, null);
  t.eq('冷卻內不再觸發', g.state.spirits, 0);
}

/* ---- 5. 二轉與進階二轉共用技能點池（#101）----
   使用者 2026-08-15：「職業2跟2.5 技能點應該是通用的 沒有限定只能點2或2.5」。
   分池的後果是兩邊互相卡死——進階二轉整份借走二轉的技能，findSkillJob 現職優先，
   所以二轉階段剩下的點數再也花不掉。二轉與進階二轉共用一池就通了。 */
{
  const g = CH();
  deep(g, 'ch_soulcollect', 1);                 // 前置（爆氣功 Lv5）先用大池子點掉
  g.state.jobSkillPoints = { novice: 0, acolyte: 0, monk: 3, champion: 0 };
  g.state.learnedSkills.ch_soulcollect = 0;
  t.eq('共用池看得到武僧那 3 點', g.skillPointsAvailable('champion'), 3);
  t.eq('兩邊算出來是同一個數字', g.skillPointsAvailable('monk'), g.skillPointsAvailable('champion'));
  // 武術宗師自己的招，用武僧剩下的點也點得動
  t.eq('用武僧的點學進階二轉的招', g.levelUpSkill('ch_soulcollect'), true);
  t.eq('扣的是武僧那格', g.state.jobSkillPoints.monk, 2);
  t.eq('進階二轉那格沒被扣成負數', g.state.jobSkillPoints.champion, 0);
  // 反過來也要通：只剩進階二轉的點時，武僧的招照樣點得動
  g.state.jobSkillPoints = { novice: 0, acolyte: 0, monk: 0, champion: 2 };
  t.eq('用進階二轉的點學武僧的招', g.levelUpSkill('mo_ironhand'), true);
  t.eq('扣的是進階二轉那格', g.state.jobSkillPoints.champion, 1);
  // 服事不在共用範圍：官方一轉的點跟二轉本來就分開
  t.eq('一轉不進共用池', g.skillPointPoolJobs('acolyte').length, 1);
  g.state.jobSkillPoints = { novice: 0, acolyte: 0, monk: 0, champion: 0 };
  t.eq('兩格都空就真的點不動', g.levelUpSkill('mo_ironhand'), false);
}

/* ---- 6. 修羅滿級重置：一轉／二轉各還各的池（#121） ----
   修羅整份借走母職的技能，findSkillJob 現職優先會把服事的招全判給修羅——
   舊版重置把服事的點灌進 tier≥2 的共用池又依 earned 封頂，服事那格歸零、
   二轉技能點也湊不滿應得的 138。重置改成「各池歸還到應得」後，
   服事 49、二轉線（武術宗師+修羅）138，互不侵蝕。 */
{
  const g = H.boot();
  H.mkChar(g, { path: ['acolyte', 'monk', 'champion'], rebirth: true, job: 'sura' });
  g.state.jobLevel = 70;
  g.state.jobLevelHistory = { novice: 10, acolyte: 50, monk: 50, champion: 70 };
  g.state.jobSkillPoints = { novice: 0, acolyte: 0, monk: 0, champion: 0, sura: 0 };
  g.state.learnedSkills = { heal: 5, increaseagi: 5, ch_soulcollect: 5, ch_tigerfist: 5 };
  g.state.skillPoints = 0;
  g.recomputeDerived(true);
  g.resetSkills();
  t.eq('一轉（服事）的點還回服事的池', g.state.jobSkillPoints.acolyte, 49);
  t.eq('二轉線應得 138（武宗69+修羅69）', (g.state.jobSkillPoints.monk || 0) + g.state.jobSkillPoints.champion + (g.state.jobSkillPoints.sura || 0), 138);
}

t.report('神行太保 4 + 武術宗師 4 技能');
