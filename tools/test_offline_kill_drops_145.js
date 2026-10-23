/* 離線結算漏掉的「擊殺時才會發生的事」（#145）。

   玩家回報「邪惡箱卡片離線沒有效果」。查下去發現那不是一張卡的問題——
   離線那段只算了 `def.drops` 一項，線上 killMonster() 裡其他每一件都沒發生：

     · 卡片／裝備的附加掉落（邪惡箱、廚刀掉肉、獸人弓掉鋼鐵箭…）
     · **一般怪的卡片掉落**（之前只補了頭目那半邊）
     · 偷竊、貪婪、尋找礦石
     · 頭目的以太礦石、遺物碎片與遺物券
     · 打寶模式的血量／經驗／鋅幣／掉落四個倍率——三種模式跑出來一模一樣

   全部都不會噴錯，只會「東西比較少」，所以要一項一項量。
   量的方式是**同一隻角色、開卡與不開卡各跑一次**比差額，
   不是去讀 EQUIP/CARDS 的欄位對答案。 */
const H = require('./harness');
const t = H.tester();

function hero(opts) {
  const g = H.boot();
  H.mkChar(g, Object.assign({ path: ['swordsman', 'knight'], job: 'knight', baseLevel: 99,
    stats: { str: 99, agi: 60, vit: 50, int: 1, dex: 60, luk: 1 }, gold: 1e6 }, opts || {}));
  g.state.mapId = g.MAPS.find(m => (m.monsters || []).length).id;
  return g;
}
function offline(g, hours) {
  g.state.lastActiveAt = Date.now() - (hours || 1) * 3600 * 1000;
  return g.computeOfflineProgress(5000);
}

// 離線倍率比較要用配對的固定抽樣，避免 3 秒戰鬥樣本受隨機暴擊／命中影響。
function offlineSeeded(g, hours, seedText) {
  const originalRandom = g.Math.random;
  let seed = 2166136261;
  for (const ch of String(seedText || 'offline-test')) {
    seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  }
  seed >>>= 0;
  if (!seed) seed = 1;
  g.Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try {
    return offline(g, hours);
  } finally {
    g.Math.random = originalRandom;
  }
}
const qtyOf = (r, id) => (r.itemsGained.find(i => i.item === id) || {}).qty || 0;
// 戴一張卡：找一件穿得上、有孔的飾品插進去
function wearCard(g, cardId) {
  const acc = Object.keys(g.ITEMS).find(k => g.ITEMS[k].type === 'armor'
    && g.ITEMS[k].armorType === 'accessory' && g.ITEMS[k].slots > 0 && !g.equipBlockReason(k));
  g.addItem(acc, 1); g.equipItem(acc);
  g.addItem(cardId, 1); g.insertCard('accessory1', cardId);
  g.recomputeDerived(true);
}

/* ---------- 邪惡箱卡片：使用者回報的那一張 ---------- */
{
  const a = hero(), b = hero();
  const r0 = offline(a);
  wearCard(b, 'mimic_card');
  t.ok('前提：卡片的附加掉落有進 cardKillDrops', (b.state.cardKillDrops || []).length > 0);
  const r1 = offline(b);
  t.eq('沒戴卡：一個神秘箱子都沒有', qtyOf(r0, 'old_blue_box_f'), 0);
  t.ok('戴了卡就掉得出來', qtyOf(r1, 'old_blue_box_f') > 0, '拿到 ' + qtyOf(r1, 'old_blue_box_f'));
  // 1% × 擊殺數，容一點抽樣誤差
  const want = r1.kills * 0.01;
  t.ok('數量對得上 1% × 擊殺數', Math.abs(qtyOf(r1, 'old_blue_box_f') - want) <= want * 0.1 + 2,
    `期望 ${Math.round(want)}、實得 ${qtyOf(r1, 'old_blue_box_f')}`);
  t.ok('東西真的進了背包，不是只寫在報表上', b.getItemQty('old_blue_box_f') > 0);
}

/* ---------- 限定種族的要照那個種族在這張圖的佔比打折 ---------- */
{
  const g = hero();
  wearCard(g, 'gargoyle_card');       // 擊殺昆蟲系 5% 掉箱子
  const map = g.MAPS.find(m => m.id === g.state.mapId);
  const tw = map.monsters.reduce((n, m) => n + m.weight, 0);
  const insect = map.monsters.reduce((n, m) =>
    n + (g.MONSTERS[m.id] && g.MONSTERS[m.id].race === 'insect' ? m.weight : 0), 0) / tw;
  const r = offline(g);
  const want = r.kills * 0.05 * insect;
  t.ok('種族佔比算得出來（後面的斷言才有意義）', insect >= 0 && insect <= 1, '昆蟲佔 ' + insect.toFixed(2));
  t.ok('限定種族的掉落照佔比打折', Math.abs(qtyOf(r, 'old_blue_box_f') - want) <= want * 0.15 + 2,
    `期望 ${Math.round(want)}、實得 ${qtyOf(r, 'old_blue_box_f')}`);
}

/* ---------- 裝備上的 killDrop 也要算（不是只有卡片）---------- */
{
  const g = hero();
  g.addItem('item_1229', 1);          // 廚刀：擊殺動物系 50% 掉肉
  g.equipItem('item_1229');
  g.recomputeDerived(true);
  t.ok('前提：廚刀的掉肉有進 cardKillDrops',
    (g.state.cardKillDrops || []).some(e => (e.items || []).includes('meat')));
  const r = offline(g);
  t.ok('裝備上的擊殺掉落離線也算得到（不是只有卡片）', qtyOf(r, 'meat') > 0, '拿到 ' + qtyOf(r, 'meat'));
}

/* ---------- 一般怪的卡片離線也要掉 ----------
   以前只補了頭目那半邊，一般怪的卡片離線永遠掉不出來。 */
{
  const g = hero();
  const r = offline(g, 12);
  const cards = r.itemsGained.filter(i => g.CARDS[i.item]);
  t.ok('離線掛 12 小時掉得到一般怪的卡片', cards.length > 0,
    cards.map(c => g.CARDS[c.item].name + '×' + c.qty).join('、') || '一張都沒有');
}

/* ---------- 偷竊／貪婪：照掉落率加權，不是均分 ---------- */
/* 偷竊與尋找礦石**要用真的學過技能的角色**：那兩個是 recomputeDerived 算出來的
   衍生欄位，手動塞進 state 的話，抽樣期間任何一次 castSkill 都會把它算回 0
   ——測試會過但什麼都沒驗到。 */
function thief() {
  const g = H.boot();
  H.mkChar(g, { path: ['thief', 'rogue'], job: 'rogue', baseLevel: 99,
    stats: { str: 60, agi: 90, vit: 40, int: 1, dex: 70, luk: 40 }, gold: 1e6 });
  g.state.mapId = g.MAPS.find(m => (m.monsters || []).length).id;
  return g;
}
{
  const a = thief(), b = thief();
  const r0 = offline(a, 6);
  b.state.jobSkillPoints.thief = 60;
  H.learn(b, 'steal', 10);
  b.recomputeDerived(true);
  t.ok('前提：偷竊真的學起來了', (b.state.stealChance || 0) > 0, '機率 ' + b.state.stealChance);
  const r1 = offline(b, 6);
  const sum = r => r.itemsGained.reduce((n, i) => n + i.qty, 0);
  t.ok('偷竊讓離線的戰利品變多', sum(r1) > sum(r0), sum(r0) + ' → ' + sum(r1));
  /* 加權才是對的：均分的話，掉落率 0.05% 的卡片會被當成 1/11 抽中。
     所以驗「卡片沒有被偷竊灌爆」——比不偷的時候多，但不能多到離譜。 */
  const cardQty = r => r.itemsGained.filter(i => b.CARDS[i.item]).reduce((n, i) => n + i.qty, 0);
  t.ok('偷竊沒有把稀有卡片灌爆', cardQty(r1) <= cardQty(r0) + Math.max(3, cardQty(r0)),
    cardQty(r0) + ' → ' + cardQty(r1));
}
{
  const g = H.boot();
  H.mkChar(g, { path: ['merchant', 'blacksmith'], job: 'blacksmith', baseLevel: 99,
    stats: { str: 90, agi: 50, vit: 50, int: 1, dex: 70, luk: 1 }, gold: 1e6 });
  g.state.mapId = g.MAPS.find(m => (m.monsters || []).length).id;
  g.state.jobSkillPoints.merchant = 60;
  H.learn(g, 'findingore', 10);
  g.recomputeDerived(true);
  t.ok('前提：尋找礦石真的學起來了', !!g.state.hasFindingOreProc && g.state.findingOreChance > 0,
    '機率 ' + g.state.findingOreChance);
  const r = offline(g, 6);
  const ores = ['boody_red', 'crystal_blue', 'wind_of_verdure', 'yellow_live'];
  const got = ores.reduce((n, id) => n + qtyOf(r, id), 0);
  t.ok('尋找礦石離線也發動', got > 0, '拿到 ' + got);
  t.ok('四種礦石都有機會拿到', ores.filter(id => qtyOf(r, id) > 0).length >= 3,
    ores.map(id => qtyOf(r, id)).join('/'));
}

/* ---------- 打寶模式三個倍率 ----------
   以前三種模式跑出來的數字一模一樣，等於開打寶掛機是白開的。 */
{
  const g = hero();
  const runs = [0, 1, 2].map(m => { g.state.farmMode = m; return offline(g); });
  t.ok('普通 → 一般：經驗變多', runs[1].expGained > runs[0].expGained,
    runs[0].expGained + ' → ' + runs[1].expGained);
  t.ok('一般 → 瘋狂：經驗再變多', runs[2].expGained > runs[1].expGained,
    runs[1].expGained + ' → ' + runs[2].expGained);
  t.ok('鋅幣也跟著上去', runs[2].goldGained > runs[0].goldGained,
    runs[0].goldGained + ' → ' + runs[2].goldGained);
  const sum = r => r.itemsGained.reduce((n, i) => n + i.qty, 0);
  t.ok('掉落也跟著上去', sum(runs[2]) > sum(runs[0]), sum(runs[0]) + ' → ' + sum(runs[2]));
}
{
  /* 血量倍率：怪變厚，擊殺數就要變少。

     這一段挑圖挑得很小心。一刀一隻的角色是**攻速**在決定擊殺數，
     血量乘幾倍都一樣；反過來打不太動的角色擊殺數趨近 0，
     整個結果被抽樣雜訊蓋過去（實測同一組設定跑出 1.05 倍與 32 倍都有）。
     所以自動找一張「擊殺數落在穩定區間」的圖，而不是寫死一個地圖 id。 */
  const g = hero({ stats: { str: 40, agi: 40, vit: 99, int: 1, dex: 70, luk: 1 } });
  const HOURS = 24;
  let picked = null, k0 = 0, e0 = 0;
  for (const mp of g.MAPS.filter(m => (m.monsters || []).length)) {
    g.state.mapId = mp.id; g.state.farmMode = 0;
    const r = offlineSeeded(g, HOURS, mp.id);
    if (r.kills >= 1000 && r.kills <= 20000) { picked = mp.id; k0 = r.kills; e0 = r.expGained; break; }
  }
  t.ok('找得到血量會決定擊殺數的圖（後面的斷言才有意義）', !!picked, picked + ' 擊殺 ' + k0);
  g.state.mapId = picked; g.state.farmMode = 2;
  const r2 = offlineSeeded(g, HOURS, picked);
  // 瘋狂：血量 ×5 → 擊殺數應該掉到約 1/5；兩次用相同抽樣序列。
  t.ok('瘋狂模式的擊殺數掉到約五分之一', k0 / r2.kills > 3.0 && k0 / r2.kills < 6.5,
    `${k0} → ${r2.kills}（÷${(k0 / r2.kills).toFixed(2)}）`);
  // 經驗 ×10 ÷ 擊殺 ÷5 → 淨值約 ×2。血量倍率沒生效的話這裡會是 ×10
  t.ok('淨經驗約 2 倍（不是 10 倍，代表血量倍率有生效）',
    r2.expGained / e0 > 1.4 && r2.expGained / e0 < 3,
    `${e0} → ${r2.expGained}（×${(r2.expGained / e0).toFixed(2)}）`);
}

/* ---------- 遺物只有打寶模式才掉 ---------- */
{
  const g = hero();
  g.state.farmMode = 0;
  const r0 = offline(g, 6);
  t.eq('不開打寶：離線不掉遺物', r0.itemsGained.filter(i => g.RELIC_ITEMS[i.item]).length, 0);
  g.state.farmMode = 2;
  const r2 = offline(g, 6);
  t.ok('開打寶：離線掉得到遺物', r2.itemsGained.filter(i => g.RELIC_ITEMS[i.item]).length > 0,
    r2.itemsGained.filter(i => g.RELIC_ITEMS[i.item]).map(i => i.item + '×' + i.qty).join('、') || '一件都沒有');
}

process.exit(t.report('離線結算漏掉的擊殺時效果'));
