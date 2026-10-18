/* GAT 1.2/1.3 解析、地形旗標與異常輸入。 */
const H = require('./harness');
const g = H.boot();
const t = H.tester();

function makeGat(opts) {
  const o = Object.assign({ minor: 2, width: 2, height: 2, prefix: false, types: [0, 1, 5, 3], water: [] }, opts || {});
  const base = o.prefix ? 1 : 0;
  const buffer = new ArrayBuffer(base + 14 + o.width * o.height * 20);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x47, 0x52, 0x41, 0x54], base);
  bytes[base + 4] = 1;
  bytes[base + 5] = o.minor;
  const view = new DataView(buffer);
  view.setUint32(base + 6, o.width, true);
  view.setUint32(base + 10, o.height, true);
  for (let i = 0; i < o.width * o.height; i++) {
    const offset = base + 14 + i * 20;
    view.setFloat32(offset, i + 0.25, true);
    view.setFloat32(offset + 4, i + 0.5, true);
    view.setFloat32(offset + 8, i + 0.75, true);
    view.setFloat32(offset + 12, i + 1, true);
    const type = o.types[i] == null ? 0 : o.types[i];
    const raw = o.minor >= 3 ? ((type & 0xff) * 0x1000000 + (o.water.includes(i) ? 0x80 : 0)) >>> 0 : type >>> 0;
    view.setUint32(offset + 16, raw, true);
  }
  return buffer;
}

const map = g.ROMapData.parseGat(makeGat());
t.eq('讀出 GAT 版本與尺寸', map.version + ' ' + map.width + 'x' + map.height, '1.2 2x2');
t.eq('高度四角依序解析', [
  map.getTile(0, 0).southWestAltitude,
  map.getTile(0, 0).southEastAltitude,
  map.getTile(0, 0).northWestAltitude,
  map.getTile(0, 0).northEastAltitude,
].join(','), '0.25,0.5,0.75,1');
t.ok('一般地面可行走、牆格不可行走', map.isWalkable(0, 0) && !map.isWalkable(1, 0));
t.ok('懸崖不可走、已知水道格 3 可走', !map.isWalkable(0, 1) && map.isWalkable(1, 1));
t.ok('超出地圖的座標安全拒絕', map.getTile(-1, 0) === null && !map.isWalkable(2, 0));

const newer = g.ROMapData.parseGat(makeGat({ minor: 3, types: [0, 1, 5, 3], water: [1] }));
t.ok('GAT 1.3 保留地形代碼並辨識水面旗標',
  newer.getTile(1, 0).terrainType === 1 && newer.isWater(1, 0) && !newer.isWalkable(1, 0));

const legacy = g.ROMapData.parseGat(makeGat({ prefix: true }));
t.eq('相容 GRAT 前有零位元組的舊檔', legacy.getTile(1, 1).terrainType, 3);

function fails(fn) {
  try { fn(); return false; } catch (e) { return true; }
}
t.ok('無效標頭、截斷資料與不支援版本會拒絕', [
  fails(() => g.ROMapData.parseGat(new ArrayBuffer(18))),
  fails(() => g.ROMapData.parseGat(makeGat({ minor: 4 }))),
  fails(() => g.ROMapData.parseGat(makeGat({ width: 2, height: 2 }).slice(0, 25))),
].every(Boolean));

process.exit(t.report('RO 地圖 GAT 解析'));
