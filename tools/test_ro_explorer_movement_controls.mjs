import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explorer = fs.readFileSync(path.join(root, 'tools/ro_explorer.mjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tools/ro_explorer.html'), 'utf8');

assert.match(html, /id="stop-movement"[^>]*hidden[^>]*>停止移動／接近</,
  '探索工具列提供可收合的停止移動按鈕');
assert.match(html, /#stop-movement\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
  '無路徑時按鈕不佔畫面');

assert.match(explorer,
  /function updateRoExplorerMovementControls\(\)[\s\S]*?movementPath\.length > 1[\s\S]*?stopMovementButton\.hidden = !canStop/,
  '只在存在有效移動路徑時顯示停止按鈕');
assert.match(explorer,
  /function stopRoExplorerMovement\(\)[\s\S]*?roMapCellFromWorldPoint[\s\S]*?isRoMapCellWalkable[\s\S]*?movementPath = null;[\s\S]*?pathIndex = 1;[\s\S]*?queuedCombatSkill = null;[\s\S]*?stopRoExplorerCombat\(false\);[\s\S]*?savePosition\(\);[\s\S]*?setPlayerMotion\('idle'/,
  '停止時吸附到可走格、取消接近／排隊技能並保存位置');
assert.match(explorer,
  /stopMovementButton\.addEventListener\('click', stopRoExplorerMovement\)/,
  '按鈕連接至停止移動處理流程');
assert.match(explorer,
  /function requestWalkToCell\(requestedTarget\)[\s\S]*?movementPath = path;/,
  '原本的點擊尋路流程仍然建立移動路徑');

console.log('原生探索停止移動／接近測試通過。');
