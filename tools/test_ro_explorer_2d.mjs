import assert from 'node:assert/strict';
import {
  projectRoExplorer2DPoint,
  unprojectRoExplorer2DPoint,
  createRoExplorer2DAffineTransform,
  transformRoExplorer2DPoint,
  getRoExplorer2DViewportRadius,
  isRoExplorer2DPointVisible,
} from './ro_explorer_2d.mjs';

const center = { x: 13.5, y: -0.4, z: -22.25 };
const point = { x: 18.5, y: -0.2, z: -16.25 };
const projected = projectRoExplorer2DPoint(point, center, 800, 480, 8);
assert.ok(Math.abs(projected.x - 488) < 1e-9);
assert.ok(Math.abs(projected.y - 234.4) < 1e-9);
const roundTrip = unprojectRoExplorer2DPoint(
  projected.x, projected.y, center, 800, 480, 8, point.y
);
assert.ok(Math.abs(roundTrip.x - point.x) < 1e-9);
assert.ok(Math.abs(roundTrip.z - point.z) < 1e-9);

const source = [{ x: 10, y: 20 }, { x: 210, y: 25 }, { x: 18, y: 220 }];
const target = [{ x: 35, y: 42 }, { x: 260, y: 65 }, { x: 48, y: 270 }];
const matrix = createRoExplorer2DAffineTransform(source, target);
assert.ok(matrix && matrix.length === 6);
target.forEach((expected, index) => {
  const actual = transformRoExplorer2DPoint(matrix, source[index]);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-8);
});
assert.equal(createRoExplorer2DAffineTransform(
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
  target
), null, '退化的來源三角形應拒絕 UV 映射');

const radius = getRoExplorer2DViewportRadius(800, 480);
assert.deepEqual(radius, { x: 29, z: 34 });
assert.equal(isRoExplorer2DPointVisible({ x: 10, y: 20 }, 800, 480), true);
assert.equal(isRoExplorer2DPointVisible({ x: -100, y: 20 }, 800, 480), false);
assert.throws(() => projectRoExplorer2DPoint(point, center, 0, 480, 8), /有效的世界座標/);
console.log('ROO 2D 等角投影、點擊反投影與來源貼圖三角形映射測試通過。');
