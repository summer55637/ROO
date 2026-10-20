import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRoExplorerCombatFeedback } from './ro_explorer_feedback.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explorer = fs.readFileSync(path.join(root, 'tools/ro_explorer.mjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tools/ro_explorer.html'), 'utf8');

assert.deepEqual(buildRoExplorerCombatFeedback(12345, 'attack'),
  { text: '12,345', kind: 'attack', durationMs: 820 });
assert.deepEqual(buildRoExplorerCombatFeedback(8765, 'skill'),
  { text: '8,765', kind: 'skill', durationMs: 1000 });
assert.deepEqual(buildRoExplorerCombatFeedback(37, 'dot'),
  { text: '37', kind: 'dot', durationMs: 900 });
assert.deepEqual(buildRoExplorerCombatFeedback(0, 'attack'),
  { text: 'MISS', kind: 'miss', durationMs: 720 });
assert.equal(buildRoExplorerCombatFeedback(undefined, 'attack'), null);
assert.equal(buildRoExplorerCombatFeedback(-1, 'skill'), null);

assert.match(html, /id="combat-feedback-layer"/,
  '探索場景有獨立的跳字顯示層');
assert.match(explorer,
  /function showRoExplorerCombatFeedback\(entry, damage, action\)[\s\S]*?buildRoExplorerCombatFeedback\(damage, action\)[\s\S]*?combatFeedbackEntries\.add/,
  '建立跳字時使用安全的傷害顯示資料');
assert.match(explorer,
  /if \(result\.accepted\) showRoExplorerCombatFeedback\(entry, result\.damageDealt, request\.action === 'skill' \? 'skill' : 'attack'\)/,
  '普攻與主動技能成功時顯示傷害');
assert.match(explorer,
  /if \(result\.accepted && Number\(result\.damageDealt\) > 0\) showRoExplorerCombatFeedback\(entry, result\.damageDealt, 'dot'\)/,
  '中毒與出血跳傷成功時顯示傷害');
assert.match(explorer,
  /function updateRoExplorerCombatFeedback\(now\)[\s\S]*?worldPosition\.clone\(\)\.project\(camera\)/,
  '跳字跟隨攝影機投影到 3D 場景畫面');
assert.match(explorer, /updateRoExplorerCombatFeedback\(now\)/,
  '每個可見影格更新跳字位置與存活時間');

console.log('原生探索戰鬥傷害跳字測試通過。');
