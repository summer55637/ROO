import assert from 'node:assert/strict';
import {
  RAGASSETS_BASE_URL,
  buildGndLightmapAtlasData,
  buildRsmNodeTransformData,
  buildGndMeshData,
  analyzeRswPlacementBounds,
  buildGndWaterMeshData,
  compareGndGatHeights,
  insetGndTextureUvs,
  parseGndBuffer,
  parseRsmBuffer,
  parseRswBuffer,
  resolveRagassetsMapUrls,
  sampleGndHeightAtGatCell,
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

function makeStandardGnd() {
  const texturePath = Buffer.alloc(80);
  texturePath.write('grass.bmp', 0, 'ascii');
  const buffer = Buffer.alloc(26 + 80 + 4 + 268 + 4 + 56 + 28);
  buffer.write('GRGN', 0, 'ascii');
  buffer.writeUInt8(1, 4);
  buffer.writeUInt8(7, 5);
  buffer.writeInt32LE(1, 6);
  buffer.writeInt32LE(1, 10);
  buffer.writeFloatLE(10, 14);
  buffer.writeInt32LE(1, 18);
  buffer.writeInt32LE(80, 22);
  texturePath.copy(buffer, 26);

  const lightmapCountAt = 106;
  buffer.writeInt32LE(1, lightmapCountAt);
  const lightmapAt = lightmapCountAt + 4;
  buffer.writeInt32LE(1, lightmapAt);
  buffer.writeInt32LE(8, lightmapAt + 4);
  buffer.writeInt32LE(8, lightmapAt + 8);
  buffer.fill(128, lightmapAt + 12, lightmapAt + 76);
  for (let pixel = 0; pixel < 64; pixel++) {
    const at = lightmapAt + 76 + pixel * 3;
    buffer[at] = 127;
    buffer[at + 1] = 95;
    buffer[at + 2] = 63;
  }

  const surfaceCountAt = lightmapAt + 268;
  buffer.writeInt32LE(1, surfaceCountAt);
  const surfaceAt = surfaceCountAt + 4;
  [0, 1, 0, 1, 0, 0, 1, 1].forEach((uv, index) => {
    buffer.writeFloatLE(uv, surfaceAt + index * 4);
  });
  buffer.writeInt32LE(0, surfaceAt + 32);
  buffer.writeInt32LE(0, surfaceAt + 36);
  for (let corner = 0; corner < 4; corner++) {
    buffer.set([255, 255, 255, 255], surfaceAt + 40 + corner * 4);
  }

  const cubeAt = surfaceAt + 56;
  [0, 0, 0, 0].forEach((height, index) => buffer.writeFloatLE(height, cubeAt + index * 4));
  buffer.writeInt32LE(0, cubeAt + 16);
  buffer.writeInt32LE(-1, cubeAt + 20);
  buffer.writeInt32LE(-1, cubeAt + 24);
  return buffer;
}

function makeRswV19() {
  const fixed = (text, size) => {
    const buffer = Buffer.alloc(size);
    buffer.write(text, 0, 'latin1');
    return buffer;
  };
  const chunks = [
    Buffer.from('GRSW', 'ascii'),
    Buffer.from([1, 9]),
    fixed('prontera.ini', 40),
    fixed('prontera.gnd', 40),
    fixed('prontera.gat', 40),
    fixed('source.rsw', 40),
  ];
  const waterAndLight = Buffer.alloc(24 + 32 + 4 + 16);
  let at = 0;
  waterAndLight.writeFloatLE(-5, at); at += 4;
  waterAndLight.writeInt32LE(3, at); at += 4;
  waterAndLight.writeFloatLE(0.5, at); at += 4;
  waterAndLight.writeFloatLE(0.6, at); at += 4;
  waterAndLight.writeFloatLE(0.7, at); at += 4;
  waterAndLight.writeInt32LE(8, at); at += 4;
  waterAndLight.writeInt32LE(135, at); at += 4;
  waterAndLight.writeInt32LE(45, at); at += 4;
  [0.8, 0.7, 0.6, 0.2, 0.3, 0.4].forEach(value => {
    waterAndLight.writeFloatLE(value, at); at += 4;
  });
  waterAndLight.writeFloatLE(0.8, at); at += 4;
  [100, -100, -100, 100].forEach(value => {
    waterAndLight.writeInt32LE(value, at); at += 4;
  });

  const model = Buffer.alloc(4 + 40 + 4 + 4 + 4 + 80 + 80 + 36);
  at = 0;
  model.writeInt32LE(1, at); at += 4;
  fixed('tree01', 40).copy(model, at); at += 40;
  model.writeInt32LE(0, at); at += 4;
  model.writeFloatLE(1, at); at += 4;
  model.writeInt32LE(1, at); at += 4;
  fixed('tree\\tree01.rsm', 80).copy(model, at); at += 80;
  fixed('node01', 80).copy(model, at); at += 80;
  [12, -3, -18, 0, 90, 0, 1, 1, 1].forEach(value => {
    model.writeFloatLE(value, at); at += 4;
  });

  return Buffer.concat([
    ...chunks,
    waterAndLight,
    Buffer.from([1, 0, 0, 0]), // object count
    model,
  ]);
}

const rsw = parseRswBuffer(makeRswV19());
assert.equal(rsw.format, 'roo-rsw-v1');
assert.equal(rsw.version, '1.9');
assert.equal(rsw.gndFile, 'prontera.gnd');
assert.equal(rsw.water.level, -5);
assert.equal(rsw.water.type, 3);
assert.ok(Math.abs(rsw.light.diffuse[0] - 0.8) < 1e-6);
assert.equal(rsw.models.length, 1);
assert.equal(rsw.models[0].modelName, 'tree/tree01.rsm');
assert.deepEqual(rsw.models[0].position, [12, -3, -18]);
assert.deepEqual(rsw.models[0].scale, [1, 1, 1]);

function makeRsm14() {
  const chunks = [];
  function bytes(length) { const result = Buffer.alloc(length); chunks.push(result); return result; }
  function u8(value) { const result = bytes(1); result.writeUInt8(value); }
  function u16(value) { const result = bytes(2); result.writeUInt16LE(value); }
  function u32(value) { const result = bytes(4); result.writeUInt32LE(value); }
  function i32(value) { const result = bytes(4); result.writeInt32LE(value); }
  function f32(value) { const result = bytes(4); result.writeFloatLE(value); }
  function fixed(value, length) { const result = bytes(length); result.write(value, 0, 'latin1'); }
  function vec(values) { values.forEach(f32); }

  chunks.push(Buffer.from('GRSM', 'ascii'));
  u8(1); u8(4);
  u32(1000); // animation length
  u32(2); // smooth shading
  u8(255); // alpha
  bytes(16); // reserved
  u32(1); fixed('grass.bmp', 40);
  fixed('root', 40);
  u32(1); // node count
  fixed('root', 40); fixed('', 40);
  u32(1); u32(0); // one node texture -> model texture 0
  vec([1, 0, 0, 0, 1, 0, 0, 0, 1]); // offset matrix
  vec([0, 0, 0]); // translation1
  vec([0, 0, 0]); // translation2
  f32(0); vec([0, 1, 0]); vec([1, 1, 1]); // static rotation and scale
  u32(3); vec([0, 0, 0]); vec([1, 0, 0]); vec([0, 0, 1]);
  u32(3);
  u32(0xffffffff); vec([0, 0]);
  u32(0xffffffff); vec([1, 0]);
  u32(0xffffffff); vec([0, 1]);
  u32(1); // face count
  [0, 1, 2, 0, 1, 2, 0, 0].forEach(u16);
  i32(1); i32(0); // two-sided, smoothing group
  u32(0); // rotation keyframe count
  return Buffer.concat(chunks);
}

const rsm = parseRsmBuffer(makeRsm14());
assert.equal(rsm.format, 'roo-rsm-v1');
assert.equal(rsm.version, '1.4');
assert.equal(rsm.shadeType, 2);
assert.equal(rsm.alpha, 255);
assert.deepEqual(rsm.textures, ['grass.bmp']);
assert.deepEqual(rsm.rootNodeNames, ['root']);
assert.equal(rsm.nodes.length, 1);
assert.equal(rsm.nodes[0].vertices.length, 3);
assert.deepEqual(rsm.nodes[0].faces[0].vertexIndices, [0, 1, 2]);
assert.deepEqual(rsm.nodes[0].faces[0].uvIndices, [0, 1, 2]);
assert.equal(rsm.nodes[0].faces[0].textureIndex, 0);

const rsmNodeTransform = buildRsmNodeTransformData({
  offsetMatrix: [1, 0, 0, 2, 1, 0, 0, 0, 1],
  translation1: [1, 2, 3],
  translation2: [10, 20, 30],
  rotationAngle: Math.PI / 2,
  rotationAxis: [0, 0, 1],
  scale: [2, 3, 4],
  rotationKeyframes: [],
}, 0.2);
assert.deepEqual(rsmNodeTransform.position, [2, -4, -6]);
assert.deepEqual(rsmNodeTransform.meshOffset, [0.2, -0.4, -0.6]);
const expectedRsmNodeMatrix = [
  4, 3, 0, 0,
  -2, 0, 0, 0,
  0, 0, 4, 0,
  0, 0, 0, 1,
];
rsmNodeTransform.matrix.forEach((value, index) => {
  assert.ok(Math.abs(value - expectedRsmNodeMatrix[index]) < 1e-6,
    'RSM 應按 offsetMatrix × rotation × scale 組合節點矩陣');
});
const staticAnimatedNodeTransform = buildRsmNodeTransformData({
  offsetMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation1: null,
  translation2: [0, 0, 0],
  rotationAngle: 1,
  rotationAxis: [0, 1, 0],
  scale: [1, 1, 1],
  rotationKeyframes: [{ frame: 0, value: 1 }],
}, 1);
assert.deepEqual(staticAnimatedNodeTransform.meshOffset, [0, 0, 0]);
assert.deepEqual(staticAnimatedNodeTransform.matrix, [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
assert.throws(() => buildRsmNodeTransformData({ offsetMatrix: [] }), /offsetMatrix/);
assert.throws(() => buildRsmNodeTransformData({
  offsetMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation2: [0, NaN, 0],
}), /position/);

const standardGnd = parseGndBuffer(makeStandardGnd());
assert.equal(standardGnd.version, '1.7');
assert.equal(standardGnd.surfaceRecordBytes, 56);
assert.equal(standardGnd.lightmapLayout, 'standard-split');
assert.equal(standardGnd.lightmapCount, 1);
assert.equal(standardGnd.lightmapSlices[0].colorPixels.length, 192);
assert.equal(standardGnd.lightmapSlices[0].shadowPixels.length, 64);
assert.deepEqual(standardGnd.surfaces[0].colors[0], [1, 1, 1, 1]);

const lightmapAtlas = buildGndLightmapAtlasData(standardGnd, 0);
assert.equal(lightmapAtlas.width, 10);
assert.equal(lightmapAtlas.height, 10);
assert.deepEqual(Array.from(lightmapAtlas.lightMapPixels.slice((1 * 10 + 1) * 4, (1 * 10 + 1) * 4 + 4)),
  [127, 95, 63, 255]);
assert.deepEqual(Array.from(lightmapAtlas.aoMapPixels.slice((1 * 10 + 1) * 4, (1 * 10 + 1) * 4 + 4)),
  [128, 128, 128, 255]);
assert.deepEqual(lightmapAtlas.uvsBySlice[0], [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]);
const standardMesh = buildGndMeshData(standardGnd, 0.2, lightmapAtlas);
assert.equal(standardMesh.buckets[0].lightmapUvs.length, 8);
assert.deepEqual(standardMesh.buckets[0].colors.slice(0, 3), [1, 1, 1]);

const legacyAtlas = buildGndLightmapAtlasData({
  lightmapSlices: [{
    width: 1, height: 1, channels: 4,
    colorPixels: new Uint8Array([20, 40, 60, 90]),
    shadowPixels: null,
  }],
}, 0);
assert.deepEqual(Array.from(legacyAtlas.lightMapPixels.slice(0, 4)), [20, 40, 60, 255]);
assert.deepEqual(Array.from(legacyAtlas.aoMapPixels.slice(16, 20)), [90, 90, 90, 255]);
assert.equal(buildGndLightmapAtlasData({ lightmapSlices: [] }), null);
assert.throws(() => buildGndLightmapAtlasData(null), /lightmap slices/);
assert.throws(() => buildGndLightmapAtlasData({ lightmapSlices: [] }, -1), /0–255/);

const boundsAudit = analyzeRswPlacementBounds(
  { width: 10, height: 8 },
  { models: [
    { position: [0, 0, 0] },
    { position: [49, 0, -39] },
    { position: [60, 0, 0] },
    { position: [NaN, 0, 0] },
  ] },
  0.2
);
assert.equal(boundsAudit.total, 4);
assert.equal(boundsAudit.withinBounds, 2);
assert.equal(boundsAudit.withinOneTileMargin, 2);
assert.equal(boundsAudit.outsideBounds, 1);
assert.equal(boundsAudit.invalidPositions, 1);
assert.ok(Math.abs(boundsAudit.maximumOutsideDistance - 2) < 1e-6);
assert.throws(() => analyzeRswPlacementBounds(null, { models: [] }), /GND 與 RSW/);

const slopedGround = {
  width: 1,
  height: 1,
  cubes: [{ hSW: 0, hSE: 10, hNW: 20, hNE: 30, topSurface: 0 }],
};
assert.ok(Math.abs(sampleGndHeightAtGatCell(slopedGround, 0, 0, 0.2) + 1.5) < 1e-6);
assert.ok(Math.abs(sampleGndHeightAtGatCell(slopedGround, 1, 0, 0.2) + 2.5) < 1e-6);
assert.ok(Math.abs(sampleGndHeightAtGatCell(slopedGround, 0, 1, 0.2) + 3.5) < 1e-6);
assert.ok(Math.abs(sampleGndHeightAtGatCell(slopedGround, 1, 1, 0.2) + 4.5) < 1e-6);
assert.throws(() => sampleGndHeightAtGatCell(slopedGround, 2, 0), /超出/);
const matchingGatHeights = {
  width: 2, height: 2,
  heights: new Float32Array([7.5, 12.5, 17.5, 22.5]),
};
const heightAlignment = compareGndGatHeights(slopedGround, matchingGatHeights, 0.2);
assert.equal(heightAlignment.samples, 4);
assert.ok(heightAlignment.meanAbsoluteError < 1e-6);
assert.ok(heightAlignment.p95AbsoluteError < 1e-6);
assert.ok(heightAlignment.maxAbsoluteError < 1e-6);
assert.throws(() => compareGndGatHeights(slopedGround, { width: 1, height: 1, heights: [0] }), /尺寸相符/);

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

const waterMesh = buildGndWaterMeshData({
  version: '1.3',
  width: 2,
  height: 1,
  terrainTypes: new Uint16Array([1, 0]),
  water: new Uint8Array([1, 0]),
}, 2, 0.2);
assert.equal(waterMesh.waterTileCount, 1);
assert.equal(waterMesh.positions.length, 12);
assert.equal(waterMesh.indices.length, 6);
assert.equal(waterMesh.positions[1], -0.4);
assert.deepEqual(waterMesh.uvs, [0, 0, 1, 0, 0, 1, 1, 1]);

const legacyWaterMesh = buildGndWaterMeshData({
  version: '1.2',
  width: 2,
  height: 1,
  terrainTypes: new Uint16Array([6, 0]),
  water: new Uint8Array([0, 0]),
}, 0, 0.2);
assert.equal(legacyWaterMesh.waterTileCount, 1);
assert.equal(buildGndWaterMeshData({
  version: '1.3',
  width: 1,
  height: 1,
  terrainTypes: new Uint16Array([0]),
  water: new Uint8Array([0]),
}, 0).waterTileCount, 0);
assert.throws(() => buildGndWaterMeshData(null, 0), /GAT 水域/);
assert.throws(() => buildGndWaterMeshData({
  version: '1.3', width: 1, height: 1,
  terrainTypes: new Uint16Array([0]), water: new Uint8Array([0]),
}, Infinity), /有限數值/);

const water18 = parseGndBuffer(makeGnd(40, 8));
assert.equal(water18.version, '1.8');
assert.equal(water18.water.gridU, 1);
assert.equal(water18.water.gridV, 1);
assert.equal(water18.water.level, 0.25);

const water19 = parseGndBuffer(makeGnd(40, 9));
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
  models: {
    'tree/tree01.rsm': '../_m/abcdef0123456789.rsm',
    'bad.rsm': 'https://example.invalid/model.rsm',
    'escape.rsm': '../../secrets.rsm',
  },
  water: {
    type: 3,
    frames: ['../_w/0123456789abcdef.jpg', 'https://example.invalid/water.jpg', '../../secrets.jpg'],
  },
};
const urls = resolveRagassetsMapUrls('prontera', manifest);
assert.equal(urls.manifest, RAGASSETS_BASE_URL + '/maps/prontera/manifest.json');
assert.equal(urls.gat, RAGASSETS_BASE_URL + '/maps/prontera/prontera.gat');
assert.equal(urls.textures['필드바닥/prt_초원01.bmp'], RAGASSETS_BASE_URL + '/maps/_t/0123456789abcdef.png');
assert.equal(Object.keys(urls.textures).length, 1);
assert.equal(urls.models['tree/tree01.rsm'], RAGASSETS_BASE_URL + '/maps/_m/abcdef0123456789.rsm');
assert.equal(Object.keys(urls.models).length, 1);
assert.deepEqual(urls.waterFrames, [RAGASSETS_BASE_URL + '/maps/_w/0123456789abcdef.jpg']);

assert.throws(() => resolveRagassetsMapUrls('../prontera', manifest), /地圖 ID/);
assert.throws(() => resolveRagassetsMapUrls('payon', manifest), /ID 不一致/);
assert.throws(() => resolveRagassetsMapUrls('prontera', {
  ...manifest,
  files: { ...manifest.files, gat: 'other.gat' },
}), /檔名不符合/);

console.log('RO 原生 GND 1.7–1.9 解析、幾何與素材 URL 測試通過');
