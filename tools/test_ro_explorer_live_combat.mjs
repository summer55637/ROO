import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = process.env.ROO_BROWSER_ARTIFACT_DIR || path.join(root, 'artifacts', 'explorer-browser');
const baseUrl = process.env.ROO_LIVE_COMBAT_BASE_URL || 'http://127.0.0.1:8766';
const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
let browser;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const format = value => Number(value).toLocaleString('en-US');
const itemQty = (inventory, itemId) => (inventory || [])
  .filter(row => row && row.item === itemId && !row.instanceId)
  .reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(baseUrl + '/index.html');
      if (response.ok) return;
    } catch (error) {}
    await sleep(250);
  }
  throw new Error('主遊戲靜態伺服器未能啟動。');
}

async function sendCombatCommand(mainPage, explorerPage, command) {
  const resultKey = 'roo_explorer_combat_result_' + command.sessionId;
  await explorerPage.evaluate(payload => {
    localStorage.setItem('roo_explorer_combat_command', JSON.stringify(payload));
  }, command);
  await mainPage.waitForFunction(({ key, requestId }) => {
    try {
      const raw = localStorage.getItem(key);
      return !!raw && JSON.parse(raw).requestId === requestId;
    } catch (error) { return false; }
  }, { key: resultKey, requestId: command.requestId }, { timeout: 12000 });
  return mainPage.evaluate(key => JSON.parse(localStorage.getItem(key)), resultKey);
}

async function attackUntilKilled(mainPage, explorerPage, { sessionId, mapId, defId, spawnKey }) {
  let result = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    result = await sendCombatCommand(mainPage, explorerPage, {
      type: 'attack',
      sessionId,
      requestId: 'e2e-attack-' + attempt,
      spawnKey,
      mapId,
      defId,
    });
    assert.equal(result.ok, true, '普攻命令被主遊戲拒絕：' + JSON.stringify(result));
    if (result.killed) return result;
    if (result.rateLimited) await sleep((result.retryAfterMs || 100) + 30);
    else {
      assert.equal(result.accepted, true, '普攻未結算：' + JSON.stringify(result));
      await sleep((result.attackIntervalMs || 300) + 30);
    }
  }
  throw new Error('30 次普攻仍未擊殺目標：' + JSON.stringify(result));
}

async function readLiveState(page) {
  return page.evaluate(() => ({
    name: state.name,
    mapId: state.mapId,
    hp: state.hp,
    maxHp: state.maxHp,
    sp: state.sp,
    maxSp: state.maxSp,
    baseLevel: state.baseLevel,
    baseExp: state.baseExp,
    baseExpNeed: expToNextBaseLevel(state.baseLevel),
    jobLevel: state.jobLevel,
    jobExp: state.jobExp,
    jobExpNeed: expToNextJobLevel(state.jobLevel, JOB_TREE[state.jobId].tier),
    gold: state.gold,
    inventory: state.inventory.map(row => ({ ...row })),
    monsters: state.monsters,
    monster: state.monster,
  }));
}

function assertSaveMatches(label, saved, live) {
  for (const key of ['mapId', 'hp', 'maxHp', 'sp', 'maxSp', 'baseLevel', 'baseExp', 'jobLevel', 'jobExp', 'gold']) {
    assert.equal(saved[key], live[key], label + ' 存檔欄位 ' + key + ' 與實際角色狀態不同。');
  }
  assert.deepEqual(saved.inventory, live.inventory, label + ' 存檔背包與實際背包不同。');
  assert.deepEqual(saved.monsters, live.monsters, label + ' 存檔的放置怪物陣列被探索目標污染。');
  assert.deepEqual(saved.monster, live.monster, label + ' 存檔的單一怪物指標被探索目標污染。');
}

async function waitForExplorerHud(explorerPage, expected) {
  await explorerPage.waitForFunction(values => {
    const get = id => document.getElementById(id)?.textContent?.trim() || '';
    const expText = (current, need) => Number(current).toLocaleString('en-US') + ' / '
      + Number(need).toLocaleString('en-US');
    return get('player-hp-value') === expText(values.hp, values.maxHp)
      && get('player-sp-value') === expText(values.sp, values.maxSp)
      && get('player-base-level') === '基礎 Lv. ' + values.baseLevel
      && get('player-base-exp-value') === expText(values.baseExp, values.baseExpNeed)
      && get('player-job-level') === '職業 Lv. ' + values.jobLevel
      && get('player-job-exp-value') === expText(values.jobExp, values.jobExpNeed)
      && get('player-zeny-value') === '鋅幣 ' + Number(values.gold).toLocaleString('en-US') + 'z';
  }, expected, { timeout: 12000 });
}

try {
  await mkdir(artifactDir, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl',
      '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.setItem('ro_idle_legal_consent_v1', '1'); } catch (error) {}
  });
  const mainPage = await context.newPage();
  const mainPageErrors = [];
  mainPage.on('pageerror', error => mainPageErrors.push(String(error)));
  await mainPage.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mainPage.locator('button[onclick="showSlotSelect()"]').click();
  await mainPage.locator('.empty-slot').first().click();
  await mainPage.locator('#screen-create.active').waitFor({ state: 'visible', timeout: 10000 });
  await mainPage.locator('#char-name-input').fill('ROO戰鬥存檔驗收');
  await mainPage.locator('button[onclick="confirmCreate()"]').click();
  await mainPage.locator('#screen-game.active').waitFor({ state: 'visible', timeout: 15000 });

  const setup = await mainPage.evaluate(() => {
    let map = MAPS.find(item => item.id === 'tra_fild');
    if (!map) {
      // 目前正式本機 MAPS 沒收錄 tra_fild／新制訓練木樁資料。
      // 只在這次瀏覽器測試記憶體加入場景別名與真實 Poring 掉落表，
      // 讓畫面使用原生 tra_fild GND/GAT，同時走既有 RO 普攻／技能／掉落引擎；
      // 不寫回專案資料，不改正式玩家地圖與生怪表。
      const sourceField = MAPS.find(item => item.id === 'prt_fild08');
      const sourceSpawn = sourceField && (sourceField.monsters || []).find(item => item.id === 'poring');
      if (!sourceSpawn || !MONSTERS.poring || !Array.isArray(MONSTERS.poring.drops)) {
        throw new Error('找不到正式 RO 波利資料，無法建立 tra_fild 測試佈置。');
      }
      map = {
        id: 'tra_fild', imgId: sourceField.imgId,
        name: '普隆德拉郊外訓練場（測試佈置）',
        monsters: [{ id: 'poring', weight: 1000000000 }],
      };
      MAPS.push(map);
    }
    const eligible = map.monsters.map(spawn => ({ spawn, def: MONSTERS[spawn.id] }))
      .filter(item => item.def && Number.isFinite(item.def.hp) && item.def.hp > 0
        && Number.isFinite(item.def.exp) && Math.round(item.def.exp) > 0
        && Number.isFinite(item.def.jobExp) && Math.round(item.def.jobExp) > 0
        && Number.isInteger(item.def.imgId)
        && Array.isArray(item.def.drops)
        && item.def.drops.some(drop => drop && typeof drop.item === 'string'
          && ITEMS[drop.item] && Number(drop.chance) > 0))
      .sort((a, b) => a.def.hp - b.def.hp);
    const plan = eligible.find(item => item.def.hp <= 200) || eligible[0];
    if (!plan) throw new Error('tra_fild 沒有同時具備素材、經驗與有效道具掉落的怪物。');
    const mapSpawn = plan.spawn;
    // 測試用權重只存在本次瀏覽器記憶體，讓實際探索畫面穩定出現同一種真實地圖怪物。
    map.monsters.filter(item => item.id === mapSpawn.id).forEach(item => { item.weight = 1000000000; });
    const loot = plan.def.drops.find(drop => drop && typeof drop.item === 'string'
      && ITEMS[drop.item] && Number(drop.chance) > 0);
    state.name = 'ROO戰鬥存檔驗收';
    state.mapId = map.id;
    state.jobId = 'swordsman';
    state.baseLevel = 1;
    state.jobLevel = 10;
    state.jobLevelHistory = Object.assign({}, state.jobLevelHistory, { swordsman: 10 });
    state.stats = { str: 99, agi: 20, vit: 70, int: 60, dex: 99, luk: 20 };
    state.equip.weapon = 'knife';
    state.learnedSkills = { bash: 5 };
    state.jobSkillPoints = { swordsman: 20 };
    state.skillPoints = 20;
    state.cooldowns = {};
    state.buffs = [];
    state.encounterMode = 'melee';
    state.farmMode = 0;
    state.autoPotion = Object.assign({}, state.autoPotion, { enabled: false });
    state.monsters = [];
    state.monster = null;
    state.gold = 12345;
    state.dpsTracker = { since: Date.now(), damage: 0, exp: 0, jobExp: 0, gold: 0, kills: 0 };
    recomputeDerived(true);
    state.baseExp = Math.max(0, expToNextBaseLevel(state.baseLevel) - 1);
    state.jobExp = Math.max(0, expToNextJobLevel(state.jobLevel, JOB_TREE[state.jobId].tier) - 1);
    state.maxSp = Math.max(100, state.maxSp);
    state.sp = state.maxSp;
    state.hp = Math.max(1, Math.floor(state.maxHp * 0.73));
    state.lastSpawnTime = Date.now() + 60000;
    state.lastAttackTime = Date.now();
    state.attackAccumulator = 0;
    if (typeof selectedRegionId !== 'undefined') {
      const region = regionOf(map.id);
      if (region) selectedRegionId = region.id;
    }
    if (typeof activeTab !== 'undefined') activeTab = 'map';
    renderAll();
    saveGame();
    stopLoop();
    showScreen('screen-game');
    Math.random = () => 0.5;
    return {
      mapId: map.id,
      defId: mapSpawn.id,
      monsterName: plan.def.name,
      monsterHp: plan.def.hp,
      originalMonsterHp: plan.def.hp,
      originalMonsterAtk: plan.def.atk,
      originalMonsterAtkInterval: plan.def.atkInterval,
      originalDropChance: loot.chance,
      dropItemId: loot.item,
      dropItemName: ITEMS[loot.item].name,
      dropQtyBefore: (state.inventory || []).filter(row => row && row.item === loot.item && !row.instanceId)
        .reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0),
      playerHp: state.hp,
      playerMaxHp: state.maxHp,
      playerSp: state.sp,
      playerMaxSp: state.maxSp,
      baseExpBefore: state.baseExp,
      jobExpBefore: state.jobExp,
      goldBefore: state.gold,
      baseLevelBefore: state.baseLevel,
      jobLevelBefore: state.jobLevel,
      saveSlotKey: 'ro_idle_save_slot_0',
    };
  });
  assert.equal(setup.mapId, 'tra_fild', '端到端戰鬥必須使用真正的 tra_fild 地圖。');
  assert.ok(setup.monsterHp < 1000,
    'tra_fild 測試怪物 HP 太高，無法穩定驗證擊殺：' + JSON.stringify(setup));
  assert.equal(await mainPage.locator('#screen-game').evaluate(el => el.classList.contains('active')), true);
  await mainPage.locator('button[onclick="openRoExplorer()"]').waitFor({ state: 'visible', timeout: 10000 });
  // The product intentionally opens with noopener/noreferrer. Capture the real URL
  // built by the main-game button, then open that URL as a second same-origin tab.
  await mainPage.evaluate(() => {
    window.__rooExplorerTestOpenedUrl = null;
    window.open = url => {
      window.__rooExplorerTestOpenedUrl = String(url);
      return null;
    };
  });
  await mainPage.locator('button[onclick="openRoExplorer()"]').click();
  await mainPage.waitForFunction(() => typeof window.__rooExplorerTestOpenedUrl === 'string'
    && window.__rooExplorerTestOpenedUrl.length > 0, null, { timeout: 5000 });
  const generatedExplorerUrl = await mainPage.evaluate(() => window.__rooExplorerTestOpenedUrl);
  const explorerPage = await context.newPage();
  await explorerPage.goto(generatedExplorerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await explorerPage.locator('#player-vitals-panel').waitFor({ state: 'visible', timeout: 15000 });
  const openedUrl = new URL(explorerPage.url());
  assert.equal(openedUrl.searchParams.get('mode'), 'native');
  assert.equal(openedUrl.searchParams.get('map'), setup.mapId);
  assert.ok(JSON.parse(openedUrl.searchParams.get('mobs') || '[]').some(mob => mob.id === setup.defId),
    '主遊戲開啟探索時沒有傳入實際目標怪物。');
  assert.ok(JSON.parse(openedUrl.searchParams.get('skills') || '[]').some(skill => skill.id === 'bash'),
    '主遊戲開啟探索時沒有傳入已學的 Bash 技能。');

  await sleep(5200);
  const counterSetup = await mainPage.evaluate(({ defId }) => {
    const def = MONSTERS[defId];
    def.hp = 100000;
    def.atk = 25;
    def.atkInterval = 0.01;
    state.stats = { str: 1, agi: 1, vit: 20, int: 1, dex: 99, luk: 1 };
    state.buffs = [];
    state.cooldowns = {};
    recomputeDerived(true);
    state.perfectDodge = 0;
    state.hp = state.maxHp;
    state.sp = state.maxSp;
    state.attackInterval = 140;
    Math.random = () => 0.5;
    saveGame();
    return { hp: state.hp, maxHp: state.maxHp };
  }, setup);
  const counterSessionId = 'e2e-counter-session';
  let counterResult = await sendCombatCommand(mainPage, explorerPage, {
    type: 'attack', sessionId: counterSessionId, requestId: 'e2e-counter-0',
    spawnKey: 'countertarget', mapId: setup.mapId, defId: setup.defId,
  });
  assert.equal(counterResult.ok, true, '反擊驗收的普攻命令被拒絕：' + JSON.stringify(counterResult));
  assert.equal(counterResult.accepted, true, '反擊驗收首擊沒有結算：' + JSON.stringify(counterResult));
  assert.equal(counterResult.killed, false, '反擊驗收目標不應被首擊擊殺。');
  let counterDamageObserved = false;
  for (let attempt = 1; attempt <= 8; attempt++) {
    await sleep(Math.max(180, (counterResult.attackIntervalMs || 140) + 100));
    counterResult = await sendCombatCommand(mainPage, explorerPage, {
      type: 'attack', sessionId: counterSessionId, requestId: 'e2e-counter-' + attempt,
      spawnKey: 'countertarget', mapId: setup.mapId, defId: setup.defId,
    });
    assert.equal(counterResult.ok, true, '反擊驗收後續普攻被拒絕：' + JSON.stringify(counterResult));
    const counterState = await readLiveState(mainPage);
    if (counterState.hp < counterSetup.hp) {
      counterDamageObserved = true;
      assert.ok(counterState.hp > 0, '反擊測試不應使角色死亡。');
      break;
    }
  }
  const afterCounter = await readLiveState(mainPage);
  assert.ok(counterDamageObserved && afterCounter.hp < counterSetup.hp,
    '真實怪物反擊未造成玩家 HP 下降：' + JSON.stringify({
      hpBefore: counterSetup.hp, hpAfter: afterCounter.hp, lastResult: counterResult,
    }));

  const lootSetup = await mainPage.evaluate(({ defId, originalMonsterHp, originalMonsterAtk,
    originalMonsterAtkInterval, dropItemId }) => {
    const def = MONSTERS[defId];
    def.hp = originalMonsterHp;
    def.atk = originalMonsterAtk;
    def.atkInterval = originalMonsterAtkInterval;
    const drop = def.drops.find(item => item && item.item === dropItemId);
    if (!drop) throw new Error('測試怪物原始掉落表中找不到指定道具。');
    // 僅在瀏覽器記憶體把真實掉落表的一項機率設為 100%，避免稀有隨機掉落使 CI 不穩定。
    drop.chance = 1;
    state.stats = { str: 99, agi: 20, vit: 70, int: 60, dex: 99, luk: 20 };
    state.learnedSkills = { bash: 5 };
    state.jobSkillPoints = { swordsman: 20 };
    state.skillPoints = 20;
    state.buffs = [];
    state.cooldowns = {};
    recomputeDerived(true);
    state.baseExp = Math.max(0, expToNextBaseLevel(state.baseLevel) - 1);
    state.jobExp = Math.max(0, expToNextJobLevel(state.jobLevel, JOB_TREE[state.jobId].tier) - 1);
    state.hp = state.maxHp;
    state.sp = state.maxSp;
    state.monsters = [];
    state.monster = null;
    Math.random = () => 0.5;
    saveGame();
    return {
      lootQtyBefore: (state.inventory || []).filter(row => row && row.item === dropItemId && !row.instanceId)
        .reduce((sum, row) => sum + Math.max(0, Number(row.qty) || 0), 0),
      hp: state.hp, sp: state.sp,
    };
  }, setup);
  const sessionId = 'e2e-live-combat-session';
  const attackResult = await attackUntilKilled(mainPage, explorerPage, {
    sessionId, mapId: setup.mapId, defId: setup.defId, spawnKey: 'e2e-melee',
  });
  assert.equal(attackResult.accepted, true);
  assert.equal(attackResult.killed, true);
  assert.ok(attackResult.damageDealt > 0);

  const afterAttack = await readLiveState(mainPage);
  assert.ok(afterAttack.baseLevel > setup.baseLevelBefore, '普攻擊殺後沒有升基礎等級。');
  assert.ok(afterAttack.jobLevel > setup.jobLevelBefore, '普攻擊殺後沒有升職業等級。');
  assert.ok(afterAttack.gold > setup.goldBefore, '普攻擊殺後沒有獲得鋅幣。');
  const lootAfterAttack = itemQty(afterAttack.inventory, setup.dropItemId);
  assert.ok(lootAfterAttack >= lootSetup.lootQtyBefore + 1,
    '普攻擊殺沒有把真實怪物掉落寫進角色背包：' + JSON.stringify({
      item: setup.dropItemId, before: lootSetup.lootQtyBefore, after: lootAfterAttack,
    }));
  assert.deepEqual(afterAttack.monsters, [], '普攻結算後沒有還原主遊戲怪物陣列。');
  assert.equal(afterAttack.monster, null, '普攻結算後沒有還原主遊戲怪物指標。');
  const saveAfterAttack = await mainPage.evaluate(key => JSON.parse(localStorage.getItem(key)), setup.saveSlotKey);
  assert.ok(saveAfterAttack, '普攻擊殺後主遊戲存檔不存在。');
  assertSaveMatches('普攻擊殺後', saveAfterAttack, afterAttack);
  assert.ok(saveAfterAttack.baseLevel > setup.baseLevelBefore);
  assert.ok(saveAfterAttack.jobLevel > setup.jobLevelBefore);
  assert.ok(saveAfterAttack.gold > setup.goldBefore, '普攻獎勵沒有立即同步到存檔。');
  assert.ok(itemQty(saveAfterAttack.inventory, setup.dropItemId) >= lootSetup.lootQtyBefore + 1,
    '普攻掉落沒有立即寫進本機存檔背包。');
  await mainPage.evaluate(() => onTickUI());
  await explorerPage.screenshot({
    path: path.join(artifactDir, 'live-combat-after-melee.png'), animations: 'disabled',
  });

  await sleep(5200);
  const beforeSkill = await readLiveState(mainPage);
  const lootBeforeSkill = itemQty(beforeSkill.inventory, setup.dropItemId);
  const skillResult = await sendCombatCommand(mainPage, explorerPage, {
    type: 'skill',
    sessionId,
    requestId: 'e2e-skill-kill',
    spawnKey: 'e2e-skill',
    mapId: setup.mapId,
    defId: setup.defId,
    skillId: 'bash',
  });
  assert.equal(skillResult.ok, true, '技能命令被主遊戲拒絕：' + JSON.stringify(skillResult));
  assert.equal(skillResult.accepted, true, 'Bash 技能沒有實際施放：' + JSON.stringify(skillResult));
  assert.equal(skillResult.killed, true, 'Bash 技能沒有擊殺目標：' + JSON.stringify(skillResult));
  assert.ok(skillResult.damageDealt > 0);
  assert.ok(skillResult.playerSp < beforeSkill.sp, 'Bash 沒有扣除 SP。');

  const afterSkill = await readLiveState(mainPage);
  assert.ok(afterSkill.gold > beforeSkill.gold, '技能擊殺後沒有獲得鋅幣。');
  const lootAfterSkill = itemQty(afterSkill.inventory, setup.dropItemId);
  assert.ok(lootAfterSkill >= lootBeforeSkill + 1,
    'Bash 擊殺沒有把真實怪物掉落寫進角色背包：' + JSON.stringify({
      item: setup.dropItemId, before: lootBeforeSkill, after: lootAfterSkill,
    }));
  assert.ok(afterSkill.baseLevel > beforeSkill.baseLevel || afterSkill.baseExp !== beforeSkill.baseExp,
    '技能擊殺後基礎經驗沒有變動。');
  assert.ok(afterSkill.jobLevel > beforeSkill.jobLevel || afterSkill.jobExp !== beforeSkill.jobExp,
    '技能擊殺後職業經驗沒有變動。');
  assert.deepEqual(afterSkill.monsters, [], '技能結算後探索怪物滲入主遊戲怪物陣列。');
  assert.equal(afterSkill.monster, null, '技能結算後探索怪物滲入主遊戲怪物指標。');
  const saveAfterSkill = await mainPage.evaluate(key => JSON.parse(localStorage.getItem(key)), setup.saveSlotKey);
  assert.ok(saveAfterSkill, '技能擊殺後主遊戲存檔不存在。');
  assertSaveMatches('技能擊殺後', saveAfterSkill, afterSkill);
  assert.ok(saveAfterSkill.sp < saveAfterAttack.sp, '技能消耗 SP 沒有同步到存檔。');
  assert.ok(saveAfterSkill.gold > saveAfterAttack.gold, '技能擊殺鋅幣沒有同步到存檔。');
  assert.ok(itemQty(saveAfterSkill.inventory, setup.dropItemId) >= lootBeforeSkill + 1,
    'Bash 掉落沒有同步寫入本機存檔背包。');

  await waitForExplorerHud(explorerPage, afterSkill);
  await mainPage.evaluate(() => onTickUI());
  const hudAfterSkill = await mainPage.evaluate(() => ({
    hp: document.getElementById('hud-hp-text')?.textContent || '',
    sp: document.getElementById('hud-sp-text')?.textContent || '',
    baseExp: document.getElementById('hud-bexp-text')?.textContent || '',
    jobExp: document.getElementById('hud-jexp-text')?.textContent || '',
    level: document.getElementById('hud-lv')?.textContent || '',
    gold: document.getElementById('hud-gold')?.textContent || '',
  }));
  const strip = value => String(value).replace(/,/g, '');
  assert.ok(strip(hudAfterSkill.hp).includes(String(afterSkill.hp)), '主遊戲 HUD 的 HP 未跟上實際角色狀態。');
  assert.ok(strip(hudAfterSkill.sp).includes(String(afterSkill.sp)), '主遊戲 HUD 的 SP 未跟上實際角色狀態。');
  assert.ok(strip(hudAfterSkill.baseExp).includes(String(afterSkill.baseExp)), '主遊戲 HUD 的基礎經驗未更新。');
  assert.ok(strip(hudAfterSkill.jobExp).includes(String(afterSkill.jobExp)), '主遊戲 HUD 的職業經驗未更新。');
  assert.ok(strip(hudAfterSkill.level).includes(String(afterSkill.baseLevel)), '主遊戲 HUD 的等級未更新。');
  assert.ok(strip(hudAfterSkill.gold).includes(String(afterSkill.gold)), '主遊戲 HUD 的鋅幣未更新。');
  await explorerPage.screenshot({
    path: path.join(artifactDir, 'live-combat-after-skill.png'), animations: 'disabled',
  });

  // 再從真正主遊戲按鈕開啟同源探索頁，改用手機觸控＋Canvas 2D 走完整 UI 戰鬥與重生。
  await mainPage.evaluate(({ mapId, defId }) => {
    let map = MAPS.find(item => item.id === mapId);
    if (!map) {
      // 前面驗存檔時重新載入了主遊戲；重建僅供此次測試使用的場景別名。
      const sourceField = MAPS.find(item => item.id === 'prt_fild08');
      if (!sourceField || !MONSTERS.poring || !Array.isArray(MONSTERS.poring.drops)) {
        throw new Error('手機戰鬥測試找不到正式波利資料，無法重建 tra_fild 測試佈置。');
      }
      map = {
        id: 'tra_fild', imgId: sourceField.imgId,
        name: '普隆德拉郊外訓練場（測試佈置）',
        monsters: [{ id: 'poring', weight: 1000000000 }],
      };
      MAPS.push(map);
    }
    for (const spawn of map.monsters || []) {
      const def = MONSTERS[spawn.id];
      if (def) def.hp = 5000;
      if (spawn.id === defId) spawn.weight = 1000000000;
    }
    // 載入存檔時未知的原生地圖 ID 可能會被主遊戲正規化；此測試需明確回到 tra_fild。
    state.mapId = mapId;
    state.hp = state.maxHp;
    state.sp = state.maxSp;
    state.cooldowns = {};
    saveGame();
    window.__rooExplorerTestOpenedUrl = null;
    window.open = url => {
      window.__rooExplorerTestOpenedUrl = String(url);
      return null;
    };
  }, setup);
  await mainPage.locator('button[onclick="openRoExplorer()"]').click();
  await mainPage.waitForFunction(() => typeof window.__rooExplorerTestOpenedUrl === 'string'
    && window.__rooExplorerTestOpenedUrl.length > 0, null, { timeout: 5000 });
  const mobileUrl = new URL(await mainPage.evaluate(() => window.__rooExplorerTestOpenedUrl));
  mobileUrl.searchParams.set('roo-2d-test', '1');
  const mobilePage = await context.newPage();
  const mobilePageErrors = [];
  mobilePage.on('pageerror', error => mobilePageErrors.push(String(error)));
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.goto(mobileUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mobilePage.locator('#native-toolbar').waitFor({ state: 'visible', timeout: 30000 });
  await mobilePage.locator('#player-vitals-panel').waitFor({ state: 'visible', timeout: 30000 });
  await mobilePage.waitForFunction(() => {
    const status = document.getElementById('status')?.textContent || '';
    const stats = document.getElementById('stats')?.textContent || '';
    return status.includes('原生地圖已載入') && stats.includes('GAT：tra_fild.gat');
  }, null, { timeout: 150000 });
  await mobilePage.waitForFunction(() => {
    const hook = window.__rooExplorer2DTest;
    return hook && typeof hook.getMetrics === 'function'
      && typeof hook.getMonsterTargets === 'function'
      && typeof hook.canApproachMonster === 'function';
  }, null, { timeout: 30000 });
  const mobileTwoDToggle = mobilePage.locator('#toggle-2d-view');
  assert.ok(await mobileTwoDToggle.isEnabled(), '手機 tra_fild 的純 2D 切換按鈕不可用。');
  await mobileTwoDToggle.tap();
  await mobilePage.waitForFunction(() => {
    const metrics = window.__rooExplorer2DTest?.getMetrics();
    return metrics && metrics.active && metrics.terrainTiles > 0 && metrics.texturedTiles > 0;
  }, null, { timeout: 15000 });

  const tapTargets = await mobilePage.evaluate(() => {
    const hook = window.__rooExplorer2DTest;
    const canvas = document.getElementById('ro-2d-stage');
    const rect = canvas.getBoundingClientRect();
    return hook.getMonsterTargets().map(target => ({
      ...target,
      pageX: rect.left + target.screenX,
      pageY: rect.top + target.screenY,
      hitCanvas: document.elementFromPoint(rect.left + target.screenX, rect.top + target.screenY) === canvas,
      reachable: hook.canApproachMonster(target.spawnKey),
    })).filter(target => !target.dead && target.distance > 1 && target.hitCanvas && target.reachable
      && target.pageX >= 0 && target.pageY >= 0
      && target.pageX < window.innerWidth && target.pageY < window.innerHeight)
      .sort((a, b) => b.distance - a.distance);
  });
  const mobileTarget = tapTargets.find(target => target.monsterId === setup.defId) || tapTargets[0];
  assert.ok(mobileTarget,
    '手機 2D 找不到能從畫面實際觸控且可尋路接近的怪物：'
      + JSON.stringify(await mobilePage.evaluate(() => ({
        targets: window.__rooExplorer2DTest?.getMonsterTargets?.(),
        viewport: { width: innerWidth, height: innerHeight },
      }))));
  await mobilePage.touchscreen.tap(mobileTarget.pageX, mobileTarget.pageY);
  await mobilePage.locator('#monster-panel').waitFor({ state: 'visible', timeout: 5000 });
  await mobilePage.waitForFunction(name =>
    (document.getElementById('monster-title')?.textContent || '').includes(name),
  mobileTarget.name, { timeout: 5000 });
  assert.ok((await mobilePage.locator('#status').innerText()).includes('已選取'),
    '手機觸控沒有真正選取地圖中的怪物。');
  const mobileSpawnKey = mobileTarget.spawnKey;
  const mobileBaseKey = mobileTarget.spawnBaseKey;
  await mobilePage.locator('#attack-monster').tap();
  await mobilePage.waitForFunction(key => {
    const status = document.getElementById('status')?.textContent || '';
    const target = window.__rooExplorer2DTest?.getMonsterTargets?.()
      .find(item => item.spawnKey === key);
    return (status.includes('正接近') || status.includes('已進入普攻距離') || (target && target.distance <= 1))
      && target;
  }, mobileSpawnKey, { timeout: 7000 });
  await mobilePage.waitForFunction(key => {
    const target = window.__rooExplorer2DTest?.getMonsterTargets?.()
      .find(item => item.spawnKey === key);
    return target && target.distance <= 1;
  }, mobileSpawnKey, { timeout: 30000 });
  await mobilePage.waitForFunction(key => {
    const target = window.__rooExplorer2DTest?.getMonsterTargets?.()
      .find(item => item.spawnKey === key);
    return target && target.currentHp < target.maxHp;
  }, mobileSpawnKey, { timeout: 20000 });
  await mobilePage.locator('#stop-monster-attack').tap();
  await mobilePage.waitForFunction(() => document.getElementById('stop-monster-attack')?.hidden === true,
    null, { timeout: 5000 });

  const beforeMobileSkill = await mainPage.evaluate(() => ({ sp: state.sp }));
  const mobileHpBeforeSkill = await mobilePage.evaluate(key =>
    window.__rooExplorer2DTest.getMonsterTargets().find(item => item.spawnKey === key)?.currentHp,
  mobileSpawnKey);
  await mobilePage.locator('#monster-skill').selectOption('bash');
  await mobilePage.waitForFunction(() => {
    const skill = document.getElementById('monster-skill');
    const button = document.getElementById('cast-monster-skill');
    return skill && skill.value === 'bash' && button && !button.disabled;
  }, null, { timeout: 5000 });
  await mobilePage.locator('#cast-monster-skill').tap();
  await mainPage.waitForFunction(before => state.sp < before,
    beforeMobileSkill.sp, { timeout: 12000 });
  await mobilePage.waitForFunction(({ key, hp }) => {
    const target = window.__rooExplorer2DTest?.getMonsterTargets?.()
      .find(item => item.spawnKey === key);
    return target && target.currentHp < hp;
  }, { key: mobileSpawnKey, hp: mobileHpBeforeSkill }, { timeout: 12000 });
  await mobilePage.waitForFunction(beforeSp => {
    const text = document.getElementById('player-sp-value')?.textContent || '';
    const current = Number(text.split('/')[0].replace(/[^0-9]/g, ''));
    return Number.isFinite(current) && current < beforeSp;
  }, beforeMobileSkill.sp, { timeout: 15000 });
  const mobileAfterSkill = await mobilePage.evaluate(key => {
    const target = window.__rooExplorer2DTest.getMonsterTargets().find(item => item.spawnKey === key);
    const metrics = window.__rooExplorer2DTest.getMetrics();
    return { targetHp: target && target.currentHp, sp: document.getElementById('player-sp-value')?.textContent || '',
      canvasActive: metrics.active, webglHidden: metrics.rendererCanvasHidden };
  }, mobileSpawnKey);
  assert.ok(mobileAfterSkill.targetHp < mobileHpBeforeSkill,
    '手機 2D 的 Bash 沒有讓實際選取怪物扣血：' + JSON.stringify(mobileAfterSkill));
  assert.equal(mobileAfterSkill.canvasActive, true);
  assert.equal(mobileAfterSkill.webglHidden, true, '手機純 2D 戰鬥時 WebGL 畫布不應顯示。');

  // 同一隻真實怪物由手機 UI 繼續普攻至死亡，再實測重生與滿血復原。
  const currentMobileTarget = await mobilePage.evaluate(key =>
    window.__rooExplorer2DTest.getMonsterTargets().find(item => item.spawnKey === key),
  mobileSpawnKey);
  if (currentMobileTarget && !currentMobileTarget.dead) await mobilePage.locator('#attack-monster').tap();
  await mobilePage.waitForFunction(key => {
    const target = window.__rooExplorer2DTest?.getMonsterTargets?.()
      .find(item => item.spawnKey === key);
    return target && target.dead && target.currentHp === 0;
  }, mobileSpawnKey, { timeout: 60000 });
  await mobilePage.waitForFunction(({ baseKey, oldKey }) => {
    const target = window.__rooExplorer2DTest?.getMonsterTargets?.()
      .find(item => item.spawnBaseKey === baseKey);
    return target && !target.dead && target.spawnKey !== oldKey
      && target.respawnCount >= 1 && target.currentHp === target.maxHp;
  }, { baseKey: mobileBaseKey, oldKey: mobileSpawnKey }, { timeout: 20000 });
  await mobilePage.screenshot({
    path: path.join(artifactDir, 'mobile-2d-live-combat-respawn.png'),
    fullPage: true, animations: 'disabled',
  });
  assert.deepEqual(mobilePageErrors, [],
    '手機純 2D 戰鬥產生未處理的 JavaScript 錯誤：' + mobilePageErrors.join(' | '));
  console.log('手機純 2D 真實 UI 戰鬥通過：觸控選怪、GAT/A* 靠近、普攻扣怪物 HP、Bash 扣 HP/SP、擊殺、等待重生與 HP 復原。');

  await explorerPage.close();
  await mainPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  // Verify persisted bytes before continueGame can apply legitimate idle regeneration.
  const persistedBeforeContinue = await mainPage.evaluate(
    key => JSON.parse(localStorage.getItem(key)), setup.saveSlotKey
  );
  assert.ok(persistedBeforeContinue, '重新整理後找不到角色存檔。');
  assertSaveMatches('重新整理後讀取前', saveAfterSkill, persistedBeforeContinue);
  for (const key of ['hp', 'maxHp', 'sp', 'maxSp', 'baseLevel', 'baseExp', 'jobLevel', 'jobExp', 'gold']) {
    assert.equal(persistedBeforeContinue[key], saveAfterSkill[key],
      '重新整理後原始存檔欄位 ' + key + ' 不一致。');
  }
  await mainPage.locator('button[onclick="showSlotSelect()"]').click();
  await mainPage.locator('.has-save').first().click();
  await mainPage.locator('#screen-game.active').waitFor({ state: 'visible', timeout: 15000 });
  await mainPage.evaluate(() => {
    stopLoop();
    onTickUI();
  });
  const reloaded = await readLiveState(mainPage);
  assert.equal(reloaded.mapId, persistedBeforeContinue.mapId, '重新讀取後地圖識別碼不一致。');
  assert.ok(reloaded.baseLevel >= persistedBeforeContinue.baseLevel,
    '重新讀取後基礎等級低於存檔；離線結算不應扣回等級。');
  assert.ok(reloaded.jobLevel >= persistedBeforeContinue.jobLevel,
    '重新讀取後職業等級低於存檔；離線結算不應扣回等級。');
  assert.ok(reloaded.gold >= persistedBeforeContinue.gold,
    '重新讀取後鋅幣低於存檔；正常離線結算不應扣除未消費的鋅幣。');
  assert.ok(reloaded.hp >= 0 && reloaded.hp <= reloaded.maxHp,
    '重新讀取後 HP 超出合法範圍。');
  assert.ok(reloaded.sp >= 0 && reloaded.sp <= reloaded.maxSp,
    '重新讀取後 SP 超出合法範圍。');
  assert.ok(Array.isArray(reloaded.monsters), '重新讀取後怪物陣列格式無效。');
  assert.equal(reloaded.monsters.some(monster => monster && monster.id <= -1000000000), false,
    '重新讀取後角色存檔混入探索預覽用的負數怪物 ID。');
  assert.ok(reloaded.monster === null || reloaded.monsters.includes(reloaded.monster),
    '重新讀取後單一怪物指標與正式怪物陣列不一致。');
  assert.deepEqual(mainPageErrors, [], '主遊戲產生未處理的 JavaScript 錯誤：' + mainPageErrors.join(' | '));

  console.log('tra_fild 戰鬥端到端驗收通過：真實反擊扣 HP、普攻／Bash 實際掉落進背包與存檔、基礎／職業經驗與鋅幣、存檔重讀，以及手機純 2D 觸控戰鬥／怪物重生。');
} catch (error) {
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
