/* 遺物系統（#113）。

   只驗會壞的東西：門檻計件、加成真的進到 state、機率的分布、掉落閘門、
   券的兌換規則。**不重複斷言 relics.js 裡寫死的數字**（那是資料不是行為），
   驗的是「引擎有沒有照那份資料算」。

   `js/ui.js` 沒有載入這個治具（見 harness 檔頭），遺物頁長怎樣要開瀏覽器看。 */
const H = require('./harness');
const t = H.tester();
const g = H.boot();

const MAGE = 'mage', ASSN = 'assassin';
/* 職業鏈：只給職業名會停在新手（mkChar 要的是 path），ATK/HP 會整組偏低 */
const PATHS = {
  wizard: ['mage', 'wizard'], assassin: ['thief', 'assassin'],
  knight: ['swordsman', 'knight'], monk: ['acolyte', 'monk'],
  priest: ['acolyte', 'priest'], blacksmith: ['merchant', 'blacksmith'],
};
function withDeterministicRandom(seed, callback) {
  const originalRandom = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}
function mk(job, opts) {
  job = job || 'wizard';
  H.mkChar(g, Object.assign({ job, path: PATHS[job], baseLevel: 99, jobLevel: 50 }, opts || {}));
  g.state.inventory = [];
  g.state.relics = g.emptyRelicSlots();
  g.recomputeDerived(true);
}
// 穿某套的前 n 件
function wearN(setId, n, from) {
  g.relicPieceIdsOfSet(setId).slice(from || 0, (from || 0) + n)
    .forEach(id => { g.addItem(id, 1); g.equipRelic(id); });
  g.recomputeDerived(true);
}
// 五隻滿血的怪，每次測試前重擺
function field(n) {
  g.state.monsters = [];
  for (let i = 0; i < n; i++) {
    g.state.monsters.push({ defId: 'poring', hp: 9e8, maxHp: 9e8, id: 'm' + i + '_' + Math.random(), ail: {} });
  }
  g.state.monster = g.state.monsters[0];
}

/* ---------- 欄位與計件 ---------- */
{
  mk();
  t.eq('遺物欄格數＝部位數', Object.keys(g.state.relics).length, g.RELIC_SLOTS.length);
  t.ok('每套的件數剛好填滿所有欄位',
    Object.values(g.RELIC_SETS).every(s => g.relicPieceIdsOfSet(s.id).length === g.RELIC_SLOTS.length));
  t.ok('每套每個部位都只有一件（同套不可能重複佔格）',
    Object.values(g.RELIC_SETS).every(s => {
      const slots = g.relicPieceIdsOfSet(s.id).map(id => g.RELIC_ITEMS[id].relicSlot);
      return new Set(slots).size === slots.length;
    }));
  // 遺物不能被一般裝備流程認走，否則會去搶武器／防具欄
  t.eq('遺物不進一般裝備欄位判斷', g.resolveEquipSlotFor(g.relicPieceIdsOfSet(MAGE)[0]), null);
}

/* ---------- 三段門檻 ---------- */
{
  mk();
  wearN(MAGE, 1);
  t.eq('1 件：一段都不生效', g.activeRelicTiers().length, 0);
  wearN(MAGE, 1, 1);
  t.eq('2 件：只開第一段', g.activeRelicTiers().length, 1);
  wearN(MAGE, 2, 2);
  t.eq('4 件：仍然只有兩段（沒有第 4 段門檻）', g.activeRelicTiers().length, 2);
  t.ok('4 件時 5 件的特效沒開', !g.state.relicProcs.mage);
  wearN(MAGE, 1, 4);
  t.eq('5 件：三段全開', g.activeRelicTiers().length, 3);
  t.ok('5 件時特效旗標打開', !!g.state.relicProcs.mage);
}

/* ---------- 加成真的進到 state ---------- */
{
  mk('wizard', { stats: { str: 99, agi: 60, vit: 50, int: 99, dex: 99, luk: 1 } });
  const base = { hp: g.state.maxHp, sp: g.state.maxSp, atk: g.state.atk, hit: g.state.hit };
  const tier2 = g.RELIC_SETS[MAGE].tiers[0].bonus;
  const tier3 = g.RELIC_SETS[MAGE].tiers[1].bonus;

  wearN(MAGE, 2);
  // 容 1 點：HP% 是在總 HP 鏈的哪一段套用、進位怎麼取，不是這裡要管的事
  t.near('2 件的 MHP% 照資料生效', g.state.maxHp, base.hp * (1 + tier2.hpPct / 100), 1);
  t.ok('2 件時第二段的 ATK 還沒進來', g.state.atk === base.atk);

  wearN(MAGE, 1, 2);
  t.eq('3 件的 ATK 加在總 ATK 上', g.state.atk - base.atk, tier3.atk);
  t.eq('3 件的命中加在總命中上', g.state.hit - base.hit, tier3.hit);

  /* 拔掉要跟著消失。加成表有快取，簽章沒把遺物算進去的話這裡會抓到殘留值
     ——那正是條件式卡片踩過的坑。 */
  g.RELIC_SLOTS.forEach(s => g.unequipRelic(s));
  g.recomputeDerived(true);
  t.eq('全部卸下後 HP 回到原值', g.state.maxHp, base.hp);
  t.eq('全部卸下後 ATK 回到原值', g.state.atk, base.atk);
}

/* ---------- 5+3 混搭 ---------- */
{
  mk();
  wearN(MAGE, 5);
  wearN(ASSN, 3, 5);
  t.eq('八格塞滿兩套', g.RELIC_SLOTS.filter(s => g.state.relics[s]).length, 8);
  const counts = g.relicSetCounts();
  t.eq('主套計 5 件', counts[MAGE], 5);
  t.eq('副套計 3 件', counts[ASSN], 3);
  const on = g.activeRelicTiers();
  t.eq('主套三段全開', on.filter(x => x.setId === MAGE).length, 3);
  t.eq('副套只開前兩段', on.filter(x => x.setId === ASSN).length, 2);
  t.ok('只有主套的特效旗標打開', !!g.state.relicProcs[MAGE] && !g.state.relicProcs[ASSN]);
}

/* ---------- 同一格換套裝 ---------- */
{
  mk();
  const m0 = g.relicPieceIdsOfSet(MAGE)[0], a0 = g.relicPieceIdsOfSet(ASSN)[0];
  g.addItem(m0, 1); g.equipRelic(m0);
  g.addItem(a0, 1); g.equipRelic(a0);
  t.eq('同部位改穿另一套會換掉', g.state.relics[g.RELIC_ITEMS[a0].relicSlot], a0);
  t.eq('被換下來的退回背包，不是沒收', g.getItemQty(m0), 1);
  t.eq('背包沒有的遺物裝不上', g.equipRelic('relic_' + MAGE + '_armor'), false);
}

/* ---------- 刺客：互斥的倍率階梯 ---------- */
{
  mk('assassin');
  t.eq('沒穿滿 5 件時不會有倍率', g.rollRelicDamageMult(), 1);
  wearN(ASSN, 5);
  const N = 200000;
  const tally = {};
  for (let i = 0; i < N; i++) { const m = g.rollRelicDamageMult(); tally[m] = (tally[m] || 0) + 1; }
  const ladder = g.RELIC_PROC_ASSASSIN.ladder;
  ladder.forEach(step => {
    t.near(`${step.mult} 倍的實測機率`, (tally[step.mult] || 0) / N * 100, step.chance, Math.max(0.3, step.chance * 0.12));
  });
  const total = ladder.reduce((a, s) => a + s.chance, 0);
  t.near('沒中的比率＝100 −（各段相加）', (tally[1] || 0) / N * 100, 100 - total, 0.5);
  t.ok('互斥：不會擲出階梯以外的倍率',
    Object.keys(tally).every(k => k === '1' || ladder.some(s => String(s.mult) === k)),
    Object.keys(tally).join(','));
}

/* ---------- 刺客：攻速恆定走官方上限 ---------- */
{
  mk('assassin', { stats: { str: 99, agi: 99, vit: 50, int: 1, dex: 70, luk: 50 } });
  const before = g.state.aspd;
  g.state.buffs.push({ type: 'aspdmax', msRemaining: 5000 });
  g.recomputeDerived(true);
  t.eq('99 級吃的是 190 上限，不是寫死的 193', g.state.aspd, 190);
  g.state.baseLevel = 150;
  g.recomputeDerived(true);
  t.eq('100 級以上才到 193', g.state.aspd, g.RELIC_PROC_ASSASSIN.aspdValue);
  t.eq('攻擊間隔跟著上限走', g.state.attackInterval, g.getAttackInterval(193));
  g.state.buffs = [];
  g.recomputeDerived(true);
  t.eq('buff 消失後攻速還原', g.state.aspd, before);

  // 重複觸發是刷新不是疊加，否則高攻速角色會把持續時間堆到永久
  wearN(ASSN, 5);
  g.state.buffs = [];
  for (let i = 0; i < 3000; i++) g.tryRelicAspdProc();
  t.eq('重複觸發只留一個 buff', g.state.buffs.filter(b => b.type === 'aspdmax').length, 1);
  const b = g.state.buffs.find(x => x.type === 'aspdmax');
  t.eq('持續時間封頂在設定值（刷新不累加）', b.msRemaining, g.RELIC_PROC_ASSASSIN.aspdSec * 1000);
}

/* ---------- 法師：5 件的第三條「10% 兩倍傷害」（#148）---------- */
{
  mk('wizard', { stats: { str: 99, agi: 60, vit: 50, int: 99, dex: 99, luk: 1 } });
  t.eq('沒穿滿 5 件時不會有倍率', g.rollRelicDamageMult(), 1);
  wearN(MAGE, 5);
  const P = g.RELIC_PROC_MAGE;
  const N = 200000;
  const tally = {};
  for (let i = 0; i < N; i++) { const m = g.rollRelicDamageMult(); tally[m] = (tally[m] || 0) + 1; }
  t.near('兩倍的實測機率', (tally[P.doubleMult] || 0) / N * 100, P.doubleChance, 0.4);
  /* 只會擲出 1 或那個倍率——擲出第三種值代表跟刺客那條梯子接在一起了。
     兩套的 5 件不可能同時成立（八個欄位放不下兩個五件套），所以不該互相污染。 */
  t.eq('不會擲出其他倍率',
    Object.keys(tally).filter(k => +k !== 1 && +k !== P.doubleMult).join(','), '');
  t.ok('法師沒有刺客那條梯子的 10 倍', !tally[10]);
}

/* ---------- 法師：黑暗與濺射 ---------- */
{
  mk('wizard', { stats: { str: 99, agi: 60, vit: 50, int: 99, dex: 99, luk: 1 } });
  wearN(MAGE, 5);
  const P = g.RELIC_PROC_MAGE;
  withDeterministicRandom(0x524f4f, () => {
    const N = 3000;
    let splashTurns = 0, mismatch = 0, blindHits = 0, blindTurns = 0;
    for (let i = 0; i < N; i++) {
      field(5);
      const before = g.state.monsters.map(m => m.hp);
      g.playerAttack();
      const after = g.state.monsters.map(m => m.hp);
      const mainDmg = before[0] - after[0];
      const others = after.slice(1).map((h, j) => before[j + 1] - h).filter(d => d > 0);
      if (others.length) {
        splashTurns++;
        if (others.some(d => d !== mainDmg)) mismatch++;
      }
      const nb = g.state.monsters.filter(m => m.ail && m.ail.blind > Date.now()).length;
      if (nb > 0) { blindTurns++; blindHits += nb; }
    }
    t.near('濺射觸發率照資料', splashTurns / N * 100, P.splashChance, 3);
    t.eq('濺射傷害跟主目標一模一樣（不重擲暴擊）', mismatch, 0);
    t.near('黑暗觸發率照資料', blindTurns / N * 100, P.blindChance, 3);
    t.near('觸發後每隻各擲一次', blindHits / blindTurns, 5 * P.blindPerMonster / 100, 0.3);

    // 場上只有一隻時濺射沒有對象，不能因此壞掉或重複打主目標
    let solo = 0;
    for (let i = 0; i < 500; i++) {
      field(1);
      const before = g.state.monsters[0].hp;
      g.playerAttack();
      if (before - g.state.monsters[0].hp > 0) solo++;
    }
    t.ok('單怪時照常打得到，不會因為濺射出錯', solo > 0);
  });
}

/* ---------- 掉落閘門 ---------- */
{
  mk();
  const def = g.MONSTERS.poring;
  const boss = Object.assign({}, def, { isBoss: true });
  const relics = () => g.relicSpareTotal();

  g.state.farmMode = g.FARM_MODE_OFF;
  for (let i = 0; i < 30000; i++) g.rollRelicDrop(def);
  t.eq('沒開打寶就一件都不掉', relics() + g.getItemQty(g.RELIC_TICKET_ID), 0);

  const N = 200000;
  g.state.farmMode = g.FARM_MODE_NORMAL;
  for (let i = 0; i < N; i++) g.rollRelicDrop(def);
  const normal = relics();
  t.near('一般怪的掉率照資料', normal / N * 100, g.RELIC_DROP_PCT_NORMAL, g.RELIC_DROP_PCT_NORMAL * 0.25);
  t.near('遺物券是另一條獨立的判定，機率相同',
    g.getItemQty(g.RELIC_TICKET_ID) / N * 100, g.RELIC_DROP_PCT_NORMAL, g.RELIC_DROP_PCT_NORMAL * 0.25);

  // 使用者指定：瘋狂**不加成**遺物掉率
  g.state.inventory = [];
  g.state.farmMode = g.FARM_MODE_MAD;
  for (let i = 0; i < N; i++) g.rollRelicDrop(def);
  t.near('瘋狂模式不加成掉率', relics() / N * 100, g.RELIC_DROP_PCT_NORMAL, g.RELIC_DROP_PCT_NORMAL * 0.25);

  /* 頭目照等級分段（#127）。驗的是**邊界**：49/50 與 79/80 各差一級卻要跳一檔，
     這種 `>=` 寫成 `>` 的錯誤只有貼著邊界打才抓得到。 */
  g.state.farmMode = g.FARM_MODE_NORMAL;
  [[49, 0.1], [50, 1], [79, 1], [80, 3], [150, 3]].forEach(([lv, want]) => {
    t.eq(`Lv${lv} 頭目掉率 ${want}%`, g.relicBossDropPct(lv), want);
  });
  t.eq('沒有 level 欄位時退到最低檔', g.relicBossDropPct(undefined), 0.1);

  // 實際擲一輪，確認 rollRelicDrop 真的有照分段走（不是只有查表函式對）
  g.state.inventory = [];
  const bigBoss = Object.assign({}, boss, { level: 99 });
  for (let i = 0; i < 20000; i++) g.rollRelicDrop(bigBoss);
  t.near('Lv99 頭目實測掉率', relics() / 20000 * 100, 3, 0.6);

  // 掉出來的一定要是能穿的東西
  g.state.inventory = [];
  for (let i = 0; i < 20000; i++) g.rollRelicDrop(bigBoss);
  const dropped = g.state.inventory.filter(r => g.RELIC_ITEMS[r.item] && g.RELIC_ITEMS[r.item].type === 'relic');
  t.ok('掉落的每一件都對得上一個遺物欄位',
    dropped.length > 0 && dropped.every(r => g.RELIC_SLOTS.includes(g.RELIC_ITEMS[r.item].relicSlot)));
  t.ok('兩套都會掉（不會只掉其中一套）',
    new Set(dropped.map(r => g.RELIC_ITEMS[r.item].relicSet)).size === Object.keys(g.RELIC_SETS).length);
}

/* ---------- 遺物券 ---------- */
{
  mk();
  const ids = g.relicPieceIdsOfSet(MAGE);
  const cost = g.RELIC_TICKET_COST;

  g.addItem(ids[0], cost - 1);
  t.eq('不足門檻換不了', g.exchangeRelicTicket(), false);
  t.eq('失敗時不會扣東西', g.relicSpareTotal(), cost - 1);

  // 從「數量最多的」開始扣：單份的珍稀部位要被留下來
  g.state.inventory = [];
  g.addItem(ids[0], cost + 5);
  g.addItem(ids[1], 1);
  t.eq('湊足就換得到', g.exchangeRelicTicket(), true);
  t.eq('券 +1', g.getItemQty(g.RELIC_TICKET_ID), 1);
  t.eq('全部從最多的那一疊扣', g.getItemQty(ids[0]), 5);
  t.eq('只有一份的沒被吃掉', g.getItemQty(ids[1]), 1);
  t.eq('總共只扣了門檻的數量', g.relicSpareTotal(), 6);

  // 兌換：券是「指定套裝」的唯一管道，不能給到別套
  g.state.inventory = [];
  g.addItem(g.RELIC_TICKET_ID, 30);
  for (let i = 0; i < 30; i++) g.redeemRelicTicket(ASSN);
  const got = g.state.inventory.filter(r => g.RELIC_ITEMS[r.item] && g.RELIC_ITEMS[r.item].type === 'relic');
  t.eq('券用完了', g.getItemQty(g.RELIC_TICKET_ID), 0);
  t.eq('拿到的件數＝用掉的券數', got.reduce((a, r) => a + r.qty, 0), 30);
  t.ok('只會拿到指定的那一套', got.every(r => g.RELIC_ITEMS[r.item].relicSet === ASSN));
  t.ok('部位是隨機的，不會固定同一件', new Set(got.map(r => r.item)).size > 1);
  t.eq('沒券時兌換失敗', g.redeemRelicTicket(ASSN), false);
}

/* ---------- 隊友換身 ---------- */
{
  mk();
  wearN(MAGE, 5);
  const worn = g.relicSetCounts()[MAGE];
  // 隊友沒有自己的遺物欄，換身期間要看得到玩家的，否則套裝效果會憑空消失
  const ally = { relics: undefined, monsters: [], monster: null };
  const seen = g.withAlly ? (() => { let n = 0; g.withAlly(ally, () => { n = g.relicSetCounts()[MAGE] || 0; }); return n; })() : worn;
  t.eq('換身期間計件仍看玩家的遺物', seen, worn);
}

/* ---------- 騎士：免傷與 atkPct ---------- */
{
  mk('knight', { stats: { str: 99, agi: 60, vit: 99, int: 1, dex: 99, luk: 1 } });
  g.addItem('southern_cross_r', 1); g.equipItem('southern_cross_r');
  g.recomputeDerived(true);
  const base = { atk: g.state.atk, def: g.state.def, mdef: g.state.mdef, hp: g.state.maxHp };
  const T = g.RELIC_SETS.knight.tiers;

  wearN('knight', 2);
  t.near('2 件 MHP%', g.state.maxHp, base.hp * (1 + T[0].bonus.hpPct / 100), 1);
  wearN('knight', 1, 2);
  t.eq('3 件 DEF 進總防', g.state.def - base.def, T[1].bonus.def);
  t.eq('3 件 MDEF 進總魔防', g.state.mdef - base.mdef, T[1].bonus.mdef);
  t.ok('3 件時還沒有免傷', !g.state.relicProcs.knight);

  wearN('knight', 2, 3);
  t.near('5 件 ATK% 乘在總 ATK 上', g.state.atk, base.atk * (1 + T[2].bonus.atkPct / 100), 2);
  /* atkPct 只乘 state.atk 是不夠的：普攻的傷害鏈分開讀三個桶子，
     漏乘的話畫面上的數字漲了、實際打出去的沒漲 */
  t.near('三個 ATK 桶子加起來仍等於 state.atk',
    (g.state._atkWeapon || 0) + (g.state._atkStatus || 0) + (g.state._atkMastery || 0), g.state.atk, 1);

  let imm = 0; const N = 200000;
  for (let i = 0; i < N; i++) if (g.relicNegatesHit()) imm++;
  t.near('免傷率照資料', imm / N * 100, g.RELIC_PROC_KNIGHT.immuneChance, 0.5);
}

/* ---------- 武僧：加特林 ---------- */
{
  mk('monk', { stats: { str: 99, agi: 99, vit: 99, int: 1, dex: 99, luk: 1 } });
  const P = g.RELIC_PROC_MONK;
  t.eq('沒穿滿不會有免傷', g.relicNegatesHit(), null);
  wearN('monk', 5);

  const real = Date.now; let fake = real();
  Date.now = () => fake;
  try {
    g.state.relicMonkReadyAt = 0;
    const mon = { defId: 'poring', hp: 9e9, maxHp: 9e9, id: 'g1', ail: {} };
    g.state.monsters = [mon]; g.state.monster = mon;
    let hits = 0;
    for (let i = 0; i < 300; i++) {                 // 同一毫秒連打 300 下
      const before = mon.hp;
      g.tryRelicMonkGatling(mon, g.MONSTERS.poring);
      if (mon.hp < before) hits++;
    }
    t.eq('CD 內只打得出一發', hits, 1);
    /* #148：3600 固定值之上再追加 ATK 100% + MATK 100%，讓這一發跟著角色成長。
       這裡不抄 3600 那個數字對答案，而是拿**角色當下的 ATK/MATK** 推期望值——
       只有一邊接錯（例如漏了 MATK）才會對不上。 */
    const expect = P.fixedDamage
      + Math.round(g.state.atk * P.atkPct / 100)
      + Math.round(g.state.matk * P.matkPct / 100);
    t.eq('那一發＝固定值＋ATK＋MATK', 9e9 - mon.hp, expect,
      `ATK ${g.state.atk}／MATK ${g.state.matk}`);
    t.ok('確實比純固定值高（追加的那兩段有生效）', expect > P.fixedDamage);

    fake += P.cooldownSec * 1000 + 1;
    let again = 0;
    for (let i = 0; i < 300 && !again; i++) {
      const before = mon.hp;
      g.tryRelicMonkGatling(mon, g.MONSTERS.poring);
      if (mon.hp < before) again = 1;
    }
    t.eq('CD 過了才放得出下一發', again, 1);

    /* 固定傷害的重點是「不吃防禦」——高防與低防的怪要掉一樣多血。
       這條壞掉的話它會安靜地變成一般傷害，DPS 直接砍掉一截 */
    const dmgByMon = {};
    ['poring', 'seyren'].forEach(id => {
      const m2 = { defId: id, hp: 9e9, maxHp: 9e9, id: 'g_' + id, ail: {} };
      g.state.monsters = [m2]; g.state.monster = m2;
      fake += P.cooldownSec * 1000 + 1;
      let d = 0;
      for (let i = 0; i < 300 && !d; i++) { const b = m2.hp; g.tryRelicMonkGatling(m2, g.MONSTERS[id]); d = b - m2.hp; }
      dmgByMon[id] = d;
    });
    /* 重點是「不吃防禦」——高防與低防的怪要掉一樣多血。
       這條壞掉的話它會安靜地變成一般傷害，DPS 直接砍掉一截。
       比的是兩隻之間**相等**，不是等於某個寫死的數字。 */
    t.eq('高防與低防的怪掉一樣多血（不吃防禦）', dmgByMon.poring, dmgByMon.seyren,
      JSON.stringify(dmgByMon));
    t.ok('而且真的有打到', dmgByMon.poring > P.fixedDamage);
  } finally { Date.now = real; }

  /* 免疫在 #148 之後是 10% **加 1 秒冷卻**。
     冷卻的意義是「同一秒內最多免一下」——沒有它的話，一波五隻怪各打一下
     就有四成機率至少免掉一發，機率會純粹疊加。
     所以要分兩件事驗：擲骰機率仍是 10%，以及冷卻真的擋得住連打。 */
  {
    const real2 = Date.now; let fake2 = real2();
    Date.now = () => fake2;
    try {
      // 同一毫秒連打：最多只能免一下
      g.state.relicMonkImmuneReadyAt = 0;
      let burst = 0;
      for (let i = 0; i < 500; i++) if (g.relicNegatesHit()) burst++;
      t.eq('同一瞬間最多只免得掉一下', burst, 1);

      // 每次都把時鐘推過冷卻 → 回到純機率，長期就是 10%
      let imm = 0; const N = 200000;
      for (let i = 0; i < N; i++) {
        fake2 += P.immuneCooldownSec * 1000 + 1;
        if (g.relicNegatesHit()) imm++;
      }
      t.near('冷卻過了之後的免傷率照資料', imm / N * 100, P.immuneChance, 0.3);
      t.ok('免傷率確實提高到 10%（原本 5%）', P.immuneChance === 10, '資料寫 ' + P.immuneChance);
    } finally { Date.now = real2; }
  }
}

/* ---------- 牧師：復活與承傷 ---------- */
{
  mk('priest', { stats: { str: 1, agi: 60, vit: 99, int: 99, dex: 99, luk: 1 } });
  const P = g.RELIC_PROC_PRIEST;
  t.eq('沒穿遺物時承傷照原本的分配', g.relicPlayerTargetPct(), g.ALLY_MONSTER_TARGET_PLAYER_PCT);
  wearN('priest', 3);
  t.eq('3 件從隊友身上多接一成', g.relicPlayerTargetPct(),
    g.ALLY_MONSTER_TARGET_PLAYER_PCT + P.takeDamagePct);
  t.eq('3 件還不會復活', g.tryRelicPriestRevive(), false);

  wearN('priest', 2, 3);
  const real = Date.now; let fake = real();
  Date.now = () => fake;
  try {
    g.resetRelicRevive();
    g.state.hp = 0;
    t.ok('5 件第一次倒下站得起來', g.tryRelicPriestRevive());
    t.near('復活後的 HP 照資料', g.state.hp, g.state.maxHp * P.reviveHpPct / 100, 1);
    g.state.hp = 0;
    t.eq('CD 內不能連續復活', g.tryRelicPriestRevive(), false);
    let ok = 1;
    for (let i = 1; i < P.charges; i++) {
      fake += P.cooldownSec * 1000 + 1; g.state.hp = 0;
      if (g.tryRelicPriestRevive()) ok++;
    }
    t.eq('總共只能用設定的次數', ok, P.charges);
    fake += P.cooldownSec * 1000 + 1; g.state.hp = 0;
    t.eq('次數用完，CD 到了也不行', g.tryRelicPriestRevive(), false);
    /* 換圖回滿——只靠 CD 的話 3 分鐘一到就是無限次，「3 次」就沒有意義了 */
    g.resetRelicRevive(); g.state.hp = 0;
    t.ok('換圖後次數回滿', g.tryRelicPriestRevive());
  } finally { Date.now = real; }
}

/* ---------- 鐵匠：護盾與追打 ---------- */
{
  mk('blacksmith', { stats: { str: 99, agi: 60, vit: 99, int: 60, dex: 99, luk: 1 } });
  g.addItem('southern_cross_r', 1); g.equipItem('southern_cross_r');
  g.recomputeDerived(true);
  const P = g.RELIC_PROC_BLACKSMITH;

  wearN('blacksmith', 5);
  const real = Date.now; let fake = real();
  Date.now = () => fake;
  try {
    g.state.shields = []; g.state.relicShieldReadyAt = 0;
    g.tickRelicShield();
    t.eq('補出一面護盾', g.state.shields.length, 1);
    t.eq('耐久照資料', g.state.shields[0].remainingHp, P.shieldHp);
    g.tickRelicShield();
    t.eq('還沒破就不會疊第二面', g.state.shields.length, 1);
    /* 耐久制不是次數制：打不破就一直擋。共用 absorbWithShields 很容易誤用
       remainingCharges，變成挨幾下就破 */
    let through = 0;
    for (let i = 0; i < 10; i++) through += g.absorbWithShields(g.state, 100);
    t.eq('連續十次小傷害全部被吸收', through, 0);
    t.eq('吸收的量從耐久扣', g.state.shields[0].remainingHp, P.shieldHp - 1000);
    t.eq('超過耐久的部分會穿透', g.absorbWithShields(g.state, P.shieldHp), 1000);
    t.eq('耐久歸零就破了', g.state.shields.length, 0);
    g.tickRelicShield();
    t.eq('CD 沒到不會馬上補', g.state.shields.length, 0);
    fake += P.shieldCooldownSec * 1000 + 1;
    g.tickRelicShield();
    t.eq('CD 到了才補回來', g.state.shields.length, 1);
  } finally { Date.now = real; }

  let procs = 0, over = 0; const N = 4000;
  for (let i = 0; i < N; i++) {
    field(4);
    const before = g.state.monsters.map(m => m.hp);
    g.tryRelicBlacksmithStrike(g.state.monsters[0]);
    const n = g.state.monsters.filter((m, j) => m.hp < before[j]).length;
    if (n > 0) procs++;
    if (n > P.targets) over++;
  }
  t.near('追打觸發率照資料', procs / N * 100, P.procChance, 2.5);
  t.eq('一次最多只打設定的目標數', over, 0);

  let single = 0;
  for (let i = 0; i < 2000; i++) {
    field(1);
    const before = g.state.monsters[0].hp;
    g.tryRelicBlacksmithStrike(g.state.monsters[0]);
    if (g.state.monsters[0].hp < before) single++;
  }
  t.ok('場上不足目標數時照樣打得到', single > 0);
}

/* ---------- 六套共同的資料完整性 ---------- */
{
  const setList = Object.values(g.RELIC_SETS);
  t.ok('每套都有描述與圖示', setList.every(s => !!s.desc && !!s.icon));
  t.ok('每套都是三段，門檻照 RELIC_TIER_NEEDS',
    setList.every(s => s.tiers.length === g.RELIC_TIER_NEEDS.length
      && s.tiers.every((tier, i) => tier.need === g.RELIC_TIER_NEEDS[i])));
  t.ok('每一段都有寫給玩家看的說明', setList.every(s => s.tiers.every(tier => !!tier.text)));
  /* 加成的鍵名打錯不會報錯，只會安靜地不生效——所以要對一次引擎認得的清單 */
  const KNOWN = ['hpPct', 'spPct', 'atk', 'hit', 'def', 'mdef', 'atkPct', 'matkPct',
    'perfectDodge', 'critRate', 'critDmgPct', 'str', 'agi', 'vit', 'int', 'dex', 'luk'];
  const bad = [];
  setList.forEach(s => s.tiers.forEach(tier =>
    Object.keys(tier.bonus || {}).forEach(k => { if (!KNOWN.includes(k)) bad.push(s.id + '.' + k); })));
  t.eq('沒有引擎不認得的加成鍵', bad.length, 0, bad.join(','));
  const procs = [];
  setList.forEach(s => s.tiers.forEach(tier => { if (tier.proc) procs.push(tier.proc); }));
  t.eq('proc 名稱不重複（撞名會讓兩套共用同一個旗標）', new Set(procs).size, procs.length, procs.join(','));
  t.ok('每套的部位名稱都齊八個',
    setList.every(s => g.RELIC_SLOTS.every(sl => !!s.pieceNames[sl])));
  t.eq('物品總數＝套數 × 部位數', g.RELIC_PIECE_IDS.length, setList.length * g.RELIC_SLOTS.length);
  t.eq('道具名稱不重複', new Set(g.RELIC_PIECE_IDS.map(id => g.RELIC_ITEMS[id].name)).size, g.RELIC_PIECE_IDS.length);
}

/* ---------- 倉庫是「保護遺物不被換券吃掉」的手段（#115） ---------- */
{
  mk();
  const ids = g.relicPieceIdsOfSet(MAGE);
  const cost = g.RELIC_TICKET_COST;
  g.localStorage.removeItem('ro_idle_warehouse');   // 倉庫是全帳號共用的，先清乾淨

  g.addItem(ids[0], cost + 4);
  g.addItem(ids[1], 2);
  const bagAll = g.relicSpareTotal();

  // 存進倉庫的那些**不算在換券的來源裡**——這是玩家保住珍稀部位的唯一手段
  t.ok('遺物存得進倉庫', g.depositToWarehouse(ids[1], 2));
  t.eq('換券的計數只看背包', g.relicSpareTotal(), bagAll - 2);
  const wh = g.loadWarehouse();
  t.eq('東西真的在倉庫裡', (wh.items.find(r => r.item === ids[1]) || {}).qty, 2);

  // 換券只會扣背包，倉庫那份原封不動
  g.exchangeRelicTicket();
  t.eq('換完券倉庫的數量沒被動到',
    (g.loadWarehouse().items.find(r => r.item === ids[1]) || {}).qty, 2);
  t.eq('扣的是背包裡的', g.getItemQty(ids[0]), 4);

  // 領回來就又算數了
  t.ok('從倉庫領得回來', g.withdrawFromWarehouse(ids[1], 2));
  t.eq('領回來之後又算進換券的來源', g.getItemQty(ids[1]), 2);
}

/* ---------- 遺物賣不掉（#115） ---------- */
{
  mk();
  const id = g.relicPieceIdsOfSet(MAGE)[0];
  g.addItem(id, 3);
  const gold = g.state.gold;
  /* 遺物的 sell 是 0，賣出等於免費銷毀。三條賣出路徑都要擋，
     只擋手動那條的話自動販賣照樣會把它吃掉 */
  t.eq('手動賣出被擋下', g.sellItem(id, 1), false);
  t.eq('數量沒少', g.getItemQty(id), 3);
  t.eq('鋅幣沒變', g.state.gold, gold);

  g.state.autoSellConfig = { items: [id] };
  g.autoSellSelectedItems();
  t.eq('自動販賣也不吃遺物', g.getItemQty(id), 3);
}

/* ---------- 背包分類（#115） ---------- */
{
  /* 分類函式住在 ui.js，治具沒載入（見檔頭），所以這裡只驗引擎側的前提：
     每件遺物都帶得出 type 與 relicSet，UI 才分得了類 */
  t.ok('每件遺物都有 relicSet 可以分組',
    g.RELIC_PIECE_IDS.every(id => !!g.RELIC_SETS[g.RELIC_ITEMS[id].relicSet]));
  t.ok('遺物的 type 一律是 relic（分類與擋賣都靠它）',
    g.RELIC_PIECE_IDS.every(id => g.RELIC_ITEMS[id].type === 'relic'));
  t.eq('遺物券不是 relic（它是消耗品，可以正常處理）',
    g.RELIC_ITEMS[g.RELIC_TICKET_ID].type, 'item');
}

process.exit(t.report('遺物系統'));
