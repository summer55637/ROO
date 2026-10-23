import assert from 'node:assert/strict';
import {
  buildRoExplorerMinimapPixels,
  getRoExplorerMinimapSize,
  mapRoExplorerCellToMinimap,
  mapRoExplorerMinimapPointToCell,
} from './ro_explorer_minimap.mjs';

assert.deepEqual(getRoExplorerMinimapSize(196, 196), { width: 196, height: 196 });
assert.deepEqual(getRoExplorerMinimapSize(624, 784), { width: 156, height: 196 });
assert.deepEqual(getRoExplorerMinimapSize(4, 2, 100), { width: 100, height: 50 });
assert.throws(() => getRoExplorerMinimapSize(0, 12), RangeError);

const gat = {
  width: 2,
  height: 2,
  walkable: Uint8Array.from([1, 0, 0, 0]),
  water: Uint8Array.from([0, 1, 0, 0]),
  terrainTypes: Uint16Array.from([0, 0, 5, 1]),
};
const pixels = buildRoExplorerMinimapPixels(gat, 2, 2);
const colorAt = (x, y) => Array.from(pixels.slice((y * 2 + x) * 4, (y * 2 + x) * 4 + 4));
assert.deepEqual(colorAt(0, 0), [62, 119, 77, 255]);
assert.deepEqual(colorAt(1, 0), [70, 145, 207, 255]);
assert.deepEqual(colorAt(0, 1), [190, 136, 70, 255]);
assert.deepEqual(colorAt(1, 1), [87, 63, 75, 255]);
assert.throws(() => buildRoExplorerMinimapPixels({ width: 2, height: 2, walkable: [1] }, 2, 2), TypeError);

assert.deepEqual(mapRoExplorerCellToMinimap({ x: 0, y: 0 }, 10, 8, 100, 80), { x: 5, y: 5 });
assert.deepEqual(mapRoExplorerCellToMinimap({ x: 9, y: 7 }, 10, 8, 100, 80), { x: 95, y: 75 });
assert.equal(mapRoExplorerCellToMinimap({ x: 10, y: 0 }, 10, 8, 100, 80), null);
assert.equal(mapRoExplorerCellToMinimap(null, 10, 8, 100, 80), null);
assert.deepEqual(mapRoExplorerMinimapPointToCell(0, 0, 10, 8), { x: 0, y: 0 });
assert.deepEqual(mapRoExplorerMinimapPointToCell(0.55, 0.625, 10, 8), { x: 5, y: 5 });
assert.deepEqual(mapRoExplorerMinimapPointToCell(1, 1, 10, 8), { x: 9, y: 7 });
assert.equal(mapRoExplorerMinimapPointToCell(-0.01, 0.5, 10, 8), null);
assert.equal(mapRoExplorerMinimapPointToCell(0.5, 1.01, 10, 8), null);
assert.throws(() => mapRoExplorerMinimapPointToCell(0.5, 0.5, 0, 8), RangeError);

console.log('探索小地圖測試通過：比例、地形色彩、顯示與點擊座標。');
