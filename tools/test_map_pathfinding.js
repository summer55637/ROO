/* GAT 轉換與 RO A* 路徑搜尋回歸測試。 */
const fs = require('fs');
const os = require('os');
const pathModule = require('path');
const childProcess = require('child_process');
const H = require('./harness');
const { parseGatBuffer } = require('./convert_gat');
const t = H.tester();

function makeGat(width, height, terrainTypes, minor) {
  const buffer = Buffer.alloc(14 + width * height * 20);
  buffer.write('GRAT', 0, 'ascii');
  buffer.writeUInt8(1, 4);
  buffer.writeUInt8(minor == null ? 2 : minor, 5);
  buffer.writeUInt32LE(width, 6);
  buffer.writeUInt32LE(height, 10);
  terrainTypes.forEach((type, index) => {
    buffer.writeUInt16LE(type & 0xffff, 14 + index * 20 + 16);
  });
  return buffer;
}

const sample = parseGatBuffer(makeGat(3, 2, [0, 1, 5, 0, 0, 1]), 'test_map', 'test.gat');
t.eq('GAT 尺寸正確', sample.width + 'x' + sample.height, '3x2');
t.eq('障礙與懸崖都不可走', sample.walkableCount, 3);
t.eq('通行格 RLE 保留 GAT 原始順序', sample.walkableRle, '1:1,2:0,2:1,1:0');
t.eq('來源版本有保留', sample.sourceFormat, '1.2');

const batchRoot = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'roo-gat-batch-'));
const batchInput = pathModule.join(batchRoot, 'input');
const batchOutputDir = pathModule.join(batchRoot, 'output');
fs.mkdirSync(batchInput);
fs.writeFileSync(pathModule.join(batchInput, 'Prontera.gat'), makeGat(2, 1, [0, 1]));
fs.writeFileSync(pathModule.join(batchInput, 'payon.gat'), makeGat(1, 1, [2]));
let batchError = null;
let batchFiles = [];
try {
  const batchLog = childProcess.execFileSync(process.execPath, [
    pathModule.join(__dirname, 'convert_gat.js'),
    '--input-dir', batchInput,
    '--out-dir', batchOutputDir,
  ], { encoding: 'utf8' });
  batchFiles = fs.readdirSync(batchOutputDir).filter(name => name.endsWith('.walk.json')).sort();
  t.ok('批次轉換摘要正確', batchLog.includes('批次轉換完成：2 成功、0 失敗。'));
} catch (error) {
  batchError = error;
}
t.ok('批次轉換命令可執行', !batchError);
t.eq('批次轉換逐張輸出', batchFiles.length, 2);
const pronteraWalkPath = pathModule.join(batchOutputDir, 'prontera.walk.json');
if (fs.existsSync(pronteraWalkPath)) {
  const pronteraWalk = JSON.parse(fs.readFileSync(pronteraWalkPath, 'utf8'));
  t.eq('批次輸出地圖 ID 以小寫檔名對應', pronteraWalk.mapId, 'prontera');
  t.eq('批次輸出保留可走格統計', pronteraWalk.walkableCount, 1);
}
fs.rmSync(batchRoot, { recursive: true, force: true });

const legacyFlagsGat = makeGat(1, 1, [0], 2);
legacyFlagsGat.writeUInt16LE(0x8000, 14 + 18);
const legacy = parseGatBuffer(legacyFlagsGat, 'legacy_map', 'legacy.gat');
t.eq('GAT 1.2 忽略未定義高字', legacy.waterFlagCount, 0);

const waterGat = makeGat(1, 1, [1], 3);
waterGat.writeUInt32LE(0x80000001, 14 + 16);
const water = parseGatBuffer(waterGat, 'water_map', 'water.gat');
t.eq('GAT 1.3 最高位水域標記可識別', water.waterFlagCount, 1);
t.eq('GAT 1.3 水域標記不覆寫障礙地形', water.walkableCount, 0);

let invalidRejected = false;
try { parseGatBuffer(Buffer.from('not a gat'), 'bad', 'bad.gat'); } catch (e) { invalidRejected = true; }
t.ok('非 GAT 檔會被拒絕', invalidRejected);

const g = H.boot();
const rows = [
  '11011',
  '11011',
  '11011',
  '11011',
  '11111',
];
const cells = rows.join('');
const walkMap = g.decodeRoWalkMapData({
  format: 'roo-walkmap-v1',
  mapId: 'path_test',
  width: 5,
  height: 5,
  walkableRle: cells.match(/(.)\1*/g).map(run => run.length + ':' + run[0]).join(','),
});
t.ok('可解析通行格 RLE', !!walkMap);
t.ok('可走格為 true', g.isRoMapCellWalkable(walkMap, 0, 0));
t.ok('障礙格為 false', !g.isRoMapCellWalkable(walkMap, 2, 0));
t.ok('超出地圖邊界視為不可走', !g.isRoMapCellWalkable(walkMap, -1, 0));

const path = g.findRoPath(walkMap, { x: 0, y: 0 }, { x: 4, y: 0 });
t.ok('可繞過障礙找到路徑', Array.isArray(path) && path.length > 0);
if (path) {
  t.eq('路徑起點正確', path[0].x + ',' + path[0].y, '0,0');
  t.eq('路徑終點正確', path[path.length - 1].x + ',' + path[path.length - 1].y, '4,0');
  t.ok('路徑從障礙上方繞行', path.some(p => p.x === 2 && p.y === 4));
  let validSteps = true;
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i].x - path[i - 1].x);
    const dy = Math.abs(path[i].y - path[i - 1].y);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)
      || !g.isRoMapCellWalkable(walkMap, path[i].x, path[i].y)) validSteps = false;
    if (dx && dy && (!g.isRoMapCellWalkable(walkMap, path[i - 1].x + (path[i].x - path[i - 1].x), path[i - 1].y)
      || !g.isRoMapCellWalkable(walkMap, path[i - 1].x, path[i - 1].y + (path[i].y - path[i - 1].y)))) validSteps = false;
  }
  t.ok('路徑不穿牆或切過對角牆角', validSteps);
}
t.eq('目的地是障礙時不產生路徑', g.findRoPath(walkMap, { x: 0, y: 0 }, { x: 2, y: 0 }), null);

const cornerMap = g.decodeRoWalkMapData({
  format: 'roo-walkmap-v1', mapId: 'corner_test', width: 2, height: 2,
  walkableRle: '1:1,2:0,1:1',
});
t.eq('不可斜穿兩個障礙角', g.findRoPath(cornerMap, { x: 0, y: 0 }, { x: 1, y: 1 }), null);

const nearest = g.findNearestRoWalkableCell(walkMap, 2, 0, 4);
t.ok('障礙附近可尋找最近可走格', nearest && g.isRoMapCellWalkable(walkMap, nearest.x, nearest.y));

const rect = { left: 10, top: 20, width: 100, height: 100 };
const topLeft = g.roMapCellFromScreenPoint(walkMap, 11, 21, rect);
const bottomLeft = g.roMapCellFromScreenPoint(walkMap, 11, 119, rect);
t.eq('畫面上方轉成地圖北側格', topLeft.y, 4);
t.eq('畫面下方轉成地圖南側格', bottomLeft.y, 0);
t.eq('點擊畫面外不會產生格座標', g.roMapCellFromScreenPoint(walkMap, 200, 200, rect), null);

let malformedRejected = false;
try {
  g.decodeRoWalkMapData({ format: 'roo-walkmap-v1', width: 2, height: 2, walkableRle: '1:1' });
} catch (e) { malformedRejected = true; }
t.ok('不完整的通行格資料會被拒絕', malformedRejected);

process.exit(t.report('RO 地圖通行格與尋路'));
