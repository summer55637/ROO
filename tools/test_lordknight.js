/* 領主騎士 8 個技能的回歸測試（#58）。

   跑法：node tools/test_lordknight.js
   全過就印一行；有失敗才列出來，並以 exit code 1 結束。

   每一項都是「真的跑」——走 recomputeDerived / castSkill / tryOnAttackStrikes 本尊，
   不是讀資料檔對答案。機率型的用 rate() 抽樣，允許誤差寫在 near() 的第四個參數。
*/
const H = require('./harness');

const t = H.tester();
const LK = { path: ['swordsman', 'knight'], rebirth: true, job: 'lordknight' };

/* ---------- 1. 職業框架 ---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  t.eq('職業是領主騎士', g.state.jobId, 'lordknight');
  t.eq('職業等級上限 70', g.currentJob().jobLevelMax, 70);
  const own = ['lk_berserk', 'lk_tensionrelax', 'lk_parrying', 'lk_aurablade',
    'lk_concentration', 'lk_headcrush', 'lk_jointbeat', 'lk_spiralpierce'];
  const have = new Set(g.currentJob().skills.map(s => s.id));
  t.ok('官方 8 個技能到齊', own.every(id => have.has(id)));
  /* #60 之後進階二轉「取代」二轉（劍士直接轉領主騎士，不再經過騎士），
     所以騎士的技能靠 borrowSkillsFrom 整份借過來，不然這條路線會少一整個職業的招。 */
  const knightIds = g.JOB_TREE.knight.skills.map(s => s.id);
  t.ok('騎士的技能整份借過來', knightIds.every(id => have.has(id)),
    knightIds.filter(id => !have.has(id)).join(','));
  t.ok('借來的技能記在來源職業（騎士）的點數池', g.findSkillJob('riding') === 'knight');
  t.eq('轉生路線被鎖住', g.rebirthPathNext(), 'runeknight');
  t.eq('不能再轉生一次', g.rebirthBlockReason(), '每隻角色只能轉生一次。');

  // HP/SP 是本職 ×1.25、攻速與本職完全相同。
  // 基準要拿**沒轉生的騎士**——轉生後根本走不到騎士那一站了（#60）
  const gk = H.boot();
  H.mkChar(gk, { path: ['swordsman', 'knight'], jobLevel: 50 });
  const kn = { hp: gk.state.maxHp, sp: gk.state.maxSp, aspd: gk.state.aspd };
  const g2 = H.boot();
  H.mkChar(g2, LK);
  g2.state.jobLevel = 50;              // 同職業等級才比得準
  g2.recomputeDerived(true);
  /* #92：那 25% 不再是職業資料上的係數，改成掛在「轉生過」這件事上。
     驗的方式也跟著換——同一隻角色，只翻 rebirthCount，HP/SP 應該剛好差 1.25 倍。 */
  {
    const gt = H.boot();
    H.mkChar(gt, { path: ['swordsman', 'knight'], jobLevel: 50 });
    const before = { hp: gt.state.maxHp, sp: gt.state.maxSp };
    gt.state.rebirthCount = 1;
    gt.recomputeDerived(true);
    t.eq('轉生後 HP 是 1.25 倍', gt.state.maxHp, Math.floor(before.hp * 1.25));
    t.eq('轉生後 SP 是 1.25 倍', gt.state.maxSp, Math.floor(before.sp * 1.25));
  }

  /* #60 要抓的是「職業加成被算了兩遍」——那時候要先當一次騎士，騎士的 bonusLevels
     算一次、領主騎士自己的清單（當時的內容就是「騎士的清單 + 51~70」）又算一次。
     進階二轉改成取代二轉之後，騎士那一站根本不存在，直接驗這件事最準： */
  t.ok('轉生後沒有騎士的職業等級紀錄（沒有重複計算的來源）',
    !(g2.state.jobLevelHistory && g2.state.jobLevelHistory.knight));

  /* 實測 HP/SP 的比值**不再等於 1.25**（#75 起）。
     官方轉生職有自己的一張 BonusStats，1~50 那段跟原二轉就不一樣——
     騎士 Lv50 之前有 10 點 VIT，領主騎士官方只有 6 點，HP 自然低一截。
     所以要驗係數就得先把職業加成拿掉，不然量到的是「係數 × 加成差」。 */
  const flat = (gg, jid) => {
    const save = gg.JOB_TREE[jid].bonusLevels;
    gg.JOB_TREE[jid].bonusLevels = { str: [], agi: [], vit: [], int: [], dex: [], luk: [] };
    gg.recomputeDerived(true);
    const r = { hp: gg.state.maxHp, sp: gg.state.maxSp };
    gg.JOB_TREE[jid].bonusLevels = save;
    gg.recomputeDerived(true);
    return r;
  };
  const knFlat = flat(gk, 'knight');
  const lkFlat = flat(g2, 'lordknight');
  t.near('拿掉職業加成後，HP 就是乾淨的 1.25 倍', lkFlat.hp / knFlat.hp, 1.25, 0.02);
  t.near('拿掉職業加成後，SP 就是乾淨的 1.25 倍', lkFlat.sp / knFlat.sp, 1.25, 0.02);
  t.ok('帶著官方加成表時 HP 比值會低於 1.25（官方表本來就比較少 VIT）',
    g2.state.maxHp / kn.hp < 1.25, (g2.state.maxHp / kn.hp).toFixed(3));
  t.eq('ASPD 與騎士相同', g2.state.aspd, kn.aspd);
}

/* ---------- 2. 雙劍挌擋（被動，雙手劍限定）---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.learn(g, 'lk_parrying');
  H.wield(g, 'sword2');
  t.eq('拿雙手劍時機率 55%', g.state.parryingChance, 55);
  const blocked = H.rate(4000, () => g.playerBlocked());
  t.near('實際擋下率', blocked / 4000 * 100, 55, 3);
  H.wield(g, 'dagger');
  t.eq('拿短劍時歸零', g.state.parryingChance, 0);
  t.eq('拿短劍時擋不下來', H.rate(2000, () => g.playerBlocked()), 0);
}

/* ---------- 3. 狂怒之槍（被動，受擊觸發）---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.learn(g, 'lk_berserk');
  H.wield(g, 'sword2');
  const fired = H.rate(2000,
    () => g.state.buffs.some(b => b.skillId === 'lk_berserk'),
    () => { g.state.buffs = []; g.state.frenzyReadyAt = 0; g.tryFrenzyProc(); });
  t.near('觸發率 10%', fired / 2000 * 100, 10, 2);

  g.state.buffs = []; g.state.frenzyReadyAt = 0; g.recomputeDerived(true);
  const before = { aspd: g.state.aspd, atkMult: g.buffMult('atk').mult };
  while (!g.state.buffs.length) g.tryFrenzyProc();
  g.recomputeDerived(true);
  t.eq('ATK 倍率 ×2', g.buffMult('atk').mult, 2);
  t.eq('ASPD +2', g.state.aspd - before.aspd, 2);

  // 冷卻中不該再觸發（buff 數維持 2：atk + aspd）
  const n0 = g.state.buffs.length;
  for (let i = 0; i < 500; i++) g.tryFrenzyProc();
  t.eq('30 秒內部冷卻擋得住', g.state.buffs.length, n0);
}

/* ---------- 4. 極速回復（被動，自然回復加倍）---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.wield(g, 'spear1');
  const tick = () => { g.state.hp = 1; g.passiveRegen(); return g.state.hp - 1; };
  const base = tick();
  t.ok('未學時回復固定', H.rate(200, () => tick() !== base) === 0);
  H.learn(g, 'lk_tensionrelax');
  t.eq('機率設定 30%', g.state.regenDoubleChance, 30);
  // 使用確定性 100 值循環，每 100 次剛好 30 次低於 30%，避免隨機抽樣讓 CI 偶發失敗。
  const originalRandom = g.Math.random;
  let randomIndex = 0;
  let doubled;
  try {
    g.Math.random = () => ((randomIndex++ % 100) + 0.5) / 100;
    doubled = H.rate(2000, () => tick() > base);
  } finally {
    g.Math.random = originalRandom;
  }
  t.eq('加倍觸發率 30%（確定性樣本）', doubled, 600);
}

/* ---------- 5. 傷害增壓 / 巧打（被動，普攻追擊）---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.learn(g, 'lk_headcrush'); H.learn(g, 'lk_jointbeat');
  H.wield(g, 'spear1');
  t.eq('兩個都登記成普攻追擊', g.state.onAttackStrikes.length, 2);

  const count = { lk_headcrush: 0, lk_jointbeat: 0 };
  const m0 = H.mon(g, { size: 'medium', isBoss: false });
  const md = g.MONSTERS[m0.defId];
  for (let i = 0; i < 3000; i++) {
    g.state.onAttackStrikeReadyAt = {};          // 只量機率，不量冷卻
    const hpBefore = m0.hp;
    const seen = { ...g.state.onAttackStrikeReadyAt };
    g.tryOnAttackStrikes(m0, md);
    Object.keys(g.state.onAttackStrikeReadyAt).forEach(k => { if (!(k in seen)) count[k]++; });
    m0.hp = hpBefore;
  }
  t.near('傷害增壓觸發率 25%', count.lk_headcrush / 3000 * 100, 25, 3);
  t.near('巧打觸發率 30%', count.lk_jointbeat / 3000 * 100, 30, 3);

  // 內部冷卻：連續呼叫只該各中一次
  g.state.onAttackStrikeReadyAt = {};
  let fires = 0;
  const m1 = H.mon(g, { size: 'medium', isBoss: false });
  for (let i = 0; i < 500; i++) {
    const before = Object.keys(g.state.onAttackStrikeReadyAt).length;
    g.tryOnAttackStrikes(m1, g.MONSTERS[m1.defId]);
    fires += Object.keys(g.state.onAttackStrikeReadyAt).length - before;
    m1.hp = 9e9;
  }
  t.eq('5 秒內部冷卻：兩個技能各只中一次', fires, 2);

  // 巧打限矛：換雙手劍後只剩傷害增壓
  H.wield(g, 'sword2');
  t.eq('拿雙手劍時巧打不登記', g.state.onAttackStrikes.length, 1);
  t.eq('剩下的是傷害增壓', g.state.onAttackStrikes[0].id, 'lk_headcrush');
}

/* ---------- 6. 靈氣劍（固定附加傷害，無視防禦）---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.learn(g, 'lk_aurablade');
  H.wield(g, 'spear1');
  const lowDef = Object.values(g.MONSTERS).find(m => !m.isBoss && (m.def || 0) < 5);
  const hiDef = Object.values(g.MONSTERS).find(m => !m.isBoss && (m.def || 0) > 300);
  const dmg = md => Math.round(
    g.mitigateDamage(g.weaponChainDamage(md, 1, 'mid'), ...g.defOf(md)) + g.raceFlatBonus(md));
  const b = { low: dmg(lowDef), hi: dmg(hiDef) };
  g.state.sp = g.state.maxSp; g.state.cooldowns = {};
  H.mon(g, { size: 'medium', isBoss: false });
  t.ok('施放成功', g.castSkill('lk_aurablade'));
  g.recomputeDerived(true);
  /* 使用者 2026-08-22 改公式：固定傷害＝玩家等級 × perLevel。
     H.learn 預設學滿 Lv5 → perLevel=10；mkChar baseLevel=99 → 990 */
  const expectFlat = g.state.baseLevel * g.SKILLS['lk_aurablade'].perLevel[4];
  t.eq('低防怪 +' + expectFlat, dmg(lowDef) - b.low, expectFlat);
  t.eq('高防怪也 +' + expectFlat + '（＝無視防禦）', dmg(hiDef) - b.hi, expectFlat);
}

/* ---------- 7. 集中攻擊（ATK＋／DEF−）---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.learn(g, 'lk_concentration');
  H.wield(g, 'spear1');
  const mid = Object.values(g.MONSTERS).find(m => m.size === 'medium' && !m.isBoss);
  const a0 = g.weaponChainDamage(mid, 1, 'mid');
  const d0 = g.debuffedDef(g.state.defHard, g.state.defSoft);
  g.state.sp = g.state.maxSp; g.state.cooldowns = {};
  H.mon(g, { size: 'medium', isBoss: false });
  t.ok('施放成功', g.castSkill('lk_concentration'));
  g.recomputeDerived(true);
  t.near('ATK ×1.25', g.weaponChainDamage(mid, 1, 'mid') / a0, 1.25, 0.01);
  const d1 = g.debuffedDef(g.state.defHard, g.state.defSoft);
  t.near('軟防 ×0.75（代價）', d1[1] / d0[1], 0.75, 0.02);
}

/* ---------- 8. 螺旋擊刺（矛限定／武器重量／無視體型）---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.learn(g, 'lk_spiralpierce'); H.learn(g, 'pierce');
  const sk = g.SKILLS.lk_spiralpierce;
  t.eq('官方 5 段合成後的總倍率', sk.mult[4], 17.5);

  H.wield(g, 'spear1');
  g.state.sp = g.state.maxSp; g.state.cooldowns = {};
  H.mon(g, { size: 'medium', isBoss: false });
  t.ok('拿矛可以放', g.castSkill('lk_spiralpierce'));
  H.wield(g, 'sword2');
  g.state.sp = g.state.maxSp; g.state.cooldowns = {};
  H.mon(g, { size: 'medium', isBoss: false });
  /* 官方擴充（使用者 2026-08-22 指定）：雙手劍也能放螺旋擊刺 */
  t.ok('拿雙手劍也放得出來', g.castSkill('lk_spiralpierce'));

  // 無視體型：小型怪不該再吃 0.75 懲罰
  H.wield(g, 'spear1');
  const small = Object.values(g.MONSTERS).find(m => m.size === 'small' && !m.isBoss);
  t.eq('小型怪本來有體型懲罰', g.getSizeMultiplier(small) < 1, true);
  const plain = g.weaponChainDamage(small, 1, 'mid');
  const noPenalty = g.weaponChainDamage(small, 1, 'mid', { ignoreSize: true });
  t.ok('無視體型確實拿掉懲罰', noPenalty > plain, `含懲罰 ${plain.toFixed(0)} / 無視 ${noPenalty.toFixed(0)}`);

  // 武器重量：重矛的加成要比輕矛大
  const spears = Object.keys(g.ITEMS).filter(k => g.ITEMS[k].type === 'weapon'
    && ['spear1', 'spear2'].includes(g.aspdCategoryOf(k)) && !g.equipBlockReason(k))
    .sort((a, b) => (g.ITEMS[a].weight || 0) - (g.ITEMS[b].weight || 0));
  const mid2 = Object.values(g.MONSTERS).find(m => m.size === 'medium' && !m.isBoss);
  const gain = id => {
    g.addItem(id, 1); g.equipItem(id); g.recomputeDerived(true);
    return g.weaponChainDamage(mid2, 1, 'mid', sk) - g.weaponChainDamage(mid2, 1, 'mid', { ignoreSize: true });
  };
  const light = gain(spears[0]);
  const heavy = gain(spears[spears.length - 1]);
  t.ok('重矛的重量加成大於輕矛', heavy > light, `輕 ${light.toFixed(0)} / 重 ${heavy.toFixed(0)}`);
  t.near('輕矛（重量 0）幾乎沒有重量加成', light, 0, 1);
}

/* ---------- 9. 順手修掉的既有 bug 不能再壞回去 ---------- */
{
  const g = H.boot();
  H.mkChar(g, LK);
  H.wield(g, 'spear1');
  const mid = Object.values(g.MONSTERS).find(m => m.size === 'medium' && !m.isBoss);

  // (a) ATK buff 要同時作用在普攻與技能鏈上（#58）
  const p0 = g.weaponChainDamage(mid, 1, 'mid');
  const s0 = g.skillBaseDamage(false, mid, 1, g.SKILLS.lk_jointbeat);
  g.state.buffs.push({ type: 'atk', mult: 2, msRemaining: 60000 });
  g.recomputeDerived(true);
  t.near('ATK buff 對普攻鏈生效', g.weaponChainDamage(mid, 1, 'mid') / p0, 2, 0.01);
  t.near('ATK buff 對技能鏈也生效', g.skillBaseDamage(false, mid, 1, g.SKILLS.lk_jointbeat) / s0, 2, 0.02);

  // (b) DEF buff 以前推了沒人讀（#58，同 #24 的 buff_flee）
  g.state.buffs = []; g.recomputeDerived(true);
  const d0 = g.debuffedDef(g.state.defHard, g.state.defSoft);
  g.state.buffs.push({ type: 'def', mult: 1.55, msRemaining: 60000 });
  g.recomputeDerived(true);
  const d1 = g.debuffedDef(g.state.defHard, g.state.defSoft);
  t.near('DEF buff 真的提升防禦', d1[1] / d0[1], 1.55, 0.03);

  // (c) 武器重量是 ×10 的原始值，別再乘錯尺度
  t.eq('短劍重量是官方原始值 40', g.ITEMS.knife.weight, 40);
}

/* ---------- 技能點重置（#116）：進階二轉取代二轉 ----------
   滿級（JOB70）應有 20(新手)+49(一轉)+69(進階二轉)=138 點，
   三轉再加 69=207。重置不能少還點數——騎士被領主騎士取代，
   騎士那 49 點不能再算，否則玩家實際只拿得到進階那格而白白損失。 */
{
  // 進階二轉滿級重置
  const g = H.boot();
  H.mkChar(g, LK);
  g.state.jobLevel = 70;
  g.state.jobLevelHistory = { novice: 10, swordsman: 50, knight: 50 };
  g.state.jobSkillPoints = { novice: 20, swordsman: 49, knight: 0, lordknight: 69 };
  g.state.skillPoints = 138;
  g.recomputeDerived(true);
  // 用實際 levelUpSkill 把點花在技能上（騎士與領主騎士共用池）
  for (const id of ['twohandquicken', 'spearmastery', 'bowlingbash', 'pierce',
    'spearboomerang', 'brandishspear', 'counter', 'lk_spiralpierce', 'riding',
    'charge', 'cavaliermastery', 'bash', 'provoke', 'increasehp', 'anger',
    'magnumbreak', 'swordmastery', 'onehandquicken', 'berserk']) {
    const sk = g.SKILLS[id];
    if (!sk || sk.isQuest) continue;
    for (let i = (g.state.learnedSkills[id] || 0); i < (sk.maxLv || 1); i++) {
      const before = g.state.skillPoints;
      if (!g.levelUpSkill(id)) break;
      if (g.state.skillPoints === before) break;
    }
  }
  const spent = 138 - g.state.skillPoints;
  g.resetSkills();
  const back = Object.values(g.state.jobSkillPoints).reduce((a, b) => a + b, 0);
  t.eq('進階二轉滿級重置拿回 138（花掉 ' + spent + '）', back, 138);
  t.eq('騎士那格歸零（被取代）', g.state.jobSkillPoints['knight'], 0);

  // 三轉滿級重置
  const g3 = H.boot();
  H.mkChar(g3, { path: ['swordsman', 'knight'], rebirth: true, job: 'lordknight', baseLevel: 99 });
  g3.state.jobLevel = g3.JOB_TREE.lordknight.jobLevelMax;
  g3.state.jobSkillPoints.lordknight = 0;
  t.eq('轉得了盧恩騎士', g3.doJobChange('runeknight'), true);
  g3.state.jobLevel = 70;
  g3.state.jobLevelHistory = { novice: 10, swordsman: 50, knight: 50, lordknight: 70 };
  g3.state.jobSkillPoints = { novice: 20, swordsman: 49, knight: 0, lordknight: 69, runeknight: 69 };
  g3.state.skillPoints = 207;
  g3.recomputeDerived(true);
  for (const id of ['lk_berserk', 'lk_tensionrelax', 'lk_parrying', 'lk_aurablade',
    'lk_concentration', 'lk_headcrush', 'lk_jointbeat', 'lk_spiralpierce', 'riding',
    'charge', 'cavaliermastery', 'bowlingbash', 'pierce', 'twohandquicken',
    'spearmastery', 'spearstab', 'spearboomerang', 'brandishspear', 'counter',
    'bash', 'provoke', 'increasehp', 'anger', 'magnumbreak', 'swordmastery',
    'onehandquicken', 'berserk']) {
    const sk = g3.SKILLS[id];
    if (!sk || sk.isQuest) continue;
    for (let i = (g3.state.learnedSkills[id] || 0); i < (sk.maxLv || 1); i++) {
      const before = g3.state.skillPoints;
      if (!g3.levelUpSkill(id)) break;
      if (g3.state.skillPoints === before) break;
    }
  }
  const spent3 = 207 - g3.state.skillPoints;
  g3.resetSkills();
  const back3 = Object.values(g3.state.jobSkillPoints).reduce((a, b) => a + b, 0);
  t.eq('三轉滿級重置拿回 207（花掉 ' + spent3 + '）', back3, 207);
}

/* ---------- 補回被舊重置吃掉的點數（#116） ----------
   舊版重置對進階二轉／三轉少還點（騎士那筆被誤算又砍掉），
   讀檔時 repairSkillPointDeficit() 要照職業與 JOB 等級補足差額。 */
{
  // 進階二轉滿級但被吃過：總量只剩 69 而非 138
  const g = H.boot();
  H.mkChar(g, LK);
  g.state.jobLevel = 70;
  g.state.jobLevelHistory = { novice: 10, swordsman: 50, knight: 50 };
  g.state.jobSkillPoints = { novice: 0, swordsman: 0, knight: 0, lordknight: 40 };
  g.state.learnedSkills = { twohandquicken: 10, spearmastery: 10, pierce: 9 };
  g.state.skillPoints = 40;
  g.recomputeDerived(true);
  const def = g.repairSkillPointDeficit();
  const have = Object.values(g.state.jobSkillPoints).reduce((a, b) => a + b, 0)
    + Object.values(g.state.learnedSkills).reduce((a, b) => a + b, 0);
  t.eq('補回缺 69 點', def, 69);
  t.eq('修補後總量 = 138', have, 138);

  // 健康角色不該被動
  const g2 = H.boot();
  H.mkChar(g2, LK);
  g2.state.jobLevel = 70;
  g2.state.jobLevelHistory = { novice: 10, swordsman: 50, knight: 50 };
  g2.state.jobSkillPoints = { novice: 20, swordsman: 49, knight: 0, lordknight: 69 };
  g2.state.skillPoints = 138;
  g2.recomputeDerived(true);
  t.eq('健康角色不補點', g2.repairSkillPointDeficit(), 0);
}

/* ---------- 任務技能重置後保留 1 級（#116） ----------
   任務技能是轉職直接送的 1 級、無法用點升級（isQuest），
   重置時不能刪掉，否則就永久消失。 */
{
  const g = H.boot();
  H.mkChar(g, LK);
  const quest = g.currentJob().skills.filter(s => s.isQuest).map(s => s.id);
  t.ok('領主騎士有任務技能', quest.length > 0);
  g.state.learnedSkills['bowlingbash'] = 5;
  g.state.jobSkillPoints['lordknight'] = 40;
  g.state.skillPoints = 40;
  g.recomputeDerived(true);
  g.resetSkills();
  t.ok('任務技能重置後仍為 1 級', quest.every(id => g.state.learnedSkills[id] === 1));
  /* 重置是「各池歸還到應得」：滿級領主騎士 earned 69，bowingbash 那 5 點也一併還回 */
  t.eq('非任務技能已退款（池回到應得量）', g.state.jobSkillPoints['lordknight'], 69);

  // 已經被舊版重置刪掉的任務技能（0 級），讀檔時要補回 1 級
  const g4 = H.boot();
  H.mkChar(g4, LK);
  const q4 = g4.currentJob().skills.filter(s => s.isQuest).map(s => s.id);
  q4.forEach(id => { delete g4.state.learnedSkills[id]; });   // 模擬舊 bug 刪光
  g4.saveGame();
  g4.loadGame();
  t.ok('被刪的任務技能讀檔補回 1 級', q4.every(id => g4.state.learnedSkills[id] === 1));
}

process.exit(t.report('領主騎士 8 技能'));
