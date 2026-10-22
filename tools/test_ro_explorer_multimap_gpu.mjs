import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.resolve(process.env.ROO_GND_DIAGNOSTIC_ARTIFACT_DIR
  || path.join(root, 'artifacts', 'gnd-multimap-gpu'));
const baseUrl = process.env.ROO_GND_DIAGNOSTIC_BASE_URL || 'http://127.0.0.1:8766';
const allowedMaps = new Set([
  'icecastle', 'prontera', 'tra_fild',
  'ice_dun02', 'thor_v03', 'iz_dun03', 'gl_cas01', 'gef_fild00', 'pay_dun00',
]);
const mapTimeoutMs = Math.max(45000, Math.min(150000,
  Number.parseInt(process.env.ROO_GND_DIAGNOSTIC_MAP_TIMEOUT_MS || '110000', 10) || 110000));
const maps = [...new Set((process.env.ROO_GND_DIAGNOSTIC_MAPS || 'icecastle,ice_dun02,thor_v03,iz_dun03')
  .split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
const maxMaps = 4;
const assetBaseUrl = 'https://assets.latam-tools.com.br';
const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + ' ms')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function validateAuditReport(mapId, report) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(mapId + ': ' + message);
  };
  const coverage = report && report.coverage ? report.coverage : {};
  check(report && report.status === 'passed', 'GPU audit status is ' + (report && report.status));
  check(Number(report && report.candidateCount) >= 4, 'fewer than four candidate shared edges');
  check(Number(report && report.selectedPairCount) >= 4
    && Number(report && report.selectedPairCount) <= 6, 'expected 4–6 selected edge pairs');
  check(Array.isArray(report && report.axes)
    && report.axes.includes('east') && report.axes.includes('north'), 'east/north edges not both covered');
  check(Number(coverage.aoContrastPairs) > 0, 'no AO-contrast pair selected');
  check(Number(coverage.uniqueLightmapIds) >= 6, 'fewer than six unique lightmap slices sampled');
  check(Number(coverage.vertexColorContrastPairs) > 0, 'no vertex-color contrast pair selected');
  check(Number(coverage.uniqueUvRegionPairs) >= 4, 'insufficient diffuse UV-region coverage');
  const baselineMaps = new Set(['icecastle', 'prontera', 'tra_fild']);
  const requireNonzeroRgbLightmap = mapId === 'icecastle' || !baselineMaps.has(mapId);
  const requireAoRgbContrast = !baselineMaps.has(mapId);
  if (requireNonzeroRgbLightmap) {
    check(Number(coverage.nonzeroEdgeRgbLightmapPairs) > 0, 'no shared edge with nonzero source RGB lightmap');
    check(Number(coverage.nonzeroRgbLightmapPairs) > 0
      && Number(coverage.nonzeroRgbLightmapSamples) > 0, 'no nonzero RGB lightmap GPU readback samples');
  }
  if (requireAoRgbContrast) {
    check(Number(coverage.aoRgbJointPairs) > 0, 'no pair combines nonzero RGB lightmap with AO contrast');
  }

  const audits = Array.isArray(report && report.audits) ? report.audits : [];
  const litSamples = [];
  for (const audit of audits) {
    const label = 'surface ' + JSON.stringify(audit.surfaces || []);
    check(Array.isArray(audit.scales) && audit.scales.length === 3, label + ' must include near/mid/far');
    check(Array.isArray(audit.cropPixelRects) && audit.cropPixelRects.length === 2,
      label + ' is missing the two source crop rectangles');
    check(Array.isArray(audit.diffuseRects) && audit.diffuseRects.length === 2,
      label + ' is missing the two diffuse UV rectangles');
    check(Boolean(audit.coverage && audit.coverage.centerLightmapA && audit.coverage.centerLightmapB),
      label + ' is missing AO/lightmap source summaries');
    check(Boolean(audit.sampler && audit.sampler.generateMipmaps), label + ' has mipmaps disabled');
    const cropProbe = audit.diffuseSharedUv;
    check(Boolean(cropProbe && cropProbe.status === 'passed'),
      label + ' same-source-UV diffuse crop/mipmap comparison did not pass: ' + JSON.stringify(cropProbe));
    check(Array.isArray(cropProbe && cropProbe.samples) && cropProbe.samples.length === 3,
      label + ' same-source-UV diffuse crop probe must cover near/mid/far');
    check(Number.isFinite(cropProbe && cropProbe.maxInterCropDelta)
      && cropProbe.maxInterCropDelta <= 2,
    label + ' diffuse crops disagree at the same source UV: ' + JSON.stringify(cropProbe));
    check(Number.isFinite(cropProbe && cropProbe.maxCropVsSourceDelta)
      && cropProbe.maxCropVsSourceDelta <= 2,
    label + ' isolated diffuse crop does not match the full-source sample: ' + JSON.stringify(cropProbe));
    const sourceDimensions = audit.sourceImage || {};
    const sourceIsPowerOfTwo = value => Number.isInteger(value) && value > 0
      && (value & (value - 1)) === 0;
    if (sourceIsPowerOfTwo(sourceDimensions.width) && sourceIsPowerOfTwo(sourceDimensions.height)) {
      check(Array.isArray(cropProbe && cropProbe.cropTextureDimensions)
        && cropProbe.cropTextureDimensions.length === 2
        && cropProbe.cropTextureDimensions.every(size => sourceIsPowerOfTwo(size.width)
          && sourceIsPowerOfTwo(size.height)),
      label + ' POT source atlas must use power-of-two padded crop mip grids: '
        + JSON.stringify(cropProbe && cropProbe.cropTextureDimensions));
    }
    const scales = Array.isArray(audit.scales) ? audit.scales : [];
    for (let i = 0; i < scales.length; i++) {
      const scale = scales[i];
      check(scale.samples && scale.samples.length === 2,
        label + ' ' + scale.scale + ' must read back both edge sides');
      if (i > 0 && scale.effectiveLod && scales[i - 1].effectiveLod) {
        for (let side = 0; side < 2; side++) {
          check(scales[i - 1].effectiveLod[side] < scale.effectiveLod[side],
            label + ' mipmap LOD did not increase with distance');
        }
      }
      for (const sample of scale.samples || []) {
        check(Array.isArray(sample.expected && sample.expected.diffuseRgb)
          && sample.expected.diffuseRgb.length === 3, label + ' missing expected diffuse mip RGB');
        check(Array.isArray(sample.framebuffer && sample.framebuffer.diffuse)
          && sample.framebuffer.diffuse.length === 3, label + ' missing diffuse GPU readback');
        check(Array.isArray(sample.expected && sample.expected.vertexColorRgb)
          && Array.isArray(sample.framebuffer && sample.framebuffer.vertexColor),
        label + ' missing expected/GPU vertex-color values');
        check(Array.isArray(sample.expected && sample.expected.rgbLightmap)
          && Array.isArray(sample.framebuffer && sample.framebuffer.rgbLightmap)
          && Number.isFinite(sample.expected && sample.expected.ao)
          && Array.isArray(sample.framebuffer && sample.framebuffer.ao),
        label + ' missing AO/RGB lightmap expected or GPU values');
        check(Boolean(sample.expected && sample.expected.lightmapSource),
          label + ' missing source AO/RGB lightmap pixel');
        for (const mode of ['diffuse', 'vertexColor', 'rgbLightmap', 'ao', 'rswLight', 'combined']) {
          check(Array.isArray(sample.framebuffer && sample.framebuffer[mode])
            && sample.framebuffer[mode].length === 3, label + ' missing ' + mode + ' GPU RGB');
        }
        if (requireNonzeroRgbLightmap
          && Array.isArray(sample.expected && sample.expected.rgbLightmap)
          && sample.expected.rgbLightmap.some(value => value >= 16)) {
          litSamples.push({
            surfaces: audit.surfaces, scale: scale.scale, side: sample.side,
            expected: sample.expected.rgbLightmap,
            gpu: sample.framebuffer && sample.framebuffer.rgbLightmap,
            delta: sample.errors && sample.errors.rgbLightmap,
          });
        }
      }
    }
  }
  if (requireNonzeroRgbLightmap) {
    check(litSamples.length > 0, 'no visibly lit RGB-lightmap samples found');
    check(litSamples.every(sample => Number.isFinite(sample.delta) && sample.delta <= 4),
      'source/GPU RGB-lightmap delta exceeded 4: ' + JSON.stringify(litSamples));
  }
  return failures;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(baseUrl + '/tools/ro_explorer.html', {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return;
    } catch (error) {}
    await sleep(250);
  }
  throw new Error('Local static server failed to start at ' + baseUrl);
}

async function preflightManifest(mapId) {
  const url = assetBaseUrl + '/maps/' + mapId + '/manifest.json';
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return { available: false, reason: 'manifest HTTP ' + response.status };
    const manifest = await response.json();
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { available: false, reason: 'manifest JSON is not an object' };
    }
    if (manifest.map && String(manifest.map).toLowerCase() !== mapId) {
      return { available: false, reason: 'manifest map id does not match requested map' };
    }
    const files = manifest.files;
    const required = ['gat', 'gnd', 'rsw'];
    if (!files || typeof files !== 'object'
      || !required.every(ext => files[ext] === mapId + '.' + ext)) {
      return { available: false, reason: 'manifest does not advertise the expected GAT/GND/RSW files' };
    }
    return {
      available: true,
      url,
      fileKeys: Object.keys(files).sort(),
      textureCount: manifest.textures && typeof manifest.textures === 'object'
        ? Object.keys(manifest.textures).length : 0,
      modelCount: manifest.models && typeof manifest.models === 'object'
        ? Object.keys(manifest.models).length : 0,
    };
  } catch (error) {
    return { available: false, reason: 'manifest request failed: ' + String(error) };
  }
}

async function probeGndLayout(mapId) {
  const url = assetBaseUrl + '/maps/' + mapId + '/' + mapId + '.gnd';
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { available: false, reason: 'GND HTTP ' + response.status };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 24) return { available: false, sizeBytes: bytes.byteLength, reason: 'GND file is too short' };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const i32 = at => at >= 0 && at + 4 <= view.byteLength ? view.getInt32(at, true) : null;
    const f32 = at => at >= 0 && at + 4 <= view.byteLength ? view.getFloat32(at, true) : null;
    const header = String.fromCharCode(...bytes.slice(0, 4));
    const major = view.getUint8(4);
    const minor = view.getUint8(5);
    const width = i32(6);
    const height = i32(10);
    const textureCount = i32(18);
    const texturePathLength = i32(22);
    const cubeCount = width * height;
    const lightmapAt = 26 + textureCount * texturePathLength;
    const lmCount = i32(lightmapAt);
    const lmWidth = i32(lightmapAt + 4);
    const lmHeight = i32(lightmapAt + 8);
    const cellsPerGrid = i32(lightmapAt + 12);
    const legacyBytes = lmCount !== null && lmWidth !== null && lmHeight !== null
      ? lmCount * lmWidth * lmHeight * 4 : -1;
    const standardSurfaceAt = lmCount !== null && lmCount >= 0 && lmCount <= 65536
      ? lightmapAt + 4 + lmCount * 268 : -1;
    const legacySurfaceAt = legacyBytes >= 0 && Number.isSafeInteger(legacyBytes)
      ? lightmapAt + 16 + legacyBytes : -1;
    const strides = [];
    const strideOptions = [32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 96];
    function inspectCandidate(surfaceAt, stride, layout) {
      if (surfaceAt < 0 || surfaceAt + 4 > view.byteLength) return null;
      const surfaceCount = i32(surfaceAt);
      if (surfaceCount === null || surfaceCount < 0 || surfaceCount > 1000000) return null;
      const surfacesStart = surfaceAt + 4;
      const cubesAt = surfacesStart + surfaceCount * stride;
      const tailAt = cubesAt + cubeCount * 28;
      if (!Number.isSafeInteger(cubesAt) || !Number.isSafeInteger(tailAt)
        || cubesAt < surfacesStart || cubesAt > view.byteLength) return null;
      const withinFile = tailAt <= view.byteLength;
      let waterTailValid = false;
      if (minor === 7) waterTailValid = tailAt === view.byteLength;
      else if (tailAt + 32 <= view.byteLength) {
        const numU = i32(tailAt + 24);
        const numV = i32(tailAt + 28);
        if (numU !== null && numV !== null && numU >= 0 && numV >= 0
          && numU <= 64 && numV <= 64) {
          waterTailValid = tailAt + 32 + numU * numV * (minor === 8 ? 4 : 24) === view.byteLength;
        }
      }
      let validCubeReferences = 0;
      let sampledCubes = 0;
      if (withinFile) {
        for (let cube = 0; cube < Math.min(cubeCount, 24); cube++) {
          const at = cubesAt + cube * 28 + 16;
          const refs = [i32(at), i32(at + 4), i32(at + 8)];
          if (refs.every(value => value !== null && value >= -1 && value < surfaceCount)) validCubeReferences++;
          sampledCubes++;
        }
      }
      return {
        layout, stride, surfaceAt, surfaceCount, cubesAt, tailAt,
        withinFile, trailingBytes: view.byteLength - tailAt, waterTailValid,
        sampledCubes, validCubeReferences,
      };
    }
    const standardCandidates = strideOptions
      .map(stride => inspectCandidate(standardSurfaceAt, stride, 'standard-slices'))
      .filter(Boolean);
    const legacyCandidates = strideOptions
      .map(stride => inspectCandidate(legacySurfaceAt, stride, 'global-lightmap'))
      .filter(Boolean);
    for (const index of [0, 1, 2]) {
      const at = lightmapAt + 4 + index * 268;
      if (at + 12 <= view.byteLength) strides.push({
        index, pixelFormat: i32(at), width: i32(at + 4), height: i32(at + 8),
      });
    }
    function bytesHex(start, length) {
      return Array.from(bytes.slice(Math.max(0, start), Math.min(bytes.length, start + length)))
        .map(value => value.toString(16).padStart(2, '0')).join('');
    }
    return {
      available: true, url, sizeBytes: view.byteLength, header, version: major + '.' + minor,
      width, height, cubeCount, zoom: f32(14), textureCount, texturePathLength,
      lightmapHeaderOffset: lightmapAt,
      lightmapHeader: { count: lmCount, width: lmWidth, height: lmHeight, cellsPerGrid },
      standard: {
        surfaceCountAt: standardSurfaceAt, byteOffset: standardSurfaceAt,
        plausible: standardSurfaceAt >= 0 && standardSurfaceAt + 4 <= view.byteLength,
        count: i32(standardSurfaceAt), sliceHeaders: strides,
        exactTailCandidates: standardCandidates.filter(item => item.waterTailValid),
        candidates: standardCandidates.filter(item => item.withinFile).slice(0, 8),
        hex: bytesHex(standardSurfaceAt - 16, 64),
      },
      legacy: {
        lightmapPayloadBytes: legacyBytes, surfaceCountAt: legacySurfaceAt,
        plausible: legacySurfaceAt >= 0 && legacySurfaceAt + 4 <= view.byteLength,
        count: i32(legacySurfaceAt),
        exactTailCandidates: legacyCandidates.filter(item => item.waterTailValid),
        candidates: legacyCandidates.filter(item => item.withinFile).slice(0, 8),
        hex: bytesHex(legacySurfaceAt - 16, 64),
      },
    };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

async function auditMap(mapId) {
  const report = {
    mapId,
    status: 'started',
    startedAt: new Date().toISOString(),
    timeoutMs: mapTimeoutMs,
    manifest: null,
    diagnostics: {},
    pageErrors: [],
    audit: null,
    validationFailures: [],
  };
  const started = Date.now();
  let browser;

  try {
    const manifest = await preflightManifest(mapId);
    report.manifest = manifest;
    report.gndLayoutProbe = manifest.available ? await probeGndLayout(mapId) : null;
    const layoutProbe = report.gndLayoutProbe;
    console.log('GND layout ' + mapId + ': ' + (layoutProbe && layoutProbe.available
      ? layoutProbe.version + ', slices=' + layoutProbe.lightmapHeader.count
        + ', confirmed 40-byte candidates='
        + layoutProbe.legacy.exactTailCandidates.filter(candidate => candidate.stride === 40).length
      : layoutProbe && layoutProbe.reason || 'unavailable'));
    if (!manifest.available) {
      report.status = 'skipped';
      report.reason = 'No usable public map manifest: ' + manifest.reason;
    } else {
      const work = async () => {
        browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl',
            '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
        });
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.setDefaultNavigationTimeout(20000);
        page.on('pageerror', error => {
          if (report.pageErrors.length < 20) report.pageErrors.push(String(error));
        });
        await page.route('https://visuais.latam-tools.com.br/**', route => route.abort());

        const params = new URLSearchParams({
          mode: 'native',
          map: mapId,
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
          'roo-gnd-gpu-audit': '1',
          'roo-gnd-gpu-audit-only': '1',
        });
        await page.goto(baseUrl + '/tools/ro_explorer.html?' + params.toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.locator('#native-toolbar').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('#gnd-debug-mode').waitFor({ state: 'visible', timeout: 5000 });

        try {
          await page.waitForFunction(map => {
            const status = document.getElementById('status')?.textContent || '';
            const stats = document.getElementById('stats')?.textContent || '';
            return (status.includes('原生地圖已載入') && stats.includes('GAT：' + map + '.gat'))
              || status.includes('公開原生地圖載入失敗');
          }, mapId, { timeout: 40000 });
        } catch (error) {
          report.diagnostics = await page.evaluate(() => ({
            status: document.getElementById('status')?.textContent || '',
            stats: document.getElementById('stats')?.textContent || '',
          })).catch(() => ({ status: 'Could not read page state', stats: '' }));
          report.status = 'skipped';
          report.reason = 'Map did not finish loading within 40 seconds: ' + String(error);
          return;
        }

        report.diagnostics = await page.evaluate(() => ({
          status: document.getElementById('status')?.textContent || '',
          stats: document.getElementById('stats')?.textContent || '',
          stage: (() => {
            const element = document.getElementById('stage');
            const rect = element && element.getBoundingClientRect();
            return rect ? { width: rect.width, height: rect.height } : null;
          })(),
        }));
        if (!report.diagnostics.status.includes('原生地圖已載入')) {
          report.status = 'skipped';
          report.reason = 'Map loader reported failure: ' + report.diagnostics.status;
          return;
        }

        try {
          await page.waitForFunction(() => {
            const stats = document.getElementById('stats')?.textContent || '';
            const match = stats.match(/GND 地表貼圖：已解析 (\d+)\/(\d+)；載入成功 (\d+)；失敗 (\d+)；缺少匹配 (\d+)/);
            return match && Number(match[1]) > 0 && Number(match[3]) > 0;
          }, null, { timeout: 20000 });
        } catch (error) {
          report.diagnostics.statsAfterTextureWait = await page.locator('#stats').innerText().catch(() => '');
          report.status = 'skipped';
          report.reason = 'Ground textures did not finish loading within 20 seconds: ' + String(error);
          return;
        }

        await page.waitForFunction(() => typeof window.__rooGndGpuBoundaryAudit?.run === 'function',
          null, { timeout: 8000 });
        const shotPath = path.join(artifactDir, mapId + '-scene.png');
        await page.screenshot({ path: shotPath, fullPage: false, animations: 'disabled', timeout: 10000 });
        report.screenshot = path.basename(shotPath);

        const auditDeadline = Date.now() + 35000;
        let audit = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          const remaining = auditDeadline - Date.now();
          if (remaining <= 0) throw new Error('GPU audit exceeded the 35-second audit budget');
          audit = await withTimeout(
            page.evaluate(() => window.__rooGndGpuBoundaryAudit.run()),
            Math.min(remaining, 12000),
            mapId + ' GPU audit evaluation'
          );
          if (!audit || audit.status !== 'pending') break;
          await sleep(Math.min(350, Math.max(0, auditDeadline - Date.now())));
        }
        report.audit = audit;
        report.validationFailures = validateAuditReport(mapId, audit);
        if (report.validationFailures.length) {
          report.status = 'failed';
          report.reason = report.validationFailures[0];
        } else {
          const baselineMaps = new Set(['icecastle', 'prontera', 'tra_fild']);
          if (!baselineMaps.has(mapId)) {
            report.reason = 'Multi-scale GPU boundary audit passed with nonzero RGB lightmap and joint AO contrast';
          } else if (mapId === 'icecastle') {
            report.reason = 'Multi-scale GPU boundary audit passed; nonzero RGB lightmap source-to-GPU checks passed';
          } else {
            report.reason = 'Multi-scale GPU boundary audit passed for source/GPU channels and AO contrast; this control map does not require nonzero edge RGB lightmap';
          }
          report.status = 'passed';
        }
      };

      await withTimeout(work(), mapTimeoutMs, mapId + ' end-to-end diagnostic');
    }
  } catch (error) {
    if (report.status === 'started') report.status = 'failed';
    report.reason = String(error);
  } finally {
    if (browser) {
      try {
        await withTimeout(browser.close(), 6000, 'Close Chromium for ' + mapId);
      } catch (error) {
        report.cleanupWarning = String(error);
      }
    }
    report.durationMs = Date.now() - started;
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(artifactDir, mapId + '.json'), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

function makeMarkdownSummary(reports) {
  const rows = reports.map(report => '| ' + report.mapId + ' | ' + report.status + ' | '
    + (report.durationMs || 0) + ' ms | ' + String(report.reason || '').replaceAll('|', '\\|').replaceAll('\n', ' ') + ' |');
  const passed = reports.filter(report => report.status === 'passed').length;
  const failed = reports.filter(report => report.status === 'failed').length;
  const skipped = reports.filter(report => report.status === 'skipped').length;
  return [
    '# ROO Multi-map GND GPU diagnostics',
    '',
    '- Requested maps: ' + maps.join(', '),
    '- Control maps (icecastle/prontera/tra_fild) validate the core GPU path; extra candidate maps additionally require nonzero RGB lightmap and joint AO contrast.',
    '- Passed: ' + passed + '; failed: ' + failed + '; skipped: ' + skipped,
    '- Per-map time budget: ' + mapTimeoutMs + ' ms',
    '- Main regression requirements remain strict for tra_fild, prontera and icecastle.',
    '',
    '| Map | Result | Duration | Details |',
    '|---|---|---:|---|',
    ...rows,
    '',
    'A skipped candidate map may have an unavailable manifest, an unsupported GND layout, or a source-service timeout; see its JSON report for the exact reason.',
    'Full source-channel/GPU reports and scene screenshots are in the workflow artifacts.',
    '',
  ].join('\n');
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  if (maps.length === 0) throw new Error('No map ids supplied.');
  if (maps.length > maxMaps) throw new Error('At most ' + maxMaps + ' maps are allowed per diagnostic run.');
  for (const mapId of maps) {
    if (!allowedMaps.has(mapId)) {
      throw new Error('Map id is not allow-listed for this optional diagnostic: ' + mapId);
    }
  }
  await waitForServer();

  const reports = [];
  for (const mapId of maps) {
    console.log('Starting isolated GND GPU diagnostic for ' + mapId + ' (limit ' + mapTimeoutMs + ' ms).');
    const report = await auditMap(mapId);
    reports.push(report);
    console.log('Completed ' + mapId + ': ' + report.status + ' — ' + (report.reason || 'no detail'));
    await writeFile(path.join(artifactDir, 'summary.md'), makeMarkdownSummary(reports));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    requestedMaps: maps,
    timeoutMsPerMap: mapTimeoutMs,
    reports,
    counts: {
      passed: reports.filter(report => report.status === 'passed').length,
      failed: reports.filter(report => report.status === 'failed').length,
      skipped: reports.filter(report => report.status === 'skipped').length,
    },
  };
  await writeFile(path.join(artifactDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  await writeFile(path.join(artifactDir, 'summary.md'), makeMarkdownSummary(reports));
  console.log('GND multi-map GPU diagnostic summary: ' + JSON.stringify(summary.counts));
  if (summary.counts.failed > 0 || summary.counts.passed === 0) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  await mkdir(artifactDir, { recursive: true }).catch(() => {});
  const fatal = {
    status: 'failed-to-start',
    error: String(error),
    maps,
    timeoutMsPerMap: mapTimeoutMs,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(path.join(artifactDir, 'summary.json'), JSON.stringify(fatal, null, 2) + '\n').catch(() => {});
  await writeFile(path.join(artifactDir, 'summary.md'),
    '# ROO Multi-map GND GPU diagnostics\n\n**Failed to start:** ' + String(error) + '\n').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
}
