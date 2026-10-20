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
    monsters: state.monsters,
    monster: state.monster,
  }));
}

function assertSaveMatches(label, saved, live) {
  for (const key of ['mapId', 'hp', 'maxHp', 'sp', 'maxSp', 'baseLevel', 'baseExp', 'jobLevel', 'jobExp', 'gold']) {
    assert.equal(saved[key], live[key], label + ' 存檔欄位 ' + key + ' 與實際角色狀態不同。');
  }
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
    const regionMapIds = new Set((REGIONS || []).flatMap(region => region.maps || []));
    const preferred = ['tra_fild', 'prt_fild08', 'prt_fild05', 'pay_fild04',
      'gef_fild07', 'moc_fild03', 'pay_fild01', 'prt_fild02'];
    const orderedMaps = [];
    for (const id of preferred) {
      const map = MAPS.find(item => item.id === id);
      if (map && !orderedMaps.includes(map) && regionMapIds.has(map.id)) orderedMaps.push(map);
    }
    for (const map of MAPS) {
      if (regionMapIds.has(map.id) && Array.isArray(map.monsters) && map.monsters.length
        && !orderedMaps.includes(map)) orderedMaps.push(map);
    }
    const chooseTarget = map => (map.monsters || [])
      .map(spawn => ({ spawn, def: MONSTERS[spawn.id] }))
      .filter(item => item.def && Number.isFinite(item.def.hp) && item.def.hp > 0
        && Number.isFinite(item.def.exp) && Math.round(item.def.exp) > 0
        && Number.isFinite(item.def.jobExp) && Math.round(item.def.jobExp) > 0
        && Number.isInteger(item.def.imgId))
      .sort((a, b) => a.def.hp - b.def.hp)[0];
    const plans = orderedMaps.map(map => ({ map, target: chooseTarget(map) }))
      .filter(plan => plan.target);
    const plan = plans.find(item => item.target.def.hp <= 200) || plans[0];
    if (!plan) throw new Error('找不到同時具有地圖、怪物圖片與經驗獎勵的有效地圖。');

    state.name = 'ROO戰鬥存檔驗收';
    state.mapId = plan.map.id;
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
      const region = regionOf(plan.map.id);
      if (region) selectedRegionId = region.id;
    }
    if (typeof activeTab !== 'undefined') activeTab = 'map';
    renderAll();
    saveGame();
    stopLoop();
    Math.random = () => 0;
    return {
      mapId: plan.map.id,
      defId: plan.target.spawn.id,
      monsterName: plan.target.def.name,
      monsterHp: plan.target.def.hp,
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
  assert.ok(setup.monsterHp <= 200 || setup.monsterHp < 1000,
    '測試目標 HP 太高，無法穩定驗證擊殺：' + JSON.stringify(setup));
  assert.equal(await mainPage.locator('#screen-game').evaluate(el => el.classList.contains('active')), true);
  await mainPage.locator('button[onclick="openRoExplorer()"]').waitFor({ state: 'visible', timeout: 10000 });
  const popupPromise = context.waitForEvent('page');
  await mainPage.locator('button[onclick="openRoExplorer()"]').click();
  const explorerPage = await popupPromise;
  await explorerPage.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await explorerPage.locator('#player-vitals-panel').waitFor({ state: 'visible', timeout: 15000 });
  const openedUrl = new URL(explorerPage.url());
  assert.equal(openedUrl.searchParams.get('mode'), 'native');
  assert.equal(openedUrl.searchParams.get('map'), setup.mapId);
  assert.ok(JSON.parse(openedUrl.searchParams.get('mobs') || '[]').some(mob => mob.id === setup.defId),
    '主遊戲開啟探索時沒有傳入實際目標怪物。');
  assert.ok(JSON.parse(openedUrl.searchParams.get('skills') || '[]').some(skill => skill.id === 'bash'),
    '主遊戲開啟探索時沒有傳入已學的 Bash 技能。');

  const sessionId = 'e2e-live-combat-session';
  await sleep(5200);
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
  assert.deepEqual(afterAttack.monsters, [], '普攻結算後沒有還原主遊戲怪物陣列。');
  assert.equal(afterAttack.monster, null, '普攻結算後沒有還原主遊戲怪物指標。');
  const saveAfterAttack = await mainPage.evaluate(key => JSON.parse(localStorage.getItem(key)), setup.saveSlotKey);
  assert.ok(saveAfterAttack, '普攻擊殺後主遊戲存檔不存在。');
  assertSaveMatches('普攻擊殺後', saveAfterAttack, afterAttack);
  assert.ok(saveAfterAttack.baseLevel > setup.baseLevelBefore);
  assert.ok(saveAfterAttack.jobLevel > setup.jobLevelBefore);
  assert.ok(saveAfterAttack.gold > setup.goldBefore, '普攻獎勵沒有立即同步到存檔。');
  await mainPage.evaluate(() => onTickUI());
  await explorerPage.screenshot({
    path: path.join(artifactDir, 'live-combat-after-melee.png'), animations: 'disabled',
  });

  await sleep(5200);
  const beforeSkill = await readLiveState(mainPage);
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

  await explorerPage.close();
  await mainPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await mainPage.locator('button[onclick="showSlotSelect()"]').click();
  await mainPage.locator('.has-save').first().click();
  await mainPage.locator('#screen-game.active').waitFor({ state: 'visible', timeout: 15000 });
  await mainPage.evaluate(() => {
    stopLoop();
    onTickUI();
  });
  const reloaded = await readLiveState(mainPage);
  for (const key of ['mapId', 'hp', 'maxHp', 'sp', 'maxSp', 'baseLevel', 'baseExp', 'jobLevel', 'jobExp', 'gold']) {
    assert.equal(reloaded[key], saveAfterSkill[key], '重新讀取存檔後欄位 ' + key + ' 不一致。');
  }
  assert.deepEqual(reloaded.monsters, saveAfterSkill.monsters);
  assert.deepEqual(reloaded.monster, saveAfterSkill.monster);
  assert.deepEqual(mainPageErrors, [], '主遊戲產生未處理的 JavaScript 錯誤：' + mainPageErrors.join(' | '));

  console.log('主遊戲 ↔ 原生探索端到端驗收通過：實際開啟探索頁、普攻擊殺與 Bash 擊殺、HP/SP／基礎與職業經驗／鋅幣、兩次存檔一致性、無探索怪物污染與重新載入續玩。');
} catch (error) {
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
