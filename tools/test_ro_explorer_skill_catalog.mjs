import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
function extractTypes(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, label + '技能允許清單存在');
  return new Set(Array.from(match[1].matchAll(/'([a-z][a-z0-9_]*)'/g), item => item[1]));
}

const ui = read('js/ui.js');
const explorer = read('tools/ro_explorer.mjs');
const engine = read('js/engine.js');
const uiTypes = extractTypes(ui, /const directSkillTypes = new Set\(\[([\s\S]*?)\]\);/, '主遊戲入口');
const explorerTypes = extractTypes(explorer,
  /const RO_EXPLORER_DIRECT_SKILL_TYPES = new Set\(\[([\s\S]*?)\]\);/, '探索頁');
const engineTypes = extractTypes(engine, /const directAttackTypes = \[([\s\S]*?)\];/, '主引擎');

assert.ok(uiTypes.has('poison_proc'), '主遊戲入口會傳入施毒類型');
assert.ok(explorerTypes.has('poison_proc'), '探索頁會接受施毒類型');
assert.ok(engineTypes.has('poison_proc'), '引擎會結算施毒類型');
for (const type of explorerTypes) {
  assert.ok(uiTypes.has(type), '主遊戲入口涵蓋探索頁類型：' + type);
  assert.ok(engineTypes.has(type), '主引擎涵蓋探索頁類型：' + type);
}
assert.match(ui, /searchParams\.set\('skills',\s*JSON\.stringify\(combatSkills\)\)/,
  '主遊戲會把技能清單送入探索網址');
console.log('原生探索技能目錄接線測試通過：主遊戲入口、探索頁與主引擎類型一致。');
