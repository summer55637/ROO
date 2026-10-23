import assert from 'node:assert/strict';
import {
  projectRoExplorer2DPoint,
  unprojectRoExplorer2DPoint,
  createRoExplorer2DAffineTransform,
  transformRoExplorer2DPoint,
  getRoExplorer2DViewportRadius,
  isRoExplorer2DPointVisible,
  drawRoExplorer2DGroundShadow,
  drawRoExplorer2DSelectionRing,
  buildRoExplorer2DFallbackProps,
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

const fallbackProps = buildRoExplorer2DFallbackProps([
  { name: 'named instance', modelName: 'field_tree01.rsm', position: [10, 2, -20] },
  { name: 'house instance', modelName: 'field_house01.rsm', position: [30, 4, 50] },
  { name: 'invalid placement', modelName: 'broken.rsm', position: [NaN, 0, 0] },
], [{ x: 2, y: -0.4, z: 4.0000001 }], 0.2);
assert.equal(fallbackProps.length, 1,
  'RSW 擺放有有效位置但 RSM 未載入時要補位；已渲染的同位置模型不得重複畫');
assert.equal(fallbackProps[0].name, 'field_house01.rsm');
assert.equal(fallbackProps[0].modelName, 'field_house01.rsm');
assert.equal(fallbackProps[0].fallback, true);
assert.deepEqual(fallbackProps[0].position, { x: 6, y: -0.8, z: -10 });
assert.equal(buildRoExplorer2DFallbackProps([
  { modelName: 'tree.rsm', position: [1, 2, 3] },
], [], 0).length, 0, '不合理世界比例不得產生代理物件');
assert.equal(buildRoExplorer2DFallbackProps([
  { modelName: 'tree.rsm', position: [1, 2, 3] },
], [], 1, 1).length, 1, '代理物件數不得超過指定擺放上限');



// Drawing helpers are exercised against a tiny recording canvas context so visual
// geometry and Canvas state cleanup remain regression-tested without a browser.
function recordingContext() {
  const events = [];
  return {
    events, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    save() { events.push({ type: 'save' }); },
    restore() { events.push({ type: 'restore' }); },
    beginPath() { events.push({ type: 'beginPath' }); },
    ellipse(...args) { events.push({ type: 'ellipse', args }); },
    fill() { events.push({ type: 'fill', style: this.fillStyle }); },
    stroke() { events.push({ type: 'stroke', style: this.strokeStyle, width: this.lineWidth }); },
  };
}
const shadowCanvas = recordingContext();
assert.equal(drawRoExplorer2DGroundShadow(shadowCanvas, 100, 200, 40), true);
assert.equal(shadowCanvas.events.filter(event => event.type === 'ellipse').length, 2,
  '有 RO 動畫的角色／怪物也應繪製雙層接觸陰影');
assert.deepEqual(shadowCanvas.events.filter(event => event.type === 'ellipse')[0].args,
  [100, 199, 15.2, 4.8, 0, 0, Math.PI * 2]);
assert.equal(shadowCanvas.events.filter(event => event.type === 'restore').length, 1,
  '繪製陰影後必須還原 Canvas 狀態');
assert.equal(drawRoExplorer2DGroundShadow(shadowCanvas, 100, 200, 0), false,
  '無效尺寸不得繪製陰影');

const ringCanvas = recordingContext();
assert.equal(drawRoExplorer2DSelectionRing(ringCanvas, 100, 200, 40), true);
const ringEllipses = ringCanvas.events.filter(event => event.type === 'ellipse');
assert.equal(ringEllipses.length, 2, '目標圈應有深色描邊與亮色核心，避免被地表吞沒');
assert.deepEqual(ringEllipses[0].args, [100, 201, 22.400000000000002, 6.4, 0, 0, Math.PI * 2]);
assert.deepEqual(ringCanvas.events.filter(event => event.type === 'stroke').map(event => event.style),
  ['rgba(5, 11, 8, 0.88)', 'rgba(255, 225, 138, 0.98)']);
assert.equal(ringCanvas.events.filter(event => event.type === 'restore').length, 1,
  '繪製目標圈後必須還原 Canvas 狀態');
assert.equal(drawRoExplorer2DSelectionRing(ringCanvas, 100, 200, NaN), false,
  '無效座標不得繪製目標圈');

console.log('ROO 2D 等角投影、點擊反投影與來源貼圖三角形映射測試通過。');
