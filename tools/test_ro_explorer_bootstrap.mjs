import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./ro_explorer_bootstrap.js', import.meta.url), 'utf8');
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

console.log('RO 地圖探索直接入口測試通過。');
