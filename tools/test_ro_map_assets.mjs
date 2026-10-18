import assert from 'node:assert/strict';
import {
  RAGASSETS_BASE_URL,
  buildGndMeshData,
  parseGndBuffer,
  resolveRagassetsMapUrls,
} from './ro_map_assets.mjs';

function makeGnd(surfaceStride = 56, minor = 7) {
  const width = 1;
  const height = 1;
  const texturePath = Buffer.alloc(80);
  texturePath.write('texture\\ground\\prontera.bmp', 0, 'latin1');
  const buffer = Buffer.alloc(26 + texturePath.length + 16 + 4 + surfaceStride + 28);
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
  return buffer;
}

const gnd = parseGndBuffer(makeGnd());
assert.equal(gnd.format, 'roo-gnd-v1');
assert.equal(gnd.version, '1.7');
assert.equal(gnd.width, 1);
assert.equal(gnd.height, 1);
assert.equal(gnd.textures[0], 'texture/ground/prontera.bmp');
assert.equal(gnd.surfaceRecordBytes, 56);
assert.equal(gnd.cubes[0].topSurface, 0);
assert.deepEqual(gnd.surfaces[0].uv, [[0, 0], [1, 0], [0, 1], [1, 1]]);
assert.deepEqual(gnd.surfaces[0].colors[0], [1, 1, 1, 1]);

const mesh = buildGndMeshData(gnd, 0.2);
assert.equal(mesh.cubeCount, 1);
assert.equal(mesh.quadCount, 1);
assert.equal(mesh.buckets.length, 1);
assert.equal(mesh.buckets[0].textureIndex, 0);
assert.deepEqual(mesh.buckets[0].indices, [0, 1, 2, 2, 1, 3]);
assert.deepEqual(mesh.buckets[0].positions.slice(0, 3), [-1, 0, 1]);
assert.deepEqual(mesh.buckets[0].uvs.slice(0, 2), [0, 0]);

const compact = parseGndBuffer(makeGnd(40));
assert.equal(compact.surfaceRecordBytes, 40);
assert.equal(buildGndMeshData(compact).quadCount, 1);

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
    'texture/ground/prontera.bmp': '../_t/0123456789abcdef.png',
    'evil.bmp': 'https://example.invalid/evil.png',
    'traversal.bmp': '../../secrets.png',
  },
};
const urls = resolveRagassetsMapUrls('prontera', manifest);
assert.equal(urls.manifest, RAGASSETS_BASE_URL + '/maps/prontera/manifest.json');
assert.equal(urls.gat, RAGASSETS_BASE_URL + '/maps/prontera/prontera.gat');
assert.equal(urls.textures['ground/prontera.bmp'], RAGASSETS_BASE_URL + '/maps/_t/0123456789abcdef.png');
assert.equal(Object.keys(urls.textures).length, 1);

assert.throws(() => resolveRagassetsMapUrls('../prontera', manifest), /地圖 ID/);
assert.throws(() => resolveRagassetsMapUrls('payon', manifest), /ID 不一致/);
assert.throws(() => resolveRagassetsMapUrls('prontera', {
  ...manifest,
  files: { ...manifest.files, gat: 'other.gat' },
}), /檔名不符合/);

console.log('RO 原生 GND 地圖解析／幾何／素材 URL 測試通過（16 assertions）');
