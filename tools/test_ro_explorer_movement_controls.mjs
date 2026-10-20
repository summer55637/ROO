import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explorer = fs.readFileSync(path.join(root, 'tools/ro_explorer.mjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tools/ro_explorer.html'), 'utf8');

const nativeToolbarStart = html.indexOf('<div id="native-toolbar"');
const localToolbarStart = html.indexOf('<div id="local-toolbar"');
const stageStart = html.indexOf('<div id="stage"');
const nativeStopPosition = html.indexOf('<button id="stop-movement"');
const localStopPosition = html.indexOf('<button id="stop-movement-local"');
assert.ok(nativeToolbarStart >= 0 && nativeStopPosition > nativeToolbarStart
  && nativeStopPosition < localToolbarStart,
  '原生工具列必須有獨立的停止移動按鈕');
assert.ok(localStopPosition > localToolbarStart && localStopPosition < stageStart,
  '本機 GLB/GAT 工具列保留自己的停止移動按鈕');
assert.match(html, /#stop-movement\[hidden\],\s*#stop-movement-local\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
  '無路徑時兩種模式的按鈕都不佔畫面');

assert.match(explorer,
  /function updateRoExplorerMovementControls\(\)[\s\S]*?movementPath\.length > 1[\s\S]*?stopMovementButtons\.forEach\(button => \{ button\.hidden = !canStop; \}\)/,
  '只在存在有效移動路徑時顯示目前模式的停止按鈕');
assert.match(explorer,
  /function stopRoExplorerMovement\(\)[\s\S]*?roMapCellFromWorldPoint[\s\S]*?isRoMapCellWalkable[\s\S]*?movementPath = null;[\s\S]*?pathIndex = 1;[\s\S]*?queuedCombatSkill = null;[\s\S]*?stopRoExplorerCombat\(false\);[\s\S]*?savePosition\(\);[\s\S]*?setPlayerMotion\('idle'/,
  '停止時吸附到可走格、取消接近／排隊技能並保存位置');
assert.match(explorer,
  /stopMovementButtons\.forEach\(button => button\.addEventListener\('click', stopRoExplorerMovement\)\)/,
  '原生與本機模式的按鈕都連接至停止移動處理流程');
assert.match(explorer,
  /function requestWalkToCell\(requestedTarget\)[\s\S]*?movementPath = path;/,
  '原本的點擊尋路流程仍然建立移動路徑');

console.log('原生探索停止移動／接近測試通過。');
