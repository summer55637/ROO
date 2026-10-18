import assert from 'node:assert/strict';
import {
  RAGASSETS_BASE_URL,
  buildGndMeshData,
  insetGndTextureUvs,
  parseGndBuffer,
  resolveRagassetsMapUrls,
} from './ro_map_assets.mjs';

function makeGnd(surfaceStride = 40, minor = 7) {
  const width = 1;
  const height = 1;
  const texturePath = Buffer.alloc(80);
  Buffer.from('c7cab5e5b9d9b4da5c7072745fc3cabff830312e626d70', 'hex').copy(texturePath);
  const waterBytes = minor === 8 ? 36 : minor === 9 ? 56 : 0;
  const buffer = Buffer.alloc(26 + texturePath.length + 16 + 4 + surfaceStride + 28 + waterBytes);
  buffer.write('GRGN', 0, 'ascii');
  buffer.writeUInt8(1, 4);
  buffer.writeUInt8(minor, 5);
  buffer.writeInt32LE(width, 6);
  buffer.writeInt32LE(height, 10);
  buffer.writeFloatLE(10, 14);
  buffer.writeInt32LE(1, 18);
  buffer.writeInt32LE(80, 22);
  texturePath.copy(buffer, 26);
  let offset = 106;
  buffer.writeInt32LE(0, offset); offset += 4; // lightmap count
  buffer.writeInt32LE(8, offset); offset += 4;
  buffer.writeInt32LE(8, offset); offset += 4;
  buffer.writeInt32LE(1, offset); offset += 4;
  buffer.writeInt32LE(1, offset); offset += 4; // surface count

  const surfaceOffset = offset;
  [0, 1, 0, 1, 0, 0, 1, 1].forEach((uv, index) => {
    buffer.writeFloatLE(uv, surfaceOffset + index * 4);
  });
  buffer.writeInt16LE(0, surfaceOffset + 32);
  if (surfaceStride === 56) {
    buffer.writeUInt16LE(0, surfaceOffset + 36);
    for (let i = 0; i < 4; i++) {
      buffer.set([255, 255, 255, 255], surfaceOffset + 40 + i * 4);
    }
  } else {
    buffer.writeInt16LE(0, surfaceOffset + 34);
    buffer.set([255, 255, 255, 255], surfaceOffset + 36);
  }

  const cubeOffset = surfaceOffset + surfaceStride;
  [0, 0, 0, 0].forEach((h, index) => buffer.writeFloatLE(h, cubeOffset + index * 4));
  buffer.writeInt32LE(0, cubeOffset + 16);
  buffer.writeInt32LE(-1, cubeOffset + 20);
  buffer.writeInt32LE(-1, cubeOffset + 24);

  if (minor >= 8) {
    const waterOffset = buffer.length - waterBytes;
    buffer.writeFloatLE(0.25, waterOffset);
    buffer.writeInt32LE(2, waterOffset + 4);
    buffer.writeFloatLE(0.1, waterOffset + 8);
    buffer.writeFloatLE(0.2, waterOffset + 12);
    buffer.writeFloatLE(0, waterOffset + 16);
    buffer.writeInt32LE(4, waterOffset + 20);
    buffer.writeInt32LE(1, waterOffset + 24);
    buffer.writeInt32LE(1, waterOffset + 28);
    if (minor === 8) {
      buffer.writeFloatLE(0.25, waterOffset + 32);
    } else {
      buffer.writeFloatLE(0.25, waterOffset + 32);
      buffer.writeInt32LE(2, waterOffset + 36);
      buffer.writeFloatLE(0.1, waterOffset + 40);
      buffer.writeFloatLE(0.2, waterOffset + 44);
      buffer.writeFloatLE(0, waterOffset + 48);
      buffer.writeInt32LE(4, waterOffset + 52);
    }
  }
  return buffer;
}

const gnd = parseGndBuffer(makeGnd());
assert.equal(gnd.format, 'roo-gnd-v1');
assert.equal(gnd.version, '1.7');
assert.equal(gnd.width, 1);
assert.equal(gnd.height, 1);
assert.equal(gnd.textures[0], '필드바닥/prt_초원01.bmp');
assert.equal(gnd.surfaceRecordBytes, 40);
assert.equal(gnd.cubes[0].topSurface, 0);
assert.deepEqual(gnd.surfaces[0].uv, [[0, 0], [1, 0], [0, 1], [1, 1]]);
assert.deepEqual(gnd.surfaces[0].color, [1, 1, 1, 1]);

const mesh = buildGndMeshData(gnd, 0.2);
assert.equal(mesh.cubeCount, 1);
assert.equal(mesh.quadCount, 1);
assert.equal(mesh.buckets.length, 1);
assert.equal(mesh.buckets[0].textureIndex, 0);
assert.deepEqual(mesh.buckets[0].indices, [0, 1, 2, 2, 1, 3]);
assert.deepEqual(mesh.buckets[0].positions.slice(0, 3), [-1, 0, 1]);
assert.deepEqual(mesh.buckets[0].uvs.slice(0, 2), [0, 0]);

assert.throws(() => parseGndBuffer(makeGnd(56)), /40-byte surface/);

const adjacentTint = buildGndMeshData({
  width: 2,
  height: 1,
  textures: ['left.png', 'right.png'],
  surfaces: [
    { textureIndex: 0, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [1, 0, 0, 1] },
    { textureIndex: 1, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [0, 1, 0, 1] },
  ],
  cubes: [
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 0, northSurface: -1, eastSurface: -1 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 1, northSurface: -1, eastSurface: -1 },
  ],
});
const leftTile = adjacentTint.buckets.find(bucket => bucket.textureIndex === 0);
assert.deepEqual(leftTile.colors.slice(0, 6), [1, 0, 0, 0, 1, 0]);

assert.deepEqual(
  Array.from(insetGndTextureUvs([0, 0, 1, 1], 100, 50)),
  [0.004999999888241291, 0.009999999776482582, 0.9950000047683716, 0.9900000095367432]
);
assert.throws(() => insetGndTextureUvs([0, 0], 0, 32), /正整數/);

const water18 = parseGndBuffer(makeGnd(56, 8));
assert.equal(water18.version, '1.8');
assert.equal(water18.water.gridU, 1);
assert.equal(water18.water.gridV, 1);
assert.equal(water18.water.level, 0.25);

const water19 = parseGndBuffer(makeGnd(56, 9));
assert.equal(water19.version, '1.9');
assert.equal(water19.water.gridU, 1);
assert.equal(water19.water.gridV, 1);

let badHeaderRejected = false;
try {
  parseGndBuffer(Buffer.from('not a gnd'));
} catch (error) {
  badHeaderRejected = /GRGN/.test(error.message);
}
assert.equal(badHeaderRejected, true);

let badDimensionRejected = false;
const invalid = makeGnd();
invalid.writeInt32LE(-1, 6);
try {
  parseGndBuffer(invalid);
} catch (error) {
  badDimensionRejected = /尺寸/.test(error.message);
}
assert.equal(badDimensionRejected, true);

const manifest = {
  map: 'prontera',
  files: {
    gat: 'prontera.gat',
    gnd: 'prontera.gnd',
    rsw: 'prontera.rsw',
  },
  textures: {
    '필드바닥/prt_초원01.bmp': '../_t/0123456789abcdef.png',
    'evil.bmp': 'https://example.invalid/evil.png',
    'traversal.bmp': '../../secrets.png',
  },
};
const urls = resolveRagassetsMapUrls('prontera', manifest);
assert.equal(urls.manifest, RAGASSETS_BASE_URL + '/maps/prontera/manifest.json');
assert.equal(urls.gat, RAGASSETS_BASE_URL + '/maps/prontera/prontera.gat');
assert.equal(urls.textures['필드바닥/prt_초원01.bmp'], RAGASSETS_BASE_URL + '/maps/_t/0123456789abcdef.png');
assert.equal(Object.keys(urls.textures).length, 1);

assert.throws(() => resolveRagassetsMapUrls('../prontera', manifest), /地圖 ID/);
assert.throws(() => resolveRagassetsMapUrls('payon', manifest), /ID 不一致/);
assert.throws(() => resolveRagassetsMapUrls('prontera', {
  ...manifest,
  files: { ...manifest.files, gat: 'other.gat' },
}), /檔名不符合/);

console.log('RO 原生 GND 1.7–1.9 解析、幾何與素材 URL 測試通過');
