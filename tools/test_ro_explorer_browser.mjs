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
    canvasWidth: document.querySelector('#stage canvas:not(#ro-2d-stage)')?.getBoundingClientRect().width || 0,
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


async function runGndGpuBoundaryAudit(targetPage, mapSlug, options = {}) {
  await targetPage.waitForFunction(() =>
    typeof window.__rooGndGpuBoundaryAudit?.run === 'function', null, { timeout: 10000 });
  let report = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    report = await targetPage.evaluate(() => window.__rooGndGpuBoundaryAudit.run());
    if (!report || report.status !== 'pending') break;
    await sleep(250);
  }
  assert.ok(report, mapSlug + ' 未取得 GND GPU 邊界稽核報告。');
  const artifactPath = path.join(artifactDir, mapSlug + '-gnd-multiscale-gpu-boundaries.json');
  await writeFile(artifactPath, JSON.stringify(report, null, 2) + '\n');

  assert.equal(report.status, 'passed',
    mapSlug + ' 多組 GND 相鄰 surface GPU diffuse／光照比對未通過：' + JSON.stringify(report));
  assert.ok(report.candidateCount >= 4,
    mapSlug + ' 應先掃描到多組真實相鄰 surface：' + JSON.stringify(report));
  const maxSelectedPairs = mapSlug === 'tra_fild' || mapSlug === 'tra-fild' ? 9 : 6;
  assert.ok(report.selectedPairCount >= 4 && report.selectedPairCount <= maxSelectedPairs,
    mapSlug + ' 應選出 4–' + maxSelectedPairs + ' 組可重現樣本：' + JSON.stringify(report));
  if (mapSlug === 'tra-fild' || mapSlug === 'tra_fild') {
    for (const expected of [
      { surfaces: [9967, 9969], axis: 'u' },
      { surfaces: [9844, 9967], axis: 'v' },
    ]) {
      const audit = report.audits.find(item => Array.isArray(item.surfaces)
        && expected.surfaces.every(surface => item.surfaces.includes(surface))
        && item.wrapBoundary && item.wrapBoundary.axis === expected.axis);
      assert.ok(audit, mapSlug + ' 缺少 UV=' + expected.axis.toUpperCase()
        + ' 端點跨界樣本 ' + expected.surfaces.join(' ↔ '));
      assert.equal(audit.samplerWrap && audit.samplerWrap.s, 'clamp-to-edge',
        mapSlug + ' surface ' + expected.surfaces.join(' ↔ ')
          + ' 的 GND 來源貼圖 U 軸應符合官方 ClampToEdge：' + JSON.stringify(audit.samplerWrap));
      assert.equal(audit.samplerWrap && audit.samplerWrap.t, 'clamp-to-edge',
        mapSlug + ' surface ' + expected.surfaces.join(' ↔ ')
          + ' 的 GND 來源貼圖 V 軸應符合官方 ClampToEdge：' + JSON.stringify(audit.samplerWrap));
    }
  }
  assert.ok(report.axes.includes('east') && report.axes.includes('north'),
    mapSlug + ' 必須涵蓋東向與北向相鄰 UV 邊界：' + JSON.stringify(report.axes));
  assert.ok(report.coverage.aoContrastPairs > 0,
    mapSlug + ' 所選樣本沒有真實 AO 來源差異，不能算覆蓋 AO 條件：' + JSON.stringify(report.coverage));
  assert.ok(report.coverage.uniqueLightmapIds >= 6,
    mapSlug + ' 所選樣本需包含多個真實 RGB lightmap 切片：' + JSON.stringify(report.coverage));
  assert.ok(report.coverage.vertexColorContrastPairs > 0,
    mapSlug + ' 所選樣本沒有涵蓋不同地表頂點色條件：' + JSON.stringify(report.coverage));
  assert.ok(report.coverage.uniqueUvRegionPairs >= 4,
    mapSlug + ' 樣本未覆蓋足夠不同的 diffuse UV 子區域：' + JSON.stringify(report.coverage));
  if (options.requireNonzeroRgbLightmap) {
    assert.ok(report.coverage.nonzeroEdgeRgbLightmapPairs > 0,
      mapSlug + ' 未從共用邊界的來源 RGB lightmap 找到非零樣本：' + JSON.stringify(report.coverage));
    assert.ok(report.coverage.nonzeroRgbLightmapPairs > 0 && report.coverage.nonzeroRgbLightmapSamples > 0,
      mapSlug + ' GPU 邊界讀回沒有取得非零 RGB lightmap 像素：' + JSON.stringify(report.coverage));
    if (options.requireAoRgbContrast) {
      assert.ok(report.coverage.aoRgbJointPairs > 0,
        mapSlug + ' 沒找到同時有非零 RGB lightmap 與 AO 明暗差異的相鄰 surface：'
          + JSON.stringify(report.coverage));
    }
    const litSamples = report.audits.flatMap(audit => (audit.scales || [])
      .flatMap(scale => (scale.samples || []).map(sample => ({
        surface: audit.surfaces, scale: scale.scale, sample,
      })))).filter(item => Array.isArray(item.sample.expected.rgbLightmap)
        && item.sample.expected.rgbLightmap.some(value => value >= 16));
    assert.ok(litSamples.length > 0 && litSamples.every(item =>
      Number.isFinite(item.sample.errors.rgbLightmap) && item.sample.errors.rgbLightmap <= 4),
    mapSlug + ' 非零 RGB lightmap 的來源預期值未與 GPU readback 對上：' + JSON.stringify(
      litSamples.map(item => ({ surfaces: item.surface, scale: item.scale,
        expected: item.sample.expected.rgbLightmap, gpu: item.sample.framebuffer.rgbLightmap,
        delta: item.sample.errors.rgbLightmap }))));
  }
  for (const audit of report.audits) {
    assert.equal(audit.scales.length, 3, mapSlug + ' surface ' + audit.surfaces + ' 應涵蓋 near／mid／far。');
    assert.deepEqual(audit.scales.map(scale => scale.scale), ['near', 'mid', 'far']);
    assert.ok(audit.cropPixelRects.length === 2 && audit.diffuseRects.length === 2,
      mapSlug + ' surface ' + audit.surfaces + ' 缺少兩側裁切範圍。');
    assert.ok(audit.coverage && audit.coverage.centerLightmapA && audit.coverage.centerLightmapB,
      mapSlug + ' surface ' + audit.surfaces + ' 缺少真實 AO／RGB lightmap 條件摘要。');
    assert.ok(audit.sampler.generateMipmaps, mapSlug + ' surface ' + audit.surfaces + ' 沒有啟用 mipmap。');
    for (let scaleIndex = 0; scaleIndex < audit.scales.length; scaleIndex++) {
      const scale = audit.scales[scaleIndex];
      assert.equal(scale.samples.length, 2,
        mapSlug + ' surface ' + audit.surfaces + ' ' + scale.scale + ' 必須讀回邊界兩側。');
      if (scaleIndex > 0) {
        for (let side = 0; side < 2; side++) {
          assert.ok(audit.scales[scaleIndex - 1].effectiveLod[side] < scale.effectiveLod[side],
            mapSlug + ' surface ' + audit.surfaces + ' mipmap LOD 應隨距離增加：'
              + JSON.stringify(audit.scales.map(item => ({ scale: item.scale, lod: item.effectiveLod }))));
        }
      }
      for (const sample of scale.samples) {
        assert.ok(Array.isArray(sample.expected.diffuseRgb) && sample.expected.diffuseRgb.length === 3,
          mapSlug + ' surface ' + audit.surfaces + ' 缺少來源 mipmap 預期 RGB。');
        assert.ok(Array.isArray(sample.framebuffer.diffuse) && sample.framebuffer.diffuse.length === 3,
          mapSlug + ' surface ' + audit.surfaces + ' 缺少 GPU diffuse framebuffer RGB。');
        assert.ok(Array.isArray(sample.expected.vertexColorRgb) && Array.isArray(sample.framebuffer.vertexColor),
          mapSlug + ' surface ' + audit.surfaces + ' 缺少頂點色預期值或 GPU 讀回。');
        assert.ok(Array.isArray(sample.expected.rgbLightmap) && Array.isArray(sample.framebuffer.rgbLightmap)
          && Number.isFinite(sample.expected.ao) && Array.isArray(sample.framebuffer.ao),
        mapSlug + ' surface ' + audit.surfaces + ' 缺少 AO／RGB lightmap 的來源與 GPU 值。');
        for (const mode of ['diffuse', 'vertexColor', 'rgbLightmap', 'ao', 'rswLight', 'combined']) {
          assert.ok(Array.isArray(sample.framebuffer[mode]) && sample.framebuffer[mode].length === 3,
            mapSlug + ' surface ' + audit.surfaces + ' ' + scale.scale + ' ' + sample.side
              + ' 缺少 ' + mode + ' framebuffer RGB。');
        }
        assert.ok(sample.expected.lightmapSource,
          mapSlug + ' surface ' + audit.surfaces + ' 缺少 AO／RGB lightmap 的來源像素值。');
      }
    }
  }
  console.log('GND 多組多尺度 GPU 邊界稽核：' + JSON.stringify(report));
  return report;
}

async function captureGndDebugViews(targetPage, stageBox, mapSlug, options = {}) {
  const selector = targetPage.locator('#gnd-debug-mode');
  await selector.waitFor({ state: 'visible', timeout: 5000 });
  const sampledPixels = {};
  const modes = options.requireNonzeroLightmap
    ? GND_DEBUG_SCREENSHOT_MODES.filter(mode => mode.value === '7' || mode.value === '2')
    : GND_DEBUG_SCREENSHOT_MODES;
  let groundProbe = null;
  let sourceLightmapProbe = null;
  for (const mode of modes) {
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
            [-0.42 * box.width, -0.34 * box.height], [0.42 * box.width, -0.34 * box.height],
            [-0.42 * box.width, 0.34 * box.height], [0.42 * box.width, 0.34 * box.height],
            [-0.42 * box.width, 0], [0.42 * box.width, 0],
            [0, -0.34 * box.height], [0, 0.34 * box.height],
            [-0.38 * box.width, -0.24 * box.height], [0.38 * box.width, -0.24 * box.height],
            [-0.38 * box.width, 0.24 * box.height], [0.38 * box.width, 0.24 * box.height],
          );

          // Icecastle lightmaps have large genuinely black areas. After the
          // hand-picked probes, scan a uniform grid to find a real lit texel.
          const scanX = [-0.46, -0.39, -0.32, -0.25, -0.18, -0.11, -0.04,
            0.03, 0.10, 0.17, 0.24, 0.31, 0.38, 0.45];
          const scanY = [-0.40, -0.32, -0.24, -0.16, -0.08, 0, 0.08, 0.16, 0.24, 0.32, 0.40];
          const seenOffsets = new Set(offsets.map(([dx, dy]) =>
            Math.round(dx) + ':' + Math.round(dy)));
          for (const yRatio of scanY) {
            for (const xRatio of scanX) {
              const dx = xRatio * box.width;
              const dy = yRatio * box.height;
              const key = Math.round(dx) + ':' + Math.round(dy);
              if (seenOffsets.has(key)) continue;
              seenOffsets.add(key);
              offsets.push([dx, dy]);
            }
          }
        }
        // The pale diffuse streak is visible near the far north-east terrain edge.
        // Probe a small grid over that line because the exact camera projection can
        // shift by several pixels between Chromium builds. Keep each hit's material,
        // source UV and GPU inspector data so we can classify the source rather than guess.
        if (mapSlug === 'tra-fild' && mode.value === '7') {
          const streakRatios = [];
          // Follow the visible diagonal instead of sampling horizontal rows above it.
          // A few vertical offsets tolerate small camera/Chromium projection changes.
          for (const xRatio of [0.57, 0.585, 0.60, 0.615, 0.63, 0.645, 0.66, 0.67]) {
            const centerYRatio = 0.231 + (xRatio - 0.57) * 0.85;
            for (const verticalOffsetPx of [-2, 0, 2]) {
              streakRatios.push([xRatio, centerYRatio + verticalOffsetPx / box.height]);
            }
          }
          const streakObservations = [];
          for (const [xRatio, yRatio] of streakRatios) {
            const point = {
              x: box.x + box.width * xRatio,
              y: box.y + box.height * yRatio,
            };
            const target = await targetPage.evaluate(({ x, y }) => {
              const canvas = document.querySelector('#stage > canvas:not(#ro-2d-stage)');
              const element = document.elementFromPoint(x, y);
              return {
                isCanvas: Boolean(canvas && element === canvas),
                tag: element ? element.tagName : null,
                id: element && element.id || '',
              };
            }, point);
            if (!target.isCanvas) {
              streakObservations.push({
                point: [Math.round(point.x - box.x), Math.round(point.y - box.y)],
                result: 'not-canvas',
                target,
              });
              continue;
            }
            await targetPage.mouse.move(point.x, point.y);
            await sleep(50);
            let inspectorText = await inspector.innerText();
            if (inspectorText.includes('Surface #')
              && inspectorText.includes('GPU 最終畫面取樣 RGBA：等待下一個渲染影格。')) {
              try {
                await targetPage.waitForFunction(() => {
                  const text = document.getElementById('gnd-surface-inspector-content')?.textContent || '';
                  return /GPU 最終畫面取樣 RGBA：\(\d+,\s*\d+,\s*\d+,\s*\d+\)/.test(text);
                }, null, { timeout: 1500 });
              } catch (error) {
                // Keep the observation even if this browser cannot complete readback.
              }
              inspectorText = await inspector.innerText();
            }
            const lines = inspectorText.split('\n');
            const isSurfaceHit = inspectorText.includes('Surface #');
            const diagnosticClass = isSurfaceHit ? 'gnd-surface'
              : inspectorText.includes('游標目前先命中模型或水面') ? 'model-or-water-occlusion'
                : inspectorText.includes('目前游標沒有命中場景中的地表') ? 'no-ray-hit'
                  : 'other';
            const framebufferMatch = inspectorText.match(
              /GPU 最終畫面取樣 RGBA：\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\) @ \((\d+),\s*(\d+)\)/
            );
            streakObservations.push({
              point: [Math.round(point.x - box.x), Math.round(point.y - box.y)],
              result: isSurfaceHit ? 'surface-hit' : 'no-surface-hit',
              diagnosticClass,
              gpuFramebuffer: framebufferMatch ? {
                rgba: framebufferMatch.slice(1, 5).map(Number),
                pixel: framebufferMatch.slice(5, 7).map(Number),
              } : null,
              inspector: lines,
            });
          }
          const surfaceHits = streakObservations.filter(item => item.result === 'surface-hit');
          await writeFile(
            path.join(artifactDir, 'tra-fild-suspected-diffuse-streak-inspector.json'),
            JSON.stringify({
              mapId: mapSlug,
              mode: 'diffuse-only',
              stageSize: [Math.round(box.width), Math.round(box.height)],
              sampledPoints: streakObservations.length,
              surfaceHitCount: surfaceHits.length,
              observations: streakObservations,
            }, null, 2) + '\n'
          );
          const targetPoint = {
            x: box.x + box.width * 0.62,
            y: box.y + box.height * (0.231 + (0.62 - 0.57) * 0.85),
          };
          await targetPage.mouse.move(targetPoint.x, targetPoint.y);
          await sleep(100);
          await targetPage.screenshot({
            path: path.join(artifactDir, 'tra-fild-suspected-diffuse-streak-target.png'),
            clip: { x: box.x, y: box.y, width: box.width, height: box.height },
            animations: 'disabled',
          });
          console.log('tra_fild diffuse streak source/UV grid probe: ' + JSON.stringify({
            stageSize: [Math.round(box.width), Math.round(box.height)],
            sampledPoints: streakObservations.length,
            surfaceHitCount: surfaceHits.length,
            observations: streakObservations,
          }));
          assert.ok(surfaceHits.length > 0,
            'tra_fild suspected diffuse streak scan found no visible GND surface: '
              + JSON.stringify(streakObservations.slice(0, 8)));
        }

        let foundVisibleGround = false;
        const probeObservations = [];
        const sourceRejectObservations = [];
        const inspectorFailureObservations = [];
        const visitedPoints = new Set();
        let canvasCandidateCount = 0;
        let groundSurfaceCount = 0;
        let nonzeroSourcePixelCount = 0;
        for (const [dx, dy] of offsets) {
          const point = {
            x: Math.max(box.x + 8, Math.min(box.x + box.width - 8, centerX + dx)),
            y: Math.max(box.y + 8, Math.min(box.y + box.height - 8, centerY + dy)),
          };
          const pointKey = Math.round(point.x) + ':' + Math.round(point.y);
          if (visitedPoints.has(pointKey)) continue;
          visitedPoints.add(pointKey);
          const pointerTarget = await targetPage.evaluate(({ x, y }) => {
            const canvas = document.querySelector('#stage > canvas:not(#ro-2d-stage)');
            const target = document.elementFromPoint(x, y);
            return {
              isCanvas: Boolean(canvas && target === canvas),
              target: target ? {
                tag: target.tagName,
                id: target.id || '',
                className: String(target.className || '').slice(0, 80),
              } : null,
            };
          }, point);
          if (!pointerTarget.isCanvas) {
            if (options.requireNonzeroLightmap && probeObservations.length < 12) {
              probeObservations.push({
                point: [Math.round(point.x - box.x), Math.round(point.y - box.y)],
                result: '座標被 UI 遮住：' + JSON.stringify(pointerTarget.target),
              });
            }
            continue;
          }
          canvasCandidateCount++;
          await targetPage.mouse.move(point.x, point.y);
          await sleep(70);
          let diagnosticText = await inspector.innerText();
          if (!diagnosticText.includes('Surface #')) {
            if (options.requireNonzeroLightmap && probeObservations.length < 12) {
              probeObservations.push({
                point: [Math.round(point.x - box.x), Math.round(point.y - box.y)],
                result: diagnosticText.replace(/\s+/g, ' ').slice(0, 140),
              });
            }
            continue;
          }
          try {
            await targetPage.waitForFunction(({ requireGpuReadback }) => {
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
                && text.includes('GPU 使用的 diffuse crop 像素範圍：')
                && text.includes('游標處 RGB lightmap / AO 預期 GPU LOD0 線性取樣')
                && (!requireGpuReadback
                  || /GPU 最終畫面取樣 RGBA：\(\d+,\s*\d+,\s*\d+,\s*\d+\)/.test(text));
            }, { requireGpuReadback: !options.requireNonzeroLightmap }, {
              timeout: options.requireNonzeroLightmap ? 5000 : 1600,
            });
          } catch (error) {
            if (inspectorFailureObservations.length < 6) {
              const audit = await targetPage.evaluate(() => {
                const text = document.getElementById('gnd-surface-inspector-content')?.innerText || '';
                return {
                  hasSurface: text.includes('Surface #'),
                  hasMode: text.includes('目前診斷模式：7／純 Diffuse 貼圖'),
                  hasMaterial: text.includes('真實材質路徑'),
                  hasVertexColor: text.includes('游標處插值頂點色 RGB：'),
                  hasUv2: text.includes('游標處 Lightmap atlas UV2：'),
                  hasRawLightmap: text.includes('游標處來源 RGB lightmap / AO 最近像素（原始 GND bytes）：RGB ('),
                  hasCrop: text.includes('GPU 使用的 diffuse crop 像素範圍：'),
                  hasExpectedGpuSample: text.includes('游標處 RGB lightmap / AO 預期 GPU LOD0 線性取樣'),
                  framebuffer: (text.match(/GPU 最終畫面取樣 RGBA：[\s\S]{0,80}/) || [])[0] || '',
                  tail: text.slice(-650),
                };
              });
              inspectorFailureObservations.push({
                point: [Math.round(point.x - box.x), Math.round(point.y - box.y)],
                error: String(error).slice(0, 100),
                audit,
              });
            }
            continue;
          }
          diagnosticText = await inspector.innerText();
          groundSurfaceCount++;
          const pixelMatch = diagnosticText.match(/GPU 最終畫面取樣 RGBA：\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
          if (!pixelMatch && !options.requireNonzeroLightmap) continue;
          let candidateLightmapProbe = null;
          if (options.requireNonzeroLightmap) {
            const sourceMatch = diagnosticText.match(
              /游標處來源 RGB lightmap \/ AO 最近像素（原始 GND bytes）：RGB \((\d+),\s*(\d+),\s*(\d+)\); AO \d+/
            );
            const sourceRgb = sourceMatch ? sourceMatch.slice(1, 4).map(Number) : null;
            const posterizedRgb = sourceRgb && sourceRgb.map(value => Math.floor(value / 16) * 16);
            if (sourceRgb && sourceRgb.some(value => value > 0)) nonzeroSourcePixelCount++;
            const surfaceMatch = diagnosticText.match(/Surface #(\d+)/);
            const lightmapMatch = diagnosticText.match(/材質索引：-?\d+；lightmap 索引：(\d+)/);
            const uvMatch = diagnosticText.match(/游標處 Lightmap atlas UV2：\(([^)]+)\)/);
            const atlasUv = uvMatch ? uvMatch[1].split(',').map(value => Number(value.trim())) : null;
            if (!sourceRgb || Math.max(...posterizedRgb) < 16
              || !surfaceMatch || !lightmapMatch || !atlasUv || atlasUv.length !== 2
              || !atlasUv.every(Number.isFinite)) {
              if (sourceRejectObservations.length < 8) {
                sourceRejectObservations.push({
                  point: [Math.round(point.x - box.x), Math.round(point.y - box.y)],
                  surfaceIndex: surfaceMatch ? Number(surfaceMatch[1]) : null,
                  lightmapIndex: lightmapMatch ? Number(lightmapMatch[1]) : null,
                  sourceRgb,
                  posterizedRgb,
                  atlasUv,
                });
              }
              continue;
            }
            candidateLightmapProbe = {
              surfaceIndex: Number(surfaceMatch[1]),
              lightmapIndex: Number(lightmapMatch[1]),
              atlasUv,
              sourceRgb,
              posterizedRgb,
            };
          }
          if (!/(?:SW|SE|NW|NE): 來源有效角落 texel RGB \(\d+, \d+, \d+\); AO \d+/.test(diagnosticText)) continue;
          if (options.requireNonzeroLightmap) sourceLightmapProbe = candidateLightmapProbe;
          const scrollMetrics = await targetPage.locator('#gnd-surface-inspector').evaluate(el => ({
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          }));
          assert.ok(scrollMetrics.scrollHeight > scrollMetrics.clientHeight,
            mapSlug + ' 地表取樣內容超出視窗時必須提供面板內捲動。');
          groundProbe = point;
          sampledPixels['7'] = pixelMatch ? pixelMatch.slice(1, 4).join(',') : 'source-probe';
          foundVisibleGround = true;
          break;
        }
        assert.ok(foundVisibleGround,
          (options.requireNonzeroLightmap
            ? mapSlug + ' 找不到 RGB lightmap 非零亮點的可見地表取樣點。'
            : mapSlug + ' 找不到未被前景模型遮住且可讀取 GPU 像素的地表位置。')
            + (options.requireNonzeroLightmap
              ? ' 掃描統計=' + JSON.stringify({
                  candidates: offsets.length,
                  uniquePoints: visitedPoints.size,
                  canvasCandidates: canvasCandidateCount,
                  groundSurfaces: groundSurfaceCount,
                  nonzeroSourcePixels: nonzeroSourcePixelCount,
                })
                + ' 無地表樣本=' + JSON.stringify(probeObservations)
                + ' 來源被排除樣本=' + JSON.stringify(sourceRejectObservations)
              : '')
            + ' 診斷面板等待失敗樣本=' + JSON.stringify(inspectorFailureObservations));
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
                && text.includes('GPU 使用的 diffuse crop 像素範圍：')
                && text.includes('游標處 RGB lightmap / AO 預期 GPU LOD0 線性取樣')
            && /GPU 最終畫面取樣 RGBA：\(\d+,\s*\d+,\s*\d+,\s*\d+\)/.test(text);
        }, { value: mode.value, label: mode.label }, {
          timeout: options.requireNonzeroLightmap ? 12000 : 5000,
        });
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
  assert.equal(Object.keys(sampledPixels).length, modes.length,
    mapSlug + ' 每個 GND 診斷模式都必須有同一地表點的 GPU 像素。');
  if (!options.requireNonzeroLightmap) {
    assert.notEqual(sampledPixels['7'], sampledPixels['8'],
      mapSlug + ' 純 Diffuse 與純頂點色的 GPU 畫面像素相同，診斷分離可能未生效。');
    assert.notEqual(sampledPixels['2'], sampledPixels['3'],
      mapSlug + ' RGB lightmap 與 AO 的 GPU 像素相同，通道分離可能未生效。');
  }
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
    assert.ok(expectedRgb.some((value, channel) => value >= 16 && gpuRgb[channel] >= 8),
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
  page.on('pageerror', error => {
    pageErrors.push(String(error));
    console.log('瀏覽器未處理錯誤：' + String(error));
  });
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
  params.set('roo-gnd-gpu-audit', '1');
  // This suite audits actual GND shader channels; RSM placements and water animation
  // are verified in the separate asset pipeline and are intentionally skipped here.
  params.set('roo-gnd-gpu-audit-only', '1');
  params.set('roo-2d-test', '1');
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
  await runGndGpuBoundaryAudit(page, 'tra-fild');


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

  // Exercise the real Canvas 2D map view against the loaded tra_fild GND/GAT and RO sprites.
  const toggle2d = page.locator('#toggle-2d-view');
  await toggle2d.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(await toggle2d.isEnabled(), '載入原生 tra_fild 後純 2D 原型按鈕仍不可用。');
  await toggle2d.click();
  await page.waitForFunction(() => {
    const canvas = document.getElementById('ro-2d-stage');
    const metrics = window.__rooExplorer2DTest?.getMetrics();
    return canvas && !canvas.hidden && metrics && metrics.active && metrics.terrainTiles > 0;
  }, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const metrics = window.__rooExplorer2DTest?.getMetrics();
    return metrics && metrics.texturedTiles > 0;
  }, null, { timeout: 30000 });
  await sleep(350);
  await page.screenshot({
    path: path.join(artifactDir, 'tra-fild-2d-prototype.png'),
    clip: { x: stageBox.x, y: stageBox.y, width: stageBox.width, height: stageBox.height },
    animations: 'disabled',
  });
  const twoDReady = await page.evaluate(() => {
    const metrics = window.__rooExplorer2DTest.getMetrics();
    const canvas = document.querySelector('#stage canvas:not(#ro-2d-stage)');
    return {
      metrics,
      selectedWebglComputedDisplay: canvas ? getComputedStyle(canvas).display : 'missing',
      selectedWebglInlineDisplay: canvas ? canvas.style.display : 'missing',
      webglHidden: metrics.rendererCanvasComputedDisplay === 'none'
        && metrics.rendererCanvasHidden,
      buttonPressed: document.getElementById('toggle-2d-view').getAttribute('aria-pressed'),
    };
  });
  console.log('Canvas 2D 瀏覽器實際狀態：' + JSON.stringify(twoDReady));
  assert.ok(twoDReady.metrics.terrainTiles > 0 && twoDReady.metrics.texturedTiles > 0,
    '2D 畫面沒有繪製真實 GND 來源貼圖：' + JSON.stringify(twoDReady));
  assert.equal(twoDReady.metrics.active, true);
  assert.equal(twoDReady.metrics.canvasHidden, false);
  assert.equal(twoDReady.webglHidden, true, '純 2D 模式應隱藏 WebGL 畫布。');
  assert.equal(twoDReady.buttonPressed, 'true');
  const twoDTargets = await page.evaluate(() => window.__rooExplorer2DTest.getWalkableTargets());
  assert.ok(twoDTargets.length > 0, '2D 視窗內找不到可點擊的 GAT 可走目的地。');
  const movementTarget = twoDTargets[Math.floor(twoDTargets.length / 2)];
  await page.mouse.click(stageBox.x + movementTarget.screenX, stageBox.y + movementTarget.screenY);
  await page.locator('#stop-movement').waitFor({ state: 'visible', timeout: 7000 });
  await page.locator('#stop-movement').click();
  await page.locator('#stop-movement').waitFor({ state: 'hidden', timeout: 3000 });
  await toggle2d.click();
  await page.waitForFunction(() => document.getElementById('ro-2d-stage')?.hidden === true
    && getComputedStyle(document.querySelector('#stage canvas:not(#ro-2d-stage)')).display !== 'none');
  console.log('Canvas 2D 原型通過：真實 GND 紋理、RO 角色／怪物精靈、GAT 目的地點擊、既有尋路與返回 3D。');
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
  await runGndGpuBoundaryAudit(page, 'prontera');
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

  // Icecastle has real non-zero RGB lightmap bytes. Reload the page before this
  // probe so a previous map's diagnostic-panel state cannot leak into the check.
  const icecastleParams = new URLSearchParams(params);
  icecastleParams.set('map', 'icecastle');
  await page.goto(baseUrl + '/tools/ro_explorer.html?' + icecastleParams.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.locator('#native-toolbar').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#gnd-debug-mode').waitFor({ state: 'visible', timeout: 5000 });
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
  await runGndGpuBoundaryAudit(page, 'icecastle', { requireNonzeroRgbLightmap: true });
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
  await page.screenshot({
    path: path.join(artifactDir, 'icecastle-ground-zoom.png'),
    clip: { x: icecastleStage.x, y: icecastleStage.y,
      width: icecastleStage.width, height: icecastleStage.height },
    animations: 'disabled',
  });
  // The multiscale boundary audit above already checks non-zero RGB source bytes
  // against all three GPU distance scales. Avoid the redundant cursor sweep here.
  await page.locator('#recenter').click();

  // Required GPU boundary audits for tra_fild, prontera and icecastle have already run above.
  // Broader optional map exploration stays outside this blocking browser flow because the
  // public asset host is best-effort and a large map can stall or overload the renderer.
  // The source-level real-map smoke workflow continues to validate the supported map fixtures.
  // Reload the original field before the mobile interaction checks below.
  await page.goto(baseUrl + '/tools/ro_explorer.html?' + params.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.locator('#native-toolbar').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#gnd-debug-mode').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#player-vitals-panel').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#support-skill').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#cast-support-skill').waitFor({ state: 'visible', timeout: 30000 });
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
