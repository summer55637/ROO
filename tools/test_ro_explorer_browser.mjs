import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
  await targetPage.evaluate(() => {
    window.__rooMinimapAcceptanceClicks = { count: 0, last: null };
    const canvas = document.getElementById('minimap');
    canvas.addEventListener('click', event => {
      window.__rooMinimapAcceptanceClicks.count++;
      window.__rooMinimapAcceptanceClicks.last = { clientX: event.clientX, clientY: event.clientY };
    }, true);
  });
  const candidates = await minimapTargets(targetPage);
  assert.ok(candidates.length, label + ' 小地圖附近找不到可走地面像素。');
  const canvas = targetPage.locator('#minimap');
  const box = await canvas.boundingBox();
  assert.ok(box, label + ' 小地圖沒有可點擊的畫面區域。');
  const viewport = await targetPage.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY }));
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    label + ' 小地圖超出瀏覽器可見範圍：' + JSON.stringify({ box, viewport }));
  await targetPage.evaluate(() => {
    const slider = document.getElementById('move-speed');
    slider.value = '1';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let moved = false;
  const attempted = [];
  const minimap = targetPage.locator('#minimap');
  const stopButton = targetPage.locator('#stop-movement');
  for (const cell of candidates) {
    const localX = ((cell.x + 0.5) / cell.mapWidth) * box.width;
    const localY = ((cell.y + 0.5) / cell.mapHeight) * box.height;
    const x = box.x + localX;
    const y = box.y + localY;
    const hitTarget = await targetPage.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element ? { tag: element.tagName, id: element.id, className: String(element.className || '') } : null;
    }, { x, y });
    if (!hitTarget || hitTarget.id !== 'minimap') {
      attempted.push({ cellX: cell.x, cellY: cell.y, radius: cell.radius,
        hitTarget, blocked: true });
      break;
    }
    try {
      const clicksBefore = await targetPage.evaluate(() => window.__rooMinimapAcceptanceClicks.count);
      if (useTouch) await minimap.tap({ position: { x: localX, y: localY }, timeout: 700 });
      else await minimap.click({ position: { x: localX, y: localY }, timeout: 700 });
      const clickInfo = await targetPage.evaluate(() => window.__rooMinimapAcceptanceClicks);
      if (await stopButton.isVisible()) {
        moved = true;
        break;
      }
      attempted.push({ cellX: cell.x, cellY: cell.y, radius: cell.radius,
        eventReachedCanvas: clickInfo.count > clicksBefore, lastClick: clickInfo.last, hitTarget,
        status: (await targetPage.locator('#status').innerText()).slice(0, 90) });
    } catch (error) {
      attempted.push({ cellX: cell.x, cellY: cell.y, radius: cell.radius,
        hitTarget, error: String(error).slice(0, 240) });
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

const GND_DEBUG_SCREENSHOT_MODES = [
  // Find one valid visible ground point first, then sample every shader mode at it.
  { value: '7', label: '純 Diffuse 貼圖', file: 'diffuse-only' },
  { value: '8', label: '純頂點色 RGB', file: 'vertex-color-only' },
  { value: '1', label: '貼圖＋頂點色', file: 'diffuse-vertex' },
  { value: '2', label: 'RGB 光照圖', file: 'rgb-lightmap' },
  { value: '3', label: 'AO／陰影圖', file: 'ao-shadow' },
  { value: '4', label: 'RSW 方向光', file: 'rsw-light' },
  { value: '5', label: '貼圖×AO', file: 'diffuse-times-ao' },
  { value: '6', label: '貼圖×方向光', file: 'diffuse-times-rsw' },
];

async function captureGndDebugViews(targetPage, stageBox, mapSlug, options = {}) {
  const selector = targetPage.locator('#gnd-debug-mode');
  await selector.waitFor({ state: 'visible', timeout: 5000 });
  const sampledPixels = {};
  let groundProbe = null;
  let sourceLightmapProbe = null;
  for (const mode of GND_DEBUG_SCREENSHOT_MODES) {
    await selector.selectOption(mode.value);
    await sleep(220);
    const status = await targetPage.locator('#status').innerText();
    assert.ok(status.includes('GND 診斷模式：' + mode.label),
      mapSlug + ' 未切換到 GND 診斷模式：' + mode.label + '；' + status);
    if (mode.value !== '0') {
      const box = await targetPage.locator('#stage').boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, mapSlug + ' 缺少有效地表檢視範圍。');
      const inspector = targetPage.locator('#gnd-surface-inspector-content');
      await targetPage.locator('#gnd-surface-inspector').waitFor({ state: 'visible', timeout: 5000 });
      const inspectorStyle = await targetPage.locator('#gnd-surface-inspector').evaluate(el => ({
        pointerEvents: getComputedStyle(el).pointerEvents,
        overflowY: getComputedStyle(el).overflowY,
      }));
      assert.equal(inspectorStyle.pointerEvents, 'auto',
        mapSlug + ' 地表診斷面板需要接收滾輪／觸控，才能查看完整取樣。');
      assert.equal(inspectorStyle.overflowY, 'auto',
        mapSlug + ' 地表診斷面板必須能在自身區域捲動。');

      if (mode.value === '7') {
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const offsets = [
          [0, 0], [-0.10 * box.width, 0], [0.10 * box.width, 0],
          [0, -0.12 * box.height], [0, 0.12 * box.height],
          [-0.18 * box.width, -0.12 * box.height], [0.18 * box.width, -0.12 * box.height],
          [-0.18 * box.width, 0.12 * box.height], [0.18 * box.width, 0.12 * box.height],
          [-0.24 * box.width, 0], [0.24 * box.width, 0],
          [0, -0.22 * box.height], [0, 0.22 * box.height],
          [-0.28 * box.width, -0.18 * box.height], [0.28 * box.width, -0.18 * box.height],
          [-0.28 * box.width, 0.18 * box.height], [0.28 * box.width, 0.18 * box.height],
        ];
        if (options.requireNonzeroLightmap) {
          offsets.push(
            [-0.32 * box.width, -0.28 * box.height], [-0.16 * box.width, -0.28 * box.height],
            [0, -0.28 * box.height], [0.16 * box.width, -0.28 * box.height],
            [0.32 * box.width, -0.28 * box.height],
            [-0.32 * box.width, -0.14 * box.height], [-0.16 * box.width, -0.14 * box.height],
            [0, -0.14 * box.height], [0.16 * box.width, -0.14 * box.height],
            [0.32 * box.width, -0.14 * box.height],
            [-0.32 * box.width, 0], [0.32 * box.width, 0],
            [-0.32 * box.width, 0.14 * box.height], [-0.16 * box.width, 0.14 * box.height],
            [0, 0.14 * box.height], [0.16 * box.width, 0.14 * box.height],
            [0.32 * box.width, 0.14 * box.height],
            [-0.32 * box.width, 0.28 * box.height], [-0.16 * box.width, 0.28 * box.height],
            [0, 0.28 * box.height], [0.16 * box.width, 0.28 * box.height],
            [0.32 * box.width, 0.28 * box.height],
          );
        }
        let foundVisibleGround = false;
        for (const [dx, dy] of offsets) {
          const point = {
            x: Math.max(box.x + 8, Math.min(box.x + box.width - 8, centerX + dx)),
            y: Math.max(box.y + 8, Math.min(box.y + box.height - 8, centerY + dy)),
          };
          await targetPage.mouse.move(point.x, point.y);
          await sleep(70);
          let diagnosticText = await inspector.innerText();
          if (!diagnosticText.includes('Surface #')) continue;
          try {
            await targetPage.waitForFunction(() => {
              const text = document.getElementById('gnd-surface-inspector-content')?.textContent || '';
              return text.includes('目前診斷模式：7／純 Diffuse 貼圖')
                && text.includes('真實材質路徑') && text.includes('原始四角 UV')
                && text.includes('原始 RGB lightmap / AO 四角取樣')
                && text.includes('相鄰 TOP surface 對照')
                && text.includes('Diffuse 貼圖採樣：mipmap=on')
                && text.includes('Diffuse 貼圖採樣：mipmap=on; min=mipmap filter (')
                && text.includes('RGB lightmap/AO 採樣：mipmap=off')
                && /Diffuse 貼圖採樣：mipmap=on; .*colorSpace=NoColorSpace/.test(text)
                && /RGB lightmap\/AO 採樣：mipmap=off; .*colorSpace=NoColorSpace/.test(text)
            && text.includes('游標處插值頂點色 RGB：')
            && text.includes('游標處 Lightmap atlas UV2：')
            && text.includes('游標處來源 RGB lightmap / AO 最近像素（原始 GND bytes）：RGB (')
                && /GPU 最終畫面取樣 RGBA：\(\d+,\s*\d+,\s*\d+,\s*\d+\)/.test(text);
            }, null, { timeout: 1600 });
          } catch (error) {
            continue;
          }
          diagnosticText = await inspector.innerText();
          const pixelMatch = diagnosticText.match(/GPU 最終畫面取樣 RGBA：\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
          if (!pixelMatch) continue;
          if (options.requireNonzeroLightmap) {
            const sourceMatch = diagnosticText.match(
              /游標處來源 RGB lightmap \/ AO 最近像素（原始 GND bytes）：RGB \((\d+),\s*(\d+),\s*(\d+)\); AO \d+/
            );
            const sourceRgb = sourceMatch ? sourceMatch.slice(1, 4).map(Number) : null;
            const posterizedRgb = sourceRgb && sourceRgb.map(value => Math.floor(value / 16) * 16);
            const surfaceMatch = diagnosticText.match(/Surface #(\d+)/);
            const lightmapMatch = diagnosticText.match(/材質索引：-?\d+；lightmap 索引：(\d+)/);
            const uvMatch = diagnosticText.match(/游標處 Lightmap atlas UV2：\(([^)]+)\)/);
            const atlasUv = uvMatch ? uvMatch[1].split(',').map(value => Number(value.trim())) : null;
            if (!sourceRgb || Math.max(...posterizedRgb) < 32
              || !surfaceMatch || !lightmapMatch || !atlasUv || atlasUv.length !== 2
              || !atlasUv.every(Number.isFinite)) continue;
            sourceLightmapProbe = {
              surfaceIndex: Number(surfaceMatch[1]),
              lightmapIndex: Number(lightmapMatch[1]),
              atlasUv,
              sourceRgb,
              posterizedRgb,
            };
          }
          if (!/(?:SW|SE|NW|NE): RGB \(\d+, \d+, \d+\); AO \d+/.test(diagnosticText)) continue;
          const scrollMetrics = await targetPage.locator('#gnd-surface-inspector').evaluate(el => ({
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          }));
          assert.ok(scrollMetrics.scrollHeight > scrollMetrics.clientHeight,
            mapSlug + ' 地表取樣內容超出視窗時必須提供面板內捲動。');
          groundProbe = point;
          sampledPixels['7'] = pixelMatch.slice(1, 4).join(',');
          foundVisibleGround = true;
          break;
        }
        assert.ok(foundVisibleGround,
          mapSlug + ' 找不到未被前景模型遮住且可讀取 GPU 像素的地表位置。');
      } else {
        assert.ok(groundProbe, mapSlug + ' 未先找到純 Diffuse 的可見地表取樣點。');
        await targetPage.mouse.move(groundProbe.x, groundProbe.y);
        await targetPage.waitForFunction(({ value, label }) => {
          const text = document.getElementById('gnd-surface-inspector-content')?.textContent || '';
          return text.includes('目前診斷模式：' + value + '／' + label)
            && text.includes('Surface #') && text.includes('真實材質路徑')
            && text.includes('原始四角 UV')
            && text.includes('原始 RGB lightmap / AO 四角取樣')
                && text.includes('相鄰 TOP surface 對照')
            && text.includes('Diffuse 貼圖採樣：mipmap=on')
                && text.includes('Diffuse 貼圖採樣：mipmap=on; min=mipmap filter (')
            && text.includes('RGB lightmap/AO 採樣：mipmap=off')
            && /Diffuse 貼圖採樣：mipmap=on; .*colorSpace=NoColorSpace/.test(text)
            && /RGB lightmap\/AO 採樣：mipmap=off; .*colorSpace=NoColorSpace/.test(text)
            && text.includes('游標處插值頂點色 RGB：')
            && text.includes('游標處 Lightmap atlas UV2：')
            && text.includes('游標處來源 RGB lightmap / AO 最近像素（原始 GND bytes）：RGB (')
            && /GPU 最終畫面取樣 RGBA：\(\d+,\s*\d+,\s*\d+,\s*\d+\)/.test(text);
        }, { value: mode.value, label: mode.label }, { timeout: 5000 });
        const diagnosticText = await inspector.innerText();
        const pixelMatch = diagnosticText.match(/GPU 最終畫面取樣 RGBA：\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
        assert.ok(pixelMatch, mapSlug + ' 的 ' + mode.label + ' 模式沒有取得 GPU 畫面像素。');
        sampledPixels[mode.value] = pixelMatch.slice(1, 4).join(',');
      }
    }
    await targetPage.screenshot({
      path: path.join(artifactDir, mapSlug + '-gnd-debug-' + mode.file + '.png'),
      clip: { x: stageBox.x, y: stageBox.y, width: stageBox.width, height: stageBox.height },
      animations: 'disabled',
    });
  }
  assert.equal(Object.keys(sampledPixels).length, GND_DEBUG_SCREENSHOT_MODES.length,
    mapSlug + ' 每個 GND 診斷模式都必須有同一地表點的 GPU 像素。');
  assert.notEqual(sampledPixels['7'], sampledPixels['8'],
    mapSlug + ' 純 Diffuse 與純頂點色的 GPU 畫面像素相同，診斷分離可能未生效。');
  assert.notEqual(sampledPixels['2'], sampledPixels['3'],
    mapSlug + ' RGB lightmap 與 AO 的 GPU 像素相同，通道分離可能未生效。');
  if (options.requireNonzeroLightmap) {
    assert.ok(sourceLightmapProbe, mapSlug + ' 找不到來源 RGB lightmap 有明顯非零值的可見地表點。');
    const gpuRgb = sampledPixels['2'].split(',').map(Number);
    const expectedRgb = sourceLightmapProbe.posterizedRgb;
    const channelDelta = expectedRgb.map((value, channel) => Math.abs(value - gpuRgb[channel]));
    const audit = {
      mapId: mapSlug,
      shaderMode: 'RGB lightmap',
      surfaceIndex: sourceLightmapProbe.surfaceIndex,
      lightmapIndex: sourceLightmapProbe.lightmapIndex,
      atlasUv: sourceLightmapProbe.atlasUv,
      sourceRgbBytes: sourceLightmapProbe.sourceRgb,
      expectedPosterizedRgb: expectedRgb,
      gpuReadbackRgb: gpuRgb,
      absoluteChannelDelta: channelDelta,
      maxAbsoluteChannelDelta: Math.max(...channelDelta),
    };
    assert.ok(expectedRgb.some((value, channel) => value >= 32 && gpuRgb[channel] >= 8),
      mapSlug + ' 原始 RGB lightmap 有明顯亮值，但 GPU 讀回仍接近全黑：' + JSON.stringify(audit));
    assert.ok(audit.maxAbsoluteChannelDelta <= 40,
      mapSlug + ' GPU RGB lightmap 讀回與原始來源／16 階 posterization 對不上：' + JSON.stringify(audit));
    await writeFile(
      path.join(artifactDir, mapSlug + '-rgb-lightmap-gpu-readback.json'),
      JSON.stringify(audit, null, 2) + '\n'
    );
    console.log(mapSlug + ' RGB lightmap source-to-GPU readback audit: ' + JSON.stringify(audit));
  }
  console.log(mapSlug + ' GND debug GPU RGB at the same ground point: ' + JSON.stringify(sampledPixels));
  await selector.selectOption('0');
  assert.ok((await targetPage.locator('#status').innerText()).includes('GND 診斷模式：完整合成'),
    mapSlug + ' 無法切回完整 GND 合成畫面。');
  assert.equal(await targetPage.locator('#gnd-surface-inspector').isVisible(), false,
    mapSlug + ' 切回完整合成後仍顯示除錯取樣面板。');
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
  await page.locator('#gnd-debug-mode').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.locator('#gnd-debug-mode option').count(), 9, 'GND 診斷應提供完整合成與八種獨立通道檢視。');
  await page.locator('#player-vitals-panel').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#support-skill').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#cast-support-skill').waitFor({ state: 'visible', timeout: 30000 });
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
  // A scene can report loaded while terrain has fallen back to a flat tint.
  // Require real GND diffuse textures to resolve and finish at least one image load.
  await page.waitForFunction(() => {
    const text = document.getElementById('stats')?.textContent || '';
    const match = text.match(/GND 地表貼圖：已解析 (\d+)\/(\d+)；載入成功 (\d+)；失敗 (\d+)；缺少匹配 (\d+)/);
    return match && Number(match[1]) > 0 && Number(match[2]) > 0 && Number(match[3]) > 0;
  }, null, { timeout: 30000 });
  const terrainTextureStats = await page.locator('#stats').innerText();
  assert.ok(terrainTextureStats.includes('GND 地表貼圖：已解析 '), '地表貼圖載入診斷未顯示。');


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

  // Capture the real GND surface seams at a closer view as well as the full-map overview.
  const stage = page.locator('#stage');
  const stageBox = await stage.boundingBox();
  assert.ok(stageBox && stageBox.width > 0 && stageBox.height > 0, '3D 地圖畫面沒有有效尺寸。');
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  for (let zoomStep = 0; zoomStep < 14; zoomStep++) {
    await page.mouse.wheel(0, -100);
    await sleep(35);
  }
  await sleep(500);
  await page.screenshot({
    path: path.join(artifactDir, 'desktop-ground-zoom.png'),
    clip: { x: stageBox.x, y: stageBox.y, width: stageBox.width, height: stageBox.height },
    animations: 'disabled',
  });
  await captureGndDebugViews(page, stageBox, 'tra-fild');
  await page.locator('#recenter').click();
  await sleep(200);
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

  // Validate the same UV and baked-lighting path on a second real RO map.
  await page.locator('#native-map').fill('prontera');
  await page.locator('#load-native-map').click();
  await page.waitForFunction(() => {
    const status = document.getElementById('status')?.textContent || '';
    const stats = document.getElementById('stats')?.textContent || '';
    return status.includes('原生地圖已載入') && stats.includes('GAT：prontera.gat');
  }, null, { timeout: 150000 });
  await page.waitForFunction(() => {
    const stats = document.getElementById('stats')?.textContent || '';
    const match = stats.match(/GND 地表貼圖：已解析 (\d+)\/(\d+)；載入成功 (\d+)；失敗 (\d+)；缺少匹配 (\d+)/);
    return match && Number(match[1]) > 0 && Number(match[3]) > 0;
  }, null, { timeout: 30000 });
  await page.locator('#recenter').click();
  const pronteraStage = await page.locator('#stage').boundingBox();
  assert.ok(pronteraStage && pronteraStage.width > 0 && pronteraStage.height > 0,
    '普隆德拉原生地圖沒有有效畫面尺寸。');
  await page.mouse.move(pronteraStage.x + pronteraStage.width / 2,
    pronteraStage.y + pronteraStage.height / 2);
  for (let zoomStep = 0; zoomStep < 14; zoomStep++) {
    await page.mouse.wheel(0, -100);
    await sleep(35);
  }
  await sleep(500);
  await page.screenshot({
    path: path.join(artifactDir, 'desktop-prontera-ground-zoom.png'),
    clip: { x: pronteraStage.x, y: pronteraStage.y,
      width: pronteraStage.width, height: pronteraStage.height },
    animations: 'disabled',
  });
  await captureGndDebugViews(page, pronteraStage, 'prontera');
  await page.locator('#recenter').click();

  // Icecastle contains real non-zero RGB lightmap bytes; compare one source sample
  // with the RGB-lightmap-only shader output read back from the WebGL framebuffer.
  await page.locator('#native-map').fill('icecastle');
  await page.locator('#load-native-map').click();
  await page.waitForFunction(() => {
    const status = document.getElementById('status')?.textContent || '';
    const stats = document.getElementById('stats')?.textContent || '';
    return status.includes('原生地圖已載入') && stats.includes('GAT：icecastle.gat');
  }, null, { timeout: 150000 });
  await page.waitForFunction(() => {
    const stats = document.getElementById('stats')?.textContent || '';
    const match = stats.match(/GND 地表貼圖：已解析 (\d+)\/(\d+)；載入成功 (\d+)；失敗 (\d+)；缺少匹配 (\d+)/);
    return match && Number(match[1]) > 0 && Number(match[3]) > 0;
  }, null, { timeout: 30000 });
  await page.locator('#recenter').click();
  const icecastleStage = await page.locator('#stage').boundingBox();
  assert.ok(icecastleStage && icecastleStage.width > 0 && icecastleStage.height > 0,
    '冰城原生地圖沒有有效畫面尺寸。');
  await page.mouse.move(icecastleStage.x + icecastleStage.width / 2,
    icecastleStage.y + icecastleStage.height / 2);
  for (let zoomStep = 0; zoomStep < 14; zoomStep++) {
    await page.mouse.wheel(0, -100);
    await sleep(35);
  }
  await sleep(500);
  await captureGndDebugViews(page, icecastleStage, 'icecastle', { requireNonzeroLightmap: true });
  await page.locator('#recenter').click();

  // Restore tra_fild for the mobile interaction checks below.
  await page.locator('#native-map').fill('tra_fild');
  await page.locator('#load-native-map').click();
  await page.waitForFunction(() => {
    const status = document.getElementById('status')?.textContent || '';
    const stats = document.getElementById('stats')?.textContent || '';
    return status.includes('原生地圖已載入') && stats.includes('GAT：tra_fild.gat');
  }, null, { timeout: 150000 });
  await page.waitForFunction(() => {
    const stats = document.getElementById('stats')?.textContent || '';
    const match = stats.match(/GND 地表貼圖：已解析 (\d+)\/(\d+)；載入成功 (\d+)；失敗 (\d+)；缺少匹配 (\d+)/);
    return match && Number(match[1]) > 0 && Number(match[3]) > 0;
  }, null, { timeout: 30000 });
  await page.locator('#recenter').click();

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(350);
  await assertNoHorizontalOverflow(page, '手機');
  assert.equal(await page.locator('#gnd-debug-picker').isVisible(), false,
    '手機版不應讓 GND 開發診斷選單佔用探索畫面空間。');
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
    const overlaps = (a, b) => a.left < b.right && a.right > b.left
      && a.top < b.bottom && a.bottom > b.top;
    const status = rect(document.getElementById('status'));
    const monster = rect(document.getElementById('monster-panel'));
    const minimap = rect(document.getElementById('minimap-panel'));
    return {
      status, monster, minimap,
      statsDisplay: getComputedStyle(document.getElementById('stats')).display,
      monsterOverlapsMinimap: overlaps(monster, minimap),
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  assert.ok(boxes.status.bottom <= boxes.monster.top || boxes.status.right <= boxes.monster.left
    || boxes.monster.right <= boxes.status.left,
    '手機版狀態提示與怪物面板重疊：' + JSON.stringify(boxes));
  assert.equal(boxes.statsDisplay, 'none',
    '手機版診斷面板應收起，避免遮擋遊戲操作區：' + JSON.stringify(boxes));
  assert.equal(boxes.monsterOverlapsMinimap, false,
    '手機版怪物操作面板遮住小地圖：' + JSON.stringify(boxes));
  assert.ok(boxes.monster.left >= 0 && boxes.monster.right <= boxes.viewportWidth + 1,
    '手機版怪物操作面板超出畫面：' + JSON.stringify(boxes));
  await page.screenshot({ path: path.join(artifactDir, 'mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(pageErrors, [], '瀏覽器出現未處理的 JavaScript 錯誤：' + pageErrors.join(' | '));
  console.log('原生探索瀏覽器驗收通過：公開 tra_fild 3D 地圖、角色素材狀態、HP/SP、基礎／職業經驗、鋅幣、恢復／輔助操作面板、桌面與手機版面、小地圖移動／停止、視角跟隨、通行格切換。');
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
