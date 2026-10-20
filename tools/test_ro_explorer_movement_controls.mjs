import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explorer = fs.readFileSync(path.join(root, 'tools/ro_explorer.mjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tools/ro_explorer.html'), 'utf8');

const localToolbarStart = html.indexOf('<div id="local-toolbar"');
const movementToolbarStart = html.indexOf('<div id="movement-toolbar"');
const stageStart = html.indexOf('<div id="stage"');
const stopPosition = html.indexOf('<button id="stop-movement"');
assert.ok(localToolbarStart >= 0 && movementToolbarStart > localToolbarStart
  && stopPosition > movementToolbarStart && stopPosition < stageStart,
  '共用探索操作列需包含唯一停止移動按鈕，且位於 3D 舞台外');
assert.ok(['move-speed', 'show-cells', 'show-minimap', 'follow-player', 'recenter']
  .every(id => html.indexOf('id="' + id + '"') > movementToolbarStart
    && html.indexOf('id="' + id + '"') < stageStart),
  '速度、通行格、小地圖、跟隨視角與重置視角都放在共用操作列');
assert.match(html, /#stop-movement\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
  '無路徑時停止移動按鈕不佔畫面');

assert.match(explorer,
  /function updateRoExplorerMovementControls\(\)[\s\S]*?movementPath\.length > 1[\s\S]*?stopMovementButton\.hidden = !canStop/,
  '只在存在有效移動路徑時顯示停止按鈕');
assert.match(explorer,
  /function stopRoExplorerMovement\(\)[\s\S]*?roMapCellFromWorldPoint[\s\S]*?isRoMapCellWalkable[\s\S]*?movementPath = null;[\s\S]*?pathIndex = 1;[\s\S]*?queuedCombatSkill = null;[\s\S]*?stopRoExplorerCombat\(false\);[\s\S]*?savePosition\(\);[\s\S]*?setPlayerMotion\('idle'/,
  '停止時吸附到可走格、取消接近／排隊技能並保存位置');
assert.match(explorer,
  /stopMovementButton\.addEventListener\('click', stopRoExplorerMovement\)/,
  '共用操作列按鈕連接至停止移動處理流程');
assert.match(explorer,
  /function requestWalkToCell\(requestedTarget\)[\s\S]*?movementPath = path;/,
  '原本的點擊尋路流程仍然建立移動路徑');

console.log('原生探索停止移動／接近測試通過。');
