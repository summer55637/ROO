import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRoExplorerCameraSnapshot,
  resolveRoExplorerCameraSnapshot,
} from './ro_explorer_camera.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explorer = fs.readFileSync(path.join(root, 'tools/ro_explorer.mjs'), 'utf8');

const snapshot = buildRoExplorerCameraSnapshot(
  { x: 17, y: 15, z: 17 },
  { x: 1, y: 2, z: 3 },
  20
);
assert.equal(snapshot.version, 1);
const restored = resolveRoExplorerCameraSnapshot(snapshot, 40);
assert.ok(Math.abs(restored.position.x - 34) < 0.001);
assert.ok(Math.abs(restored.position.y - 30) < 0.001);
assert.ok(Math.abs(restored.position.z - 34) < 0.001);
assert.ok(Math.abs(restored.target.x - 2) < 0.001);
assert.ok(Math.abs(restored.target.y - 4) < 0.001);
assert.ok(Math.abs(restored.target.z - 6) < 0.001);

assert.equal(buildRoExplorerCameraSnapshot(null, { x: 0, y: 0, z: 0 }, 20), null);
assert.equal(buildRoExplorerCameraSnapshot({ x: NaN, y: 1, z: 1 }, { x: 0, y: 0, z: 0 }, 20), null);
assert.equal(buildRoExplorerCameraSnapshot({ x: 10, y: 10, z: 10 }, { x: 10, y: 10, z: 10 }, 20), null);
assert.equal(buildRoExplorerCameraSnapshot({ x: 100000, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 20), null);
assert.equal(resolveRoExplorerCameraSnapshot({ ...snapshot, version: 2 }, 40), null);
assert.equal(resolveRoExplorerCameraSnapshot({ version: 1, position: [1000, 0, 0], target: [0, 0, 0] }, 40), null);
assert.equal(resolveRoExplorerCameraSnapshot(snapshot, 0), null);

assert.match(explorer, /import \{\s*buildRoExplorerCameraSnapshot,\s*resolveRoExplorerCameraSnapshot,\s*\} from '\.\/ro_explorer_camera\.mjs';/,
  '探索頁使用視角狀態模組');
assert.match(explorer, /function saveCameraView\(\)[\s\S]*?localStorage\.setItem\(RO_EXPLORER_CAMERA_STORAGE_PREFIX \+ mapInfo\.mapId/,
  '視角按地圖 ID 存入本機');
assert.match(explorer, /controls\.addEventListener\('end', saveCameraView\)/,
  '使用者操作結束後保存視角');
assert.match(explorer, /window\.addEventListener\('pagehide', saveCameraView\)/,
  '離開頁面前保存視角');
assert.match(explorer, /function fitCamera\(restoreSaved = true\)[\s\S]*?if \(restoreSaved\) restoreCameraView\(maxDimension\)/,
  '重新載入相同地圖時恢復有效視角');
assert.match(explorer, /getElementById\('recenter'\)\.addEventListener\('click', \(\) => \{\s*fitCamera\(false\);/,
  '重置視角會覆蓋舊的本機視角');

console.log('原生探索視角本機保存測試通過。');
