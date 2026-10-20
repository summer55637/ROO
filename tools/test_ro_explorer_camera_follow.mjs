import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getRoExplorerCameraFollowDelta,
} from './ro_explorer_camera_follow.mjs';

const explorer = readFileSync(new URL('./ro_explorer.mjs', import.meta.url), 'utf8');
const html = readFileSync(new URL('./ro_explorer.html', import.meta.url), 'utf8');

assert.deepEqual(
  getRoExplorerCameraFollowDelta({ x: 1, y: 2, z: 3 }, { x: 4, y: 1, z: -2 }),
  { x: 3, y: -1, z: -5 },
  '相機跟隨位移保留角色每軸實際移動量'
);
assert.deepEqual(
  getRoExplorerCameraFollowDelta({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }),
  { x: 0, y: 0, z: 0 },
  '角色未移動時不產生相機偏移'
);
assert.equal(getRoExplorerCameraFollowDelta(null, { x: 0, y: 0, z: 0 }), null);
assert.equal(getRoExplorerCameraFollowDelta({ x: 0, y: Infinity, z: 0 }, { x: 1, y: 1, z: 1 }), null);
assert.equal(getRoExplorerCameraFollowDelta({ x: -Number.MAX_VALUE, y: 0, z: 0 }, { x: Number.MAX_VALUE, y: 0, z: 0 }), null);

assert.match(html, /id="follow-player" type="checkbox" checked>跟隨角色視角/,
  '預設啟用角色跟隨，可由玩家關閉');
assert.match(explorer, /import \{ getRoExplorerCameraFollowDelta \} from '\.\/ro_explorer_camera_follow\.mjs';/,
  '探索頁載入相機跟隨位移邏輯');
assert.match(explorer,
  /function syncFollowCamera\(previousPosition\)[\s\S]*?camera\.position\.x \+= delta\.x;[\s\S]*?controls\.target\.z \+= delta\.z;/,
  '跟隨時平移相機與觀察目標，維持角色畫面位置');
assert.match(explorer,
  /function advanceMovement\(deltaSeconds\)[\s\S]*?previousPlayerPosition = followPlayerInput\.checked[\s\S]*?syncFollowCamera\(previousPlayerPosition\)/,
  '角色行走逐幀推進相機');
assert.match(explorer,
  /function startAtSavedOrCenter\(\)[\s\S]*?if \(followPlayerInput\.checked\) focusCameraOnPlayer\(\)/,
  '載入地圖後相機聚焦已保存的角色位置');
assert.match(explorer,
  /followPlayerInput\.addEventListener\('change',[\s\S]*?focusCameraOnPlayer\(\)[\s\S]*?saveCameraView\(\)/,
  '可以即時切換跟隨與自由視角');

console.log('原生探索角色跟隨視角測試通過。');
