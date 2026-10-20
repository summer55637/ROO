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
const uiTypes = extractTypes(ui, /const explorerSkillTypes = new Set\(\[([\s\S]*?)\]\);/, '主遊戲入口');
const explorerTypes = extractTypes(explorer,
  /const RO_EXPLORER_SUPPORTED_SKILL_TYPES = new Set\(\[([\s\S]*?)\]\);/, '探索頁');
const engineTypes = extractTypes(engine,
  /const RO_EXPLORER_SUPPORTED_SKILL_TYPES = new Set\(\[([\s\S]*?)\]\);/, '主引擎');
const uiSupportTypes = extractTypes(ui,
  /const supportSkillTypes = new Set\(\[([\s\S]*?)\]\);/, '主遊戲恢復／輔助');
const explorerSupportTypes = extractTypes(explorer,
  /const RO_EXPLORER_SUPPORT_SKILL_TYPES = new Set\(\[([\s\S]*?)\]\);/, '探索頁恢復／輔助');
const engineSupportTypes = extractTypes(engine,
  /const RO_EXPLORER_SUPPORT_SKILL_TYPES = new Set\(\[([\s\S]*?)\]\);/, '主引擎恢復／輔助');
const uiSelfBuffTypes = extractTypes(ui,
  /const selfBuffSkillTypes = new Set\(\[([\s\S]*?)\]\);/, '主遊戲自身增益');
const explorerSelfBuffTypes = extractTypes(explorer,
  /const RO_EXPLORER_SELF_BUFF_TYPES = new Set\(\[([\s\S]*?)\]\);/, '探索頁自身增益');
const engineSelfBuffTypes = extractTypes(engine,
  /const RO_EXPLORER_SELF_BUFF_TYPES = new Set\(\[([\s\S]*?)\]\);/, '主引擎自身增益');

assert.ok(uiTypes.has('poison_proc'), '主遊戲入口會傳入施毒類型');
assert.ok(explorerTypes.has('poison_proc'), '探索頁會接受施毒類型');
assert.ok(engineTypes.has('poison_proc'), '引擎會結算施毒類型');
for (const type of explorerTypes) {
  assert.ok(uiTypes.has(type), '主遊戲入口涵蓋探索頁類型：' + type);
  assert.ok(engineTypes.has(type), '主引擎涵蓋探索頁類型：' + type);
}
assert.match(ui, /searchParams\.set\('skills',\s*JSON\.stringify\(combatSkills\)\)/,
  '主遊戲會把技能清單送入探索網址');
for (const type of explorerSelfBuffTypes) {
  assert.ok(uiSelfBuffTypes.has(type), '主遊戲會標記自身增益：' + type);
  assert.ok(engineSelfBuffTypes.has(type), '主引擎會辨識自身增益：' + type);
}
for (const type of uiSelfBuffTypes) {
  assert.ok(explorerSelfBuffTypes.has(type), '探索頁自身增益清單同步：' + type);
}
for (const type of engineSelfBuffTypes) {
  assert.ok(explorerTypes.has(type), '主引擎自身增益受探索目錄允許：' + type);
}
for (const type of explorerSupportTypes) {
  assert.ok(uiSupportTypes.has(type), '主遊戲入口會傳入恢復／輔助類型：' + type);
  assert.ok(engineSupportTypes.has(type), '主引擎支援恢復／輔助類型：' + type);
}
for (const type of uiSupportTypes) {
  assert.ok(explorerSupportTypes.has(type), '探索頁恢復／輔助清單同步：' + type);
}
for (const type of engineSupportTypes) {
  assert.ok(uiSupportTypes.has(type), '主引擎恢復／輔助清單同步到入口：' + type);
}
for (const type of [
  'heal', 'field_heal', 'cure', 'buff_sprate', 'buff_blessing', 'buff_angelus',
  'buff_shield', 'buff_lukflat', 'buff_holyweapon', 'buff_elearmor', 'buff_ailimmune',
]) {
  assert.ok(explorerSupportTypes.has(type), '關鍵恢復／輔助類型已接通：' + type);
}
assert.match(ui, /isSupport: supportSkillTypes\.has\(entry\.sk\.type\)/,
  '主遊戲將恢復／輔助技能分流傳入探索頁');
assert.match(explorer, /isSupport: RO_EXPLORER_SUPPORT_SKILL_TYPES\.has\(skill\.type\)/,
  '探索頁會辨識恢復／輔助技能');
assert.match(ui, /searchParams\.set\('skills',\s*JSON\.stringify\(combatSkills\)\)/,
  '主遊戲會把技能清單送入探索網址');
assert.match(ui, /isSelfBuff: selfBuffSkillTypes\.has\(entry\.sk\.type\)/,
  '主遊戲會將自身增益標記傳入探索頁');
assert.match(explorer, /isSelfBuff: RO_EXPLORER_SELF_BUFF_TYPES\.has\(skill\.type\)/,
  '探索頁會辨識自身增益技能');
console.log('原生探索攻擊／自身增益技能目錄接線測試通過。');
