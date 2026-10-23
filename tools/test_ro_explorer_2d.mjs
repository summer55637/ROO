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
  classifyRoExplorer2DProp,
  getRoExplorer2DPropStyle,
  getRoExplorer2DPropOrientation,
  getRoExplorer2DDepthKey,
  sortRoExplorer2DSceneItems,
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
  { name: 'named instance', modelName: 'field_tree01.rsm', position: [10, 2, -20], rotation: [0, 35, 0] },
  { name: 'house instance', modelName: 'field_house01.rsm', position: [30, 4, 50], rotation: [0, 35, 0] },
  { name: 'invalid placement', modelName: 'broken.rsm', position: [NaN, 0, 0] },
], [{ x: 2, y: -0.4, z: 4.0000001 }], 0.2);
assert.equal(fallbackProps.length, 1,
  'RSW 擺放有有效位置但 RSM 未載入時要補位；已渲染的同位置模型不得重複畫');
assert.equal(fallbackProps[0].name, 'field_house01.rsm');
assert.equal(fallbackProps[0].modelName, 'field_house01.rsm');
assert.equal(fallbackProps[0].fallback, true);
assert.deepEqual(fallbackProps[0].position, { x: 6, y: -0.8, z: -10 });
assert.deepEqual(fallbackProps[0].modelRotation, [0, 35, 0],
  'RSM 未載入的代理物件仍須保留 RSW 原始朝向');
assert.equal(buildRoExplorer2DFallbackProps([
  { modelName: 'tree.rsm', position: [1, 2, 3] },
], [], 0).length, 0, '不合理世界比例不得產生代理物件');
assert.equal(buildRoExplorer2DFallbackProps([
  { modelName: 'tree.rsm', position: [1, 2, 3] },
], [], 1, 1).length, 1, '代理物件數不得超過指定擺放上限');

assert.equal(classifyRoExplorer2DProp('field_tree01.rsm'), 'tree');
assert.equal(classifyRoExplorer2DProp('prt_house02.rsm'), 'building');
assert.equal(classifyRoExplorer2DProp('field_fence01.rsm'), 'wall');
assert.equal(classifyRoExplorer2DProp('field_bridge01.rsm'), 'bridge');
assert.equal(classifyRoExplorer2DProp('rock_04.rsm'), 'rock');
assert.equal(classifyRoExplorer2DProp('field_signpost.rsm'), 'fixture');
assert.equal(classifyRoExplorer2DProp('unmatched_asset.rsm'), 'unknown');
// Real tra_fild paths use Korean names; the shared parent folder is not a type hint.
assert.equal(classifyRoExplorer2DProp('나무잡초꽃/나무03.rsm'), 'tree');
assert.equal(classifyRoExplorer2DProp('나무잡초꽃/나무06.rsm'), 'tree');
assert.equal(classifyRoExplorer2DProp('나무잡초꽃/나무기둥01.rsm'), 'tree');
assert.equal(classifyRoExplorer2DProp('나무잡초꽃/덤불01.rsm'), 'plant');
assert.equal(classifyRoExplorer2DProp('나무잡초꽃/바위01.rsm'), 'rock');
assert.equal(classifyRoExplorer2DProp('프론테라/성_성벽.rsm'), 'wall');
assert.equal(classifyRoExplorer2DProp('프론테라/프론테라성기둥.rsm'), 'fixture');
assert.equal(classifyRoExplorer2DProp('프론테라/성_기둥.rsm'), 'fixture');
assert.equal(classifyRoExplorer2DProp('prontera_re/barrel_j_04.rsm'), 'fixture');
assert.equal(classifyRoExplorer2DProp('prontera_re/woodbox_s_01.rsm'), 'fixture');
assert.equal(classifyRoExplorer2DProp('rockridge/bag_j_01.rsm'), 'fixture');
assert.equal(classifyRoExplorer2DProp('프론테라/바닥블럭.rsm'), 'rock');
assert.equal(classifyRoExplorer2DProp('외부소품/나무다리.rsm'), 'bridge');
assert.equal(classifyRoExplorer2DProp('외부소품/나무다리중간.rsm'), 'bridge');
assert.equal(classifyRoExplorer2DProp('외부소품/벤치01.rsm'), 'fixture');
assert.equal(classifyRoExplorer2DProp('프론테라/입구초소.rsm'), 'building');
assert.equal(classifyRoExplorer2DProp('프론테라/성_앞문.rsm'), 'building');
assert.equal(classifyRoExplorer2DProp('event/gr_s_01.rsm2'), 'unknown',
  '無法從檔名可靠判斷外觀的素材應保留 unknown');
const treeStyle = getRoExplorer2DPropStyle('field_tree01.rsm', [2, 1.5, 2]);
const rockStyle = getRoExplorer2DPropStyle('rock_04.rsm', [1, 1, 1]);
assert.equal(treeStyle.kind, 'tree');
assert.ok(treeStyle.orientationAware, '樹木代理也應保留 RSW 朝向資訊');
assert.ok(treeStyle.height > rockStyle.height,
  '樹木代理應比石塊更高，不應所有物件共用同一比例');
assert.ok(treeStyle.width <= 30 * 1.9 && treeStyle.height <= 45 * 1.9,
  '極端 RSW 縮放不得讓代理圖形無上限放大');
assert.deepEqual(
  getRoExplorer2DPropStyle('field_tree01.rsm', [NaN, 0, Infinity]),
  getRoExplorer2DPropStyle('field_tree01.rsm', [1, 1, 1]),
  '缺失或無效模型縮放應回到安全比例'
);
const neutralOrientation = getRoExplorer2DPropOrientation([0, 0, 0]);
const rotatedOrientation = getRoExplorer2DPropOrientation([0, 45, 0]);
const reverseOrientation = getRoExplorer2DPropOrientation([0, -45, 0]);
assert.equal(neutralOrientation.screenAngleDegrees, 0, '零旋轉不可改變代理圖形方向');
assert.ok(Math.abs(rotatedOrientation.screenAngleDegrees + 26.5650511771) < 1e-6,
  'RSW yaw 需依 Z 軸鏡射後轉成正確的等角螢幕方向');
assert.ok(Math.abs(reverseOrientation.screenAngleDegrees - 63.4349488229) < 1e-6,
  '相反 RSW yaw 應得到另一個可辨認的投影方向');
assert.equal(getRoExplorer2DPropStyle('field_fence01.rsm', [1, 1, 1], [0, 45, 0])
  .screenAngleRadians, rotatedOrientation.screenAngleRadians,
  '牆／橋／建築代理繪圖樣式須採用實際 RSW yaw');
assert.equal(getRoExplorer2DPropStyle('rock_04.rsm', [1, 1, 1], [0, 45, 0])
  .screenAngleRadians, 0, '對稱石塊不應因 yaw 被不必要地拉斜');

assert.equal(getRoExplorer2DDepthKey({ x: 12, y: 50, z: 8 }), 4);
assert.equal(getRoExplorer2DDepthKey({ x: 12, y: -50, z: 8 }), 4,
  '地面深度排序不得把物件高度／海拔混入遮擋順序');
assert.ok(getRoExplorer2DDepthKey({ x: 8, z: 10 }) < getRoExplorer2DDepthKey({ x: 12, z: 6 }),
  '地面更遠的物件應先繪製，較近的角色或物件後繪製');
assert.equal(getRoExplorer2DDepthKey({ x: NaN, z: 1 }), null,
  '無效座標不得產生可用的深度鍵');

const unsortedSceneItems = [
  { kind: 'player', depth: 20, id: 'player' },
  { kind: 'monster', depth: 10, id: 'monster-back' },
  { kind: 'prop', depth: 20, id: 'tree-front' },
  { kind: 'prop', depth: 5, id: 'tree-back' },
  { kind: 'monster', depth: 20, id: 'monster-front' },
];
const sortedSceneItems = sortRoExplorer2DSceneItems(unsortedSceneItems);
assert.deepEqual(sortedSceneItems.map(item => item.id), [
  'tree-back', 'monster-back', 'tree-front', 'monster-front', 'player',
], '2D 按地面錨點由遠到近繪製；同深度時場景、怪物、玩家依序置頂');
assert.equal(unsortedSceneItems[0].id, 'player', '深度排序不得改寫原始清單');




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
