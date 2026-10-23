import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./ro_explorer_bootstrap.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('./ro_explorer.html', import.meta.url), 'utf8');
const explorerModuleSource = readFileSync(new URL('./ro_explorer.mjs', import.meta.url), 'utf8');
const gameUiSource = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const pathfindingScriptIndex = htmlSource.indexOf('<script src="../js/map_pathfinding.js"></script>');
const bootstrapScriptIndex = htmlSource.indexOf('<script src="./ro_explorer_bootstrap.js"></script>');
assert.ok(pathfindingScriptIndex >= 0 && bootstrapScriptIndex > pathfindingScriptIndex,
  '獨立探索頁必須先載入共用 GAT/A* 尋路，再啟動原生探索模組。');
const ids = [
  'public-mode', 'local-mode', 'show-public', 'show-native', 'show-local',
  'native-toolbar', 'local-toolbar', 'status',
];

function createHarness(search = '') {
  const elements = new Map(ids.map(id => {
    const element = {
      id,
      hidden: id === 'local-mode' || id === 'native-toolbar',
      attributes: {},
      listeners: {},
      classList: { add() {} },
      textContent: '',
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
    };
    if (id === 'local-toolbar') element.hidden = false;
    return [id, element];
  }));
  const scripts = [];
  const events = [];
  const document = {
    getElementById(id) { return elements.get(id); },
    createElement(tag) { return { tag, type: '', src: '', onload: null, onerror: null }; },
    body: { appendChild(script) { scripts.push(script); } },
  };
  class TestCustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const window = {
    location: { search },
    dispatchEvent(event) { events.push(event); return true; },
  };
  vm.runInNewContext(source, { document, window, URLSearchParams, CustomEvent: TestCustomEvent });
  return { elements, scripts, events };
}

const defaultView = createHarness('');
assert.equal(defaultView.elements.get('public-mode').hidden, false);
assert.equal(defaultView.elements.get('local-mode').hidden, true);
assert.equal(defaultView.scripts.length, 0);

const nativeView = createHarness('?mode=native&map=prontera');
assert.equal(nativeView.elements.get('public-mode').hidden, true);
assert.equal(nativeView.elements.get('local-mode').hidden, false);
assert.equal(nativeView.elements.get('native-toolbar').hidden, false);
assert.equal(nativeView.elements.get('local-toolbar').hidden, true);
assert.equal(nativeView.elements.get('show-native').attributes['aria-pressed'], 'true');
assert.equal(nativeView.scripts.length, 1);
assert.equal(nativeView.scripts[0].src, './ro_explorer.mjs');
nativeView.scripts[0].onload();
assert.equal(nativeView.events.length, 1);
assert.equal(nativeView.events[0].type, 'roo-explorer-mode');
assert.equal(nativeView.events[0].detail, 'native');

nativeView.elements.get('show-public').listeners.click();
assert.equal(nativeView.elements.get('public-mode').hidden, false);
assert.equal(nativeView.elements.get('local-mode').hidden, true);

const invalidMode = createHarness('?mode=unknown');
assert.equal(invalidMode.elements.get('public-mode').hidden, false);
assert.equal(invalidMode.scripts.length, 0);

const direct2DView = createHarness('?view=2d&map=tra_fild');
assert.equal(direct2DView.elements.get('public-mode').hidden, true,
  'view=2d 應直接離開公開預覽');
assert.equal(direct2DView.elements.get('local-mode').hidden, false);
assert.equal(direct2DView.elements.get('native-toolbar').hidden, false,
  'view=2d 應顯示原生地圖工具列，而非要求使用者先切換模式');
assert.equal(direct2DView.elements.get('local-toolbar').hidden, true);
assert.equal(direct2DView.elements.get('show-native').attributes['aria-pressed'], 'true');
assert.equal(direct2DView.scripts.length, 1,
  'view=2d 應自動載入支援 GND/GAT 的探索模組');
direct2DView.scripts[0].onload();
assert.equal(direct2DView.events[0].detail, 'native',
  'view=2d 應以原生地圖資料啟動，載入完成後才能切 Canvas 2D');

assert.ok(explorerModuleSource.includes(
  "const requestedRoExplorer2D = explorerParams.get('view') === '2d';"));
assert.ok(explorerModuleSource.includes(
  'if (requestedRoExplorer2D) setRoExplorer2DActive(true);'),
  'GND/GAT 地圖成功載入後應自動顯示 Canvas 2D');
assert.ok(gameUiSource.includes("function openRoExplorer(view = '3d')"));
assert.ok(gameUiSource.includes("openRoExplorer('2d')"),
  '主遊戲地圖分頁必須提供直接進入純 2D 的入口');
assert.ok(gameUiSource.includes("url.searchParams.set('view', '2d')"),
  '主遊戲 2D 入口必須帶入可重開的網址參數');

// Tutorial/test maps do not have native RO GND/GAT files; map the visual asset
// separately while preserving the logical map ID used by combat validation.
const aliasStart = gameUiSource.indexOf('const RO_EXPLORER_NATIVE_MAP_FALLBACKS = Object.freeze({');
const aliasEnd = gameUiSource.indexOf('function openRoExplorer(view = \'3d\')', aliasStart);
assert.ok(aliasStart >= 0 && aliasEnd > aliasStart, '主遊戲必須提供可測試的原生地圖素材對應表。');
const aliasResolver = vm.runInNewContext(
  gameUiSource.slice(aliasStart, aliasEnd) + String.fromCharCode(10) + 'resolveRoExplorerNativeMapId;',
  {},
);
assert.equal(aliasResolver('novice_safe'), 'prontera');
assert.equal(aliasResolver('novice_ground'), 'prt_fild08');
assert.equal(aliasResolver('test_arena'), 'prt_fild08');
assert.equal(aliasResolver('tra_fild'), 'tra_fild');
assert.equal(aliasResolver('prontera'), 'prontera');
assert.ok(gameUiSource.includes("url.searchParams.set('nativeMap', nativeMapId)"),
  '素材地圖必須使用獨立 nativeMap 參數，不能覆蓋遊戲邏輯地圖。');
assert.ok(explorerModuleSource.includes("const requestedMap = requestedNativeMap || requestedGameMap;"),
  '探索端必須先載入獨立原生素材地圖。');
assert.ok(explorerModuleSource.includes("explorerParams.get('map') || '').trim().toLowerCase()"),
  '戰鬥橋接仍必須沿用遊戲邏輯 map 參數。');
assert.ok(gameUiSource.includes("openRoExplorer('3d')"),
  '原生 3D／地圖診斷入口必須保留');

console.log('RO 地圖探索直接入口（含純 2D 網址參數）測試通過。');
