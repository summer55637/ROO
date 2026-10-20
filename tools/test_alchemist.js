/* 鍊金術士（#72）：六條二轉分支的最後一個。官方 26 個技能做 16 個。

   這支要證的四件事：
     1. **召喚不做實體**——生物調撥／生命體召喚／火煙瓶投擲都是定時自動攻擊的場域，
        而且場域迴圈的「補跳」讓 0.5 秒的間隔在 1 秒心跳下也結算得完整
     2. 配藥的等級真的是一張解鎖表（前置技能點不點得下去、抵抗藥水喝不喝得了）
     3. 鋅幣折扣鏈是**相乘**的，而且真的接進 castSkill 的扣款
     4. 化學保護四個各自換到的效果都有人讀（DEF／免傷／MHP／武器ATK）

   跑法：node tools/test_alchemist.js（或由 tools/test.js 一起跑）
*/
const H = require('./harness');
const t = H.tester();

const mk = (opts) => {
  const g = H.boot(Object.assign({ captureLog: true }, opts || {}));
  H.mkChar(g, { path: ['merchant', 'alchemist'] });
  g.state.gold = 100000000;
  return g;
};
function learnChain(g, pairs) { pairs.forEach(([id, lv]) => H.learn(g, id, lv)); }
const give = (g, id, n) => g.addItem(id, n);

/* ---------------- 1. 職業本體 ---------------- */
{
  const g = H.boot();
  const j = g.JOB_TREE.alchemist;
  t.ok('鍊金術士進了 JOB_TREE', !!j);
  t.eq('父職業是商人', j.parent, 'merchant');
  t.eq('商人的分支有鍊金術士', g.JOB_TREE.merchant.next.join(','), 'blacksmith,alchemist');
  t.eq('二轉分支待辦清單清空（六條全部完成）', g.JOBS_TIER2_PENDING.length, 0);
  // 六個一轉全部都有第二條分支了（弓箭手是三條——詩人／舞孃依性別二選一）
  ['swordsman', 'mage', 'merchant', 'thief', 'acolyte'].forEach(id => {
    t.eq(`${id} 有兩條二轉分支`, g.JOB_TREE[id].next.length, 2);
  });
  t.eq('弓箭手有三條（詩人／舞孃性別二選一）', g.JOB_TREE.archer.next.length, 3);

  const own = ['am_learningpotion', 'am_pharmacy', 'am_axemastery', 'am_potionpitcher',
    'am_demonstration', 'am_acidterror', 'am_spheremine', 'am_cannibalize',
    'am_cp_helm', 'am_cp_shield', 'am_cp_armor', 'am_cp_weapon',
    'am_bioethics', 'am_callhomun', 'am_rest', 'am_resurrecthomun'];
  t.eq('16 個技能都有定義', own.filter(id => g.SKILLS[id]).length, 16);
  // 使用者指定刪掉的 10 個不能偷偷留著
  ['am_berserkpitcher', 'am_twilight1', 'am_twilight2', 'am_twilight3',
    'am_biotechnology', 'am_createcreature', 'am_cultivation',
    'am_healhomun', 'am_flamecontrol', 'am_drillmaster'].forEach(id => {
    t.ok(`${id} 已刪除`, !g.SKILLS[id]);
  });
  const ids = j.skills.map(s => s.id);
  t.eq('技能總數 = 16 自有 + 9 借用商人', ids.length, 25);
  t.ok('借到了商人的金錢攻擊', ids.includes('mammonite'));

  t.ok('有官方 HP 表', Array.isArray(g.JOB_BASE_HP.alchemist) && g.JOB_BASE_HP.alchemist.length === 100);
  const bonusCount = Object.values(j.bonusLevels).reduce((a, b) => a + b.length, 0);
  t.eq('職業加成 30 點', bonusCount, 30);
  t.eq('攻速表指向 x_煉金術師_創造者', j.aspdFrom, 'x_煉金術師_創造者');
  // 官方 HP/SP 參數跟神匠一模一樣，所以 HP 表必須逐格相同
  t.eq('HP 表與神匠完全相同（官方參數相同）',
    g.JOB_BASE_HP.alchemist.join(',') === g.JOB_BASE_HP.blacksmith.join(','), true);
}

/* ---------------- 2. 斧劍熟練度 ---------------- */
{
  const g = mk();
  const base0 = g.state.atk;
  H.learn(g, 'am_axemastery', 10);
  t.eq('空手時不生效', g.state.atk, base0);
  H.wield(g, 'axe1');
  const withAxe = g.state.atk;
  H.wield(g, 'mace');
  t.ok('換鈍器後失效（官方寫的是斧或單手劍）', g.state.atk < withAxe, `${withAxe} → ${g.state.atk}`);
  H.wield(g, 'sword1');
  t.ok('單手劍也算', g.state.atk > g.state.atk - 30);
  t.eq('分類表有 axesword', g.WEAPON_REQ_CATEGORIES.axesword.join(','), 'axe1,axe2,sword1');
}

/* ---------------- 3. 配藥＝解鎖表 ---------------- */
{
  const g = mk();
  t.eq('沒點配藥時 pharmacyLv 是 0', g.state.pharmacyLv, 0);
  // 前置擋得住：配藥 0 級時四個下游技能都點不下去
  t.eq('配藥 0 級點不了火煙瓶投擲', g.levelUpSkill('am_demonstration'), false);
  t.eq('配藥 0 級點不了強酸攻擊', g.levelUpSkill('am_acidterror'), false);
  H.learn(g, 'am_pharmacy', 1);
  t.eq('配藥 Lv1 → pharmacyLv 1', g.state.pharmacyLv, 1);
  t.ok('配藥 Lv1 點得了火煙瓶投擲', g.levelUpSkill('am_demonstration'));
  t.eq('配藥 Lv1 還點不了強酸攻擊', g.levelUpSkill('am_acidterror'), false);
  H.learn(g, 'am_pharmacy', 1);
  t.ok('配藥 Lv2 點得了強酸攻擊', g.levelUpSkill('am_acidterror'));
  H.learn(g, 'am_pharmacy', 1);
  t.ok('配藥 Lv3 點得了氣泡蟲召喚', g.levelUpSkill('am_spheremine'));
  t.ok('配藥 Lv3 點得了生物調撥', g.levelUpSkill('am_cannibalize'));
  H.learn(g, 'am_pharmacy', 1);
  t.ok('配藥 Lv4 點得了化學頭盔保護', g.levelUpSkill('am_cp_helm'));
}

/* ---------------- 4. 四種屬性抵抗藥水 ---------------- */
{
  const g = mk();
  give(g, 'resist_fire', 3); give(g, 'resist_water', 3);
  give(g, 'resist_earth', 3); give(g, 'resist_wind', 3);

  t.eq('配藥沒點時喝不了火抵抗', g.useItem('resist_fire'), false);
  t.eq('喝不掉就不會被消耗', g.getItemQty('resist_fire'), 3);

  H.learn(g, 'am_pharmacy', 5);
  t.eq('配藥 Lv5 喝得了火抵抗', g.useItem('resist_fire'), true);
  t.eq('消耗了 1 瓶', g.getItemQty('resist_fire'), 2);
  g.recomputeDerived(false);
  t.near('受火屬性傷害 −20%', (g.state.cardEleDmgReduce.fire || 0) * 100, 20, 0.01);
  t.eq('Lv5 時水抵抗還喝不了', g.useItem('resist_water'), false);

  H.learn(g, 'am_pharmacy', 3);   // → Lv8
  t.eq('配藥 Lv8 四瓶全都喝得了',
    ['resist_water', 'resist_earth', 'resist_wind'].every(id => g.useItem(id)), true);
  g.recomputeDerived(false);
  t.eq('四種屬性減傷都掛上了',
    ['fire', 'water', 'earth', 'wind'].every(e => (g.state.cardEleDmgReduce[e] || 0) > 0), true);
}

/* ---------------- 5. 鋅幣折扣鏈（相乘） ---------------- */
{
  const g = mk();
  const cost = (id) => {
    const sk = g.SKILLS[id];
    const lv = g.skillLv(id) || 1;
    const base = Array.isArray(sk.zenyCost) ? sk.zenyCost[lv - 1] : sk.zenyCost;
    const cut = (g.state.zenyCostReductionPct && g.state.zenyCostReductionPct[id]) || 0;
    return Math.round(base * (1 - cut / 100));
  };
  learnChain(g, [['am_pharmacy', 1], ['am_demonstration', 1]]);
  t.eq('沒有折扣時火煙瓶投擲 10,000', cost('am_demonstration'), 10000);

  H.learn(g, 'am_learningpotion', 10);
  t.eq('知識藥水 Lv10 → −10%', cost('am_demonstration'), 9000);
  H.learn(g, 'am_pharmacy', 8);   // → Lv9，再 −30%
  t.eq('配藥 Lv9 疊上去（相乘 0.9×0.7）', cost('am_demonstration'), 6300);

  // 生命體召喚再吃安息與復活各 −20%
  learnChain(g, [['am_callhomun', 1], ['am_rest', 1], ['am_resurrecthomun', 1]]);
  t.eq('生命體召喚全滿折扣後 40,320', cost('am_callhomun'), 40320);
  t.ok('火煙瓶投擲不吃生命體那兩段折扣', cost('am_demonstration') === 6300);

  // 真的扣得到錢
  g.state.gold = 50000;
  g.state.sp = g.state.maxSp;
  H.mon(g, { minHp: 100000 });
  const before = g.state.gold;
  t.eq('生命體召喚放得出來', g.castSkill('am_callhomun'), true);
  t.eq('castSkill 扣的是折扣後的價錢', before - g.state.gold, 40320);
  // 錢不夠就放不出來
  g.state.gold = 100; g.state.cooldowns = {};
  t.eq('鋅幣不足時放不出來', g.castSkill('am_callhomun'), false);
}

/* ---------------- 6. 召喚＝定時自動攻擊的場域 ---------------- */
{
  const g = mk();
  learnChain(g, [['am_pharmacy', 3], ['am_cannibalize', 5], ['am_bioethics', 1], ['am_callhomun', 5]]);
  g.state.sp = 99999; g.state.maxSp = 99999;
  H.mon(g, { minHp: 5000000 });

  t.eq('生物調撥放得出來', g.castSkill('am_cannibalize'), true);
  const f = g.state.activeFieldEffects.find(x => x.skillId === 'am_cannibalize');
  t.ok('推出了場域效果', !!f);
  t.eq('是 alchemy_strike 而不是新增怪物實體', f.kind, 'alchemy_strike');
  t.eq('每 3 秒一跳', f.tickIntervalSec, 3);
  t.eq('打單體不是全體', f.aoe, false);
  t.eq('附帶回血 500', f.healFlat, 500);
  t.eq('場上怪物數量沒有變（沒有召喚實體）', g.state.monsters.length, 1);

  g.state.cooldowns = {};
  t.eq('生命體召喚放得出來', g.castSkill('am_callhomun'), true);
  const h = g.state.activeFieldEffects.find(x => x.skillId === 'am_callhomun');
  t.eq('生命體 Lv5 倍率 3000%', h.mult, 30);
  t.eq('持續 30 分鐘', Math.round((h.endsAt - Date.now()) / 60000), 30);
  t.eq('兩個場域可以並存', g.state.activeFieldEffects.length >= 2, true);
  // 同一個技能再放一次只會刷新，不會疊成兩份
  g.state.cooldowns = {};
  g.castSkill('am_callhomun');
  t.eq('同一個技能不疊加', g.state.activeFieldEffects.filter(x => x.skillId === 'am_callhomun').length, 1);
}

/* ---------------- 7. 場域補跳：0.5 秒的間隔要結算得完整 ---------------- */
{
  const g = mk();
  learnChain(g, [['am_pharmacy', 1], ['am_demonstration', 5]]);
  g.state.sp = 99999; g.state.maxSp = 99999;
  H.mon(g, { minHp: 50000000 });
  g.castSkill('am_demonstration');
  const f = g.state.activeFieldEffects.find(x => x.skillId === 'am_demonstration');
  t.eq('火煙瓶投擲每 0.5 秒一跳', f.tickIntervalSec, 0.5);
  t.eq('打全體', f.aoe, true);
  t.eq('火屬性', f.element, 'fire');

  /* 這個場域迴圈住在每秒一次的慢心跳裡。補跳沒做的話，
     0.5 秒的場域每秒只會結算一次，傷害直接砍半。
     把 nextTickAt 往前撥 1 秒，這一次應該要補上 2 跳。 */
  /* gameTick() 會呼叫 spawnMonster()，而 mkChar 把角色放在**安全區**（沒有配怪），
     那支函式一進去就 `state.monsters = []`。所以要先搬到有怪的地圖。 */
  g.state.mapId = g.MAPS.find(m => m.monsters && m.monsters.length).id;
  const hpBefore = g.state.monsters[0].hp;
  const monId = g.state.monsters[0].id;
  /* 慢心跳是 1 秒一次、場域是 0.5 秒一跳，所以正常情況下每次心跳要補 2 跳：
     上一跳排在 0.5 秒前，加上現在這一跳。 */
  f.nextTickAt = Date.now() - 500;
  // **不能設 0**：gameTick 開頭是 `if (!state._lastSlowTick) ... = Date.now()`，
  // 0 是 falsy，會被當成「還沒初始化」而直接重設，慢心跳那段就不會跑
  g.state._lastSlowTick = Date.now() - 2000;
  g.gameTick();
  t.eq('一次補了 2 跳（0.5 秒間隔配 1 秒心跳）', f.ticksThisRound, 2);
  const still = g.state.monsters.find(m => m.id === monId);
  t.ok('傷害確實進去了', !!still && still.hp < hpBefore);
}

/* ---------------- 8. 氣泡蟲召喚：隨機 1~3 隻、無視防禦 ---------------- */
{
  const g = mk();
  learnChain(g, [['am_pharmacy', 3], ['am_spheremine', 5]]);
  g.state.sp = 99999; g.state.maxSp = 99999;
  t.eq('Lv5 固定傷害 4000', g.SKILLS.am_spheremine.mult[4], 4000);

  // 高防怪也照吃 4000（官方寫的是無視防禦）
  const highDef = Object.values(g.MONSTERS).find(m => (m.def || 0) >= 100 && !m.isBoss);
  H.mon(g, { defId: highDef.id, hp: 999999 });
  const before = g.state.monsters[0].hp;
  g.castSkill('am_spheremine');
  const dealt = before - g.state.monsters[0].hp;
  t.ok('傷害是 4000 的整數倍（無視防禦，沒有被減傷）', dealt === 4000 || dealt === 0,
    `實際 ${dealt}（DEF ${highDef.def}）`);

  // 場上五隻時，每次只打 1~3 隻
  const counts = new Set();
  for (let i = 0; i < 60; i++) {
    g.state.monsters = [];
    for (let k = 0; k < 5; k++) {
      g.state.monsterIdCounter++;
      g.state.monsters.push({ defId: highDef.id, hp: 999999, maxHp: 999999, id: g.state.monsterIdCounter });
    }
    g.state.cooldowns = {};
    g.castSkill('am_spheremine');
    counts.add(g.state.monsters.filter(m => m.hp < 999999).length);
  }
  t.ok('命中隻數落在 1~3', [...counts].every(n => n >= 1 && n <= 3), [...counts].sort().join(','));
  t.ok('真的會隨機變動（不是永遠打同樣隻數）', counts.size > 1, [...counts].sort().join(','));
}

/* ---------------- 9. 化學保護 ×4：四種效果都有人讀 ---------------- */
{
  const g = mk();
  learnChain(g, [['am_pharmacy', 4], ['am_cp_helm', 5], ['am_cp_shield', 5],
    ['am_cp_armor', 5], ['am_cp_weapon', 5]]);
  g.state.sp = 99999; g.state.maxSp = 99999;

  // 頭盔：DEF +100
  const def0 = g.state.def;
  g.castSkill('am_cp_helm');
  g.recomputeDerived(false);
  t.eq('化學頭盔保護：DEF buff +100', g.buffMult('defflat').flatBonus, 100);
  t.ok('DEF 真的上升了', g.state.def > def0, `${def0} → ${g.state.def}`);

  // 鎧甲：最大HP +10%
  const hp0 = g.state.maxHp;
  g.state.cooldowns = {};
  g.castSkill('am_cp_armor');
  g.recomputeDerived(false);
  t.near('化學鎧甲保護：最大HP +10%', g.state.maxHp / hp0 * 100, 110, 1);

  /* 武器：武器ATK +20%。**看 state.atk 是看不到的**——weaponatk 是在
     weaponChainDamage() 算傷害時才乘上去，不會回寫到 state.atk。所以量實際傷害。 */
  H.wield(g, 'axe1');
  H.mon(g, { minHp: 5000000 });
  const md = g.MONSTERS[g.state.monsters[0].defId];
  const avgHit = () => {
    let total = 0;
    for (let i = 0; i < 300; i++) {
      g.state.monsters[0].hp = 9e9;
      g.playerAttack();
      total += 9e9 - g.state.monsters[0].hp;
    }
    return total / 300;
  };
  // 固定測試用 RNG，避免武器浮動、暴擊與命中隨機性蓋過小比例的武器 ATK 增幅。
  // weaponatk 只放大武器 ATK 桶，不會把整包總 ATK 都乘 1.2，因此測試應比較同一浮動值。
  const originalRandom = g.Math.random;
  g.Math.random = () => 0.5;
  try {
    const plain = avgHit();
    g.state.cooldowns = {};
    g.castSkill('am_cp_weapon');
    g.recomputeDerived(false);
    t.eq('推的是 weaponatk buff', g.buffMult('weaponatk').mult, 1.2);
    const buffed = avgHit();
    t.ok('武器傷害真的上升', buffed > plain, `${plain.toFixed(0)} → ${buffed.toFixed(0)}`);
  } finally {
    g.Math.random = originalRandom;
  }

  // 盾牌：要有盾才放得出來
  const g2 = mk();
  learnChain(g2, [['am_pharmacy', 4], ['am_cp_helm', 3], ['am_cp_shield', 5]]);
  g2.state.sp = 99999; g2.state.maxSp = 99999;
  t.eq('沒裝盾時放不出來', g2.castSkill('am_cp_shield'), false);
  H.wear(g2, 'shield');
  g2.state.cooldowns = {};
  t.eq('裝了盾就放得出來', g2.castSkill('am_cp_shield'), true);
  const bb = g2.state.buffs.find(b => b.skillId === 'am_cp_shield');
  t.eq('推的是既有的 block buff', bb && bb.type, 'block');
  t.eq('20% 機率', bb.flatBonus, 20);
  t.eq('帶自己的內部冷卻 10 秒', bb.blockCdSec, 10);

  /* 冷卻只在**擲中時**才重新計時。擲失敗也扣冷卻的話，
     20% 的實際發生率會被壓到 2% 左右（跟 #66 光之盾同一個坑）。 */
  g2.state.parryingChance = 0;
  let blocked = 0;
  for (let i = 0; i < 600; i++) {
    bb.blockReadyAt = 0;              // 每次都讓冷卻是好的，量純機率
    if (g2.playerBlocked()) blocked++;
  }
  t.near('免傷機率約 20%', blocked / 600 * 100, 20, 6);
  // 冷卻中就擋不了
  bb.blockReadyAt = Date.now() + 10000;
  let afterCd = 0;
  for (let i = 0; i < 200; i++) if (g2.playerBlocked()) afterCd++;
  t.eq('冷卻中完全不會擋', afterCd, 0);
}

/* ---------------- 10. 強酸攻擊與藥水加成 ---------------- */
{
  const g = mk();
  learnChain(g, [['am_pharmacy', 2], ['am_acidterror', 5]]);
  H.wield(g, 'axe1');
  g.state.sp = 99999; g.state.maxSp = 99999;
  t.eq('Lv5 倍率 1000%', g.SKILLS.am_acidterror.mult[4], 10);
  H.mon(g, { minHp: 5000000 });
  const before = g.state.monsters[0].hp;
  t.eq('放得出來', g.castSkill('am_acidterror'), true);
  t.ok('打出了傷害', g.state.monsters[0].hp < before);

  // 知識藥水＋藥水投擲：兩個寫的是同一個欄位，必須累加不是覆蓋
  const g2 = mk();
  t.eq('初始藥效加成 0', g2.state.hpItemEffectBonusPct || 0, 0);
  H.learn(g2, 'am_learningpotion', 10);
  t.eq('知識藥水 Lv10 → +50%', g2.state.hpItemEffectBonusPct, 50);
  learnChain(g2, [['am_pharmacy', 3], ['am_potionpitcher', 5]]);
  t.eq('再加藥水投擲 Lv5 → +100%（累加不是覆蓋）', g2.state.hpItemEffectBonusPct, 100);
  // 真的影響回復量
  give(g2, 'red_potion', 5);
  g2.state.hp = 1;
  g2.useItem('red_potion');
  t.ok('紅藥回的比原始值多', g2.state.hp - 1 > g2.ITEMS.red_potion.heal,
    `回了 ${g2.state.hp - 1}，原始 ${g2.ITEMS.red_potion.heal}`);
}

/* ---------------- 11. 生命倫理：轉職獲得、官方就是沒有效果 ---------------- */
{
  const g = mk();
  t.eq('轉職自動獲得生命倫理', g.state.learnedSkills.am_bioethics, 1);
  t.eq('不用花技能點', g.SKILLS.am_bioethics.autoGrant, true);
  t.eq('官方就寫沒有效果，本作照抄', g.SKILLS.am_bioethics.mult[0], 0);
  t.eq('它是生命體召喚的前置', g.SKILLS.am_callhomun.requires.skillId, 'am_bioethics');
}

/* ---------------- 12. 整趟跑起來不會炸 ---------------- */
{
  const g = mk();
  H.learnAll(g);
  H.wield(g, 'axe1');
  H.wear(g, 'shield');
  g.state.gold = 100000000;
  g.state.sp = 99999; g.state.maxSp = 99999;
  ['am_demonstration', 'am_cannibalize', 'am_callhomun', 'am_cp_helm',
    'am_cp_armor', 'am_cp_weapon'].forEach(id => { g.state.cooldowns = {}; g.castSkill(id); });
  g.state.mapId = g.MAPS.find(m => m.monsters && m.monsters.length).id;
  H.mon(g, { minHp: 50000000 });
  for (let i = 0; i < 200; i++) {
    if (!g.state.monsters.length) H.mon(g, { minHp: 50000000 });
    g.state.monsters[0].hp = 9e9;
    g.playerAttack();
    if (i % 10 === 0) { g.state._lastSlowTick = Date.now() - 2000; g.gameTick(); }
  }
  t.ok('200 次普攻＋場域結算沒有例外', true);
  t.ok('HP 沒有掉到 0 以下', g.state.hp >= 0, g.state.hp);
  t.ok('鋅幣沒有變成負數', g.state.gold >= 0, g.state.gold);
  t.ok('場域效果還在跑', (g.state.activeFieldEffects || []).length > 0);
}

/* ---------------- 自動戰鬥頁面撈得到（#101）----------------
   使用者 2026-08-15 回報「鍊金術士技能都沒出現在自動戰鬥頁面」：ui.js 自己抄了一份
   類型白名單，火煙瓶投擲（field_phys_aoe）、氣泡蟲召喚（bomb_random）、
   生物調撥與生命體召喚（alchemy_summon）、化學保護 ×4（buff_chemical）
   一種都不在裡面，整組勾不到。分類改成走引擎的 isAttackSkill／isAutoSupportSkill。 */
{
  const g = mk();
  // 每個非被動技能都要落在其中一邊，不能兩邊都不是
  const missed = Object.values(g.SKILLS)
    .filter(sk => sk.type !== 'passive' && !g.isAttackSkill(sk) && !g.isAutoSupportSkill(sk));
  t.eq('全庫沒有分不了類的主動技能', missed.length, 0, missed.map(s => s.type).join(','));

  learnChain(g, [['am_pharmacy', 4], ['am_demonstration', 1], ['am_spheremine', 1],
    ['am_cannibalize', 1], ['am_cp_helm', 1]]);
  const ids = g.usableSkillEntries().map(e => e.sk.id);
  ['am_demonstration', 'am_cannibalize', 'am_cp_helm'].forEach(id => {
    t.ok(`${g.SKILLS[id].name} 進得了輔助勾選區`, ids.includes(id) && g.isAutoSupportSkill(g.SKILLS[id]));
  });
  t.ok('氣泡蟲召喚算攻擊技能（進下拉選單）', g.isAttackSkill(g.SKILLS.am_spheremine));

  /* 場域類不重放：生命體召喚持續 30 分鐘、冷卻 10 秒、一次 10 萬鋅幣，
     每次冷卻好就重放的話是把錢包放乾。 */
  const g2 = mk();
  learnChain(g2, [['am_pharmacy', 3], ['am_cannibalize', 1]]);
  g2.state.mapId = g2.MAPS.find(m => m.monsters && m.monsters.length).id;
  H.mon(g2, { minHp: 100000 });
  g2.state.sp = g2.state.maxSp = 9999;
  g2.state.autoSupportSkills = { am_cannibalize: true };
  g2.tryAutoCastSupportSkills();
  const gold1 = g2.state.gold;
  t.eq('第一次放出場域', (g2.state.activeFieldEffects || []).filter(f => f.skillId === 'am_cannibalize').length, 1);
  g2.state.cooldowns = {};
  g2.tryAutoCastSupportSkills();
  t.eq('場域還在時不重放（沒再扣鋅幣）', g2.state.gold, gold1);

  // 空場不放：castSkill 是先扣資源再進 switch，氣泡蟲召喚沒怪會白吃 5,000 鋅幣
  const g3 = mk();
  learnChain(g3, [['am_pharmacy', 3], ['am_spheremine', 1]]);
  g3.state.monsters = [];
  g3.state.sp = g3.state.maxSp = 9999;
  const gold3 = g3.state.gold;
  g3.state.autoSupportSkills = { am_spheremine: true };
  g3.tryAutoCastSupportSkills();
  t.eq('場上沒怪時不放氣泡蟲召喚', g3.state.gold, gold3);
}

process.exit(t.report('鍊金術士 16 技能 + 場域召喚與折扣鏈'));
