import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = process.env.ROO_BROWSER_ARTIFACT_DIR || path.join(root, 'artifacts', 'explorer-browser');
const baseUrl = process.env.ROO_BROWSER_BASE_URL || 'http://127.0.0.1:8765';
const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
let browser;
let page;
const pageErrors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(baseUrl + '/tools/ro_explorer.html');
      if (response.ok) return;
    } catch (error) {}
    await sleep(250);
  }
  throw new Error('本機靜態測試伺服器未能啟動。');
}

async function assertNoHorizontalOverflow(targetPage, label) {
  const sizes = await targetPage.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    toolbarClient: document.getElementById('native-toolbar').clientWidth,
    toolbarScroll: document.getElementById('native-toolbar').scrollWidth,
    stageClient: document.getElementById('stage').clientWidth,
    canvasWidth: document.querySelector('#stage canvas')?.getBoundingClientRect().width || 0,
  }));
  assert.ok(sizes.page <= sizes.viewport + 1,
    label + ' 頁面出現水平溢出：' + JSON.stringify(sizes));
  assert.ok(sizes.toolbarScroll <= sizes.toolbarClient + 1,
    label + ' 原生工具列內容超出容器：' + JSON.stringify(sizes));
  assert.ok(sizes.canvasWidth > 0 && sizes.canvasWidth <= sizes.stageClient + 1,
    label + ' 3D 畫布尺寸不正確：' + JSON.stringify(sizes));
}

async function minimapTargets(targetPage) {
  return targetPage.evaluate(() => {
    const stats = document.getElementById('stats')?.textContent || '';
    const dimensions = stats.match(/尺寸\s*(\d+)\s*[×x]\s*(\d+)/);
    const current = stats.match(/目前格：\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
    const canvas = document.getElementById('minimap');
    if (!dimensions || !current || !canvas || !canvas.width || !canvas.height) return [];
    const mapWidth = Number(dimensions[1]);
    const mapHeight = Number(dimensions[2]);
    const cx = Number(current[1]);
    const cy = Number(current[2]);
    const context = canvas.getContext('2d');
    if (!context) return [];
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const candidates = [];
    for (let radius = 3; radius <= 32; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) continue;
          const px = Math.max(0, Math.min(canvas.width - 1,
            Math.floor((x + 0.5) * canvas.width / mapWidth)));
          const py = Math.max(0, Math.min(canvas.height - 1,
            Math.floor((y + 0.5) * canvas.height / mapHeight)));
          const i = (py * canvas.width + px) * 4;
          if (pixels[i] === 62 && pixels[i + 1] === 119 && pixels[i + 2] === 77) {
            candidates.push({ x, y, mapWidth, mapHeight, radius });
          }
        }
      }
      if (candidates.length >= 80) break;
    }
    return candidates.slice(0, 80);
  });
}

async function clickMinimapUntilMoving(targetPage, useTouch, label) {
  const candidates = await minimapTargets(targetPage);
  assert.ok(candidates.length, label + ' 小地圖附近找不到可走地面像素。');
  const canvas = targetPage.locator('#minimap');
  const box = await canvas.boundingBox();
  assert.ok(box, label + ' 小地圖沒有可點擊的畫面區域。');
  await targetPage.evaluate(() => {
    const slider = document.getElementById('move-speed');
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let moved = false;
  const attempted = [];
  const stopButton = targetPage.locator('#stop-movement');
  for (const cell of candidates) {
    const x = box.x + ((cell.x + 0.5) / cell.mapWidth) * box.width;
    const y = box.y + ((cell.y + 0.5) / cell.mapHeight) * box.height;
    try {
      if (useTouch) await targetPage.touchscreen.tap(x, y);
      else await targetPage.mouse.click(x, y);
      if (await stopButton.isVisible()) {
        moved = true;
        break;
      }
      attempted.push({ x: cell.x, y: cell.y, radius: cell.radius,
        status: (await targetPage.locator('#status').innerText()).slice(0, 90) });
    } catch (error) {
      attempted.push({ x: cell.x, y: cell.y, error: String(error).slice(0, 90) });
    }
  }
  assert.ok(moved, label + ' 點擊小地圖沒有建立可停止的移動路徑；嘗試 ' + JSON.stringify(attempted.slice(-8)));
  const stopBox = await stopButton.boundingBox();
  assert.ok(stopBox, label + ' 移動按鈕顯示但沒有可點擊位置。');
  if (useTouch) {
    await targetPage.touchscreen.tap(stopBox.x + stopBox.width / 2, stopBox.y + stopBox.height / 2);
  } else {
    await targetPage.locator('#stop-movement').click();
  }
  await targetPage.locator('#stop-movement').waitFor({ state: 'hidden', timeout: 3000 });
}

async function run() {
  await mkdir(artifactDir, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl',
      '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: true,
  });
  await context.addInitScript(() => {
    window.addEventListener('storage', event => {
      if (!event || event.key !== 'roo_explorer_combat_command' || !event.newValue) return;
      let command;
      try { command = JSON.parse(event.newValue); } catch (error) { return; }
      if (!command || command.type !== 'vitals' || !command.sessionId || !command.requestId) return;
      const result = {
        requestId: command.requestId,
        requestType: command.type,
        spawnKey: command.spawnKey,
        ok: true,
        accepted: true,
        playerHp: 640,
        playerMaxHp: 1000,
        playerSp: 90,
        playerMaxSp: 200,
        playerBaseLevel: 18,
        playerBaseExp: 2000,
        playerBaseExpNeed: 10000,
        playerJobLevel: 13,
        playerJobExp: 750,
        playerJobExpNeed: 5000,
        playerZeny: 1239999,
      };
      try {
        localStorage.setItem('roo_explorer_combat_result_' + command.sessionId, JSON.stringify(result));
      } catch (error) {}
    });
  });
  // This page stands in for the already-open game tab and exercises the real same-origin storage bridge.
  const bridgePage = await context.newPage();
  await bridgePage.route('https://visuais.latam-tools.com.br/**', route => route.abort());
  await bridgePage.goto(baseUrl + '/tools/ro_explorer.html?mode=public', { waitUntil: 'domcontentloaded' });

  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route('https://visuais.latam-tools.com.br/**', route => route.abort());
  const params = new URLSearchParams({
    mode: 'native',
    map: 'tra_fild',
    sprite: 'swordsman_male',
    php: '800',
    pmaxhp: '1000',
    psp: '120',
    pmaxsp: '200',
    pbaselevel: '17',
    pbaseexp: '1234',
    pbaseexpneed: '10000',
    pjoblevel: '12',
    pjobexp: '432',
    pjobexpneed: '5000',
    pzeny: '1234567',
  });
  await page.goto(baseUrl + '/tools/ro_explorer.html?' + params.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.locator('#native-toolbar').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#player-vitals-panel').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => {
    const text = document.getElementById('status')?.textContent || '';
    return text.includes('原生地圖已載入') || text.includes('公開原生地圖載入失敗');
  }, null, { timeout: 150000 });
  const mapStatus = await page.locator('#status').innerText();
  assert.ok(mapStatus.includes('原生地圖已載入'), '原生地圖沒有成功顯示：' + mapStatus);
  await sleep(500);
  const sceneReadiness = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent || '',
    stats: document.getElementById('stats')?.textContent || '',
    showMinimapChecked: !!document.getElementById('show-minimap')?.checked,
    minimapHidden: !!document.getElementById('minimap-panel')?.hidden,
    nativeModeHidden: !!document.getElementById('local-mode')?.hidden,
    stage: (() => { const r = document.getElementById('stage').getBoundingClientRect(); return { width: r.width, height: r.height }; })(),
  }));
  console.log('原生場景初始化診斷：' + JSON.stringify(sceneReadiness));
  assert.ok(!sceneReadiness.minimapHidden, '地圖顯示成功但小地圖仍隱藏：' + JSON.stringify(sceneReadiness));
  await page.waitForFunction(() => {
    const text = document.getElementById('stats')?.textContent || '';
    return text.includes('GAT：tra_fild') && text.includes('目前格：') && text.includes('角色素材：');
  }, null, { timeout: 15000 });

  await page.waitForFunction(() => document.getElementById('player-base-level')?.textContent === '基礎 Lv. 18',
    null, { timeout: 7000 });
  assert.equal(await page.locator('#player-base-exp-value').innerText(), '2,000 / 10,000');
  assert.equal(await page.locator('#player-job-level').innerText(), '職業 Lv. 13');
  assert.equal(await page.locator('#player-job-exp-value').innerText(), '750 / 5,000');
  assert.equal(await page.locator('#player-zeny-value').innerText(), '鋅幣 1,239,999z');
  assert.equal(await page.locator('#player-hp-value').innerText(), '640 / 1,000');
  assert.equal(await page.locator('#player-sp-value').innerText(), '90 / 200');

  await assertNoHorizontalOverflow(page, '桌面');
  await page.screenshot({ path: path.join(artifactDir, 'desktop.png'), fullPage: true, animations: 'disabled' });
  await clickMinimapUntilMoving(page, false, '桌面');
  await page.locator('#follow-player').uncheck();
  assert.ok((await page.locator('#status').innerText()).includes('自由視角'));
  await page.locator('#follow-player').check();
  assert.ok((await page.locator('#status').innerText()).includes('跟隨角色'));
  await page.locator('#show-cells').check();
  assert.ok((await page.locator('#status').innerText()).includes('顯示通行格'));
  await page.locator('#show-cells').uncheck();
  await page.locator('#recenter').click();
  assert.ok((await page.locator('#status').innerText()).includes('已重置視角'));

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(350);
  await assertNoHorizontalOverflow(page, '手機');
  await clickMinimapUntilMoving(page, true, '手機觸控');
  // Force a representative selected-monster state to verify the overlay layout on a narrow screen.
  await page.evaluate(() => {
    const status = document.getElementById('status');
    status.textContent = '已選取波利。可按「靠近並自動普攻」，或選擇已學主動技能施放。';
    const panel = document.getElementById('monster-panel');
    document.getElementById('monster-title').textContent = '波利 Lv. 1';
    document.getElementById('monster-description').textContent = 'ATK 10\n可普攻，或選擇已學主動技能施放。';
    panel.hidden = false;
  });
  const boxes = await page.evaluate(() => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      status: rect(document.getElementById('status')),
      monster: rect(document.getElementById('monster-panel')),
    };
  });
  assert.ok(boxes.status.bottom <= boxes.monster.top || boxes.status.right <= boxes.monster.left
    || boxes.monster.right <= boxes.status.left,
    '手機版狀態提示與怪物面板重疊：' + JSON.stringify(boxes));
  await page.screenshot({ path: path.join(artifactDir, 'mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(pageErrors, [], '瀏覽器出現未處理的 JavaScript 錯誤：' + pageErrors.join(' | '));
  console.log('原生探索瀏覽器驗收通過：公開 tra_fild 3D 地圖、角色素材狀態、HP/SP、基礎／職業經驗、鋅幣、桌面與手機版面、小地圖移動／停止、視角跟隨、通行格切換。');
  console.log('桌面與手機截圖：' + artifactDir);
}

try {
  await run();
} catch (error) {
  if (page) {
    try {
      await page.screenshot({ path: path.join(artifactDir, 'failure.png'), fullPage: true, animations: 'disabled' });
    } catch (screenshotError) {}
  }
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
