import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAGASSETS_BASE_URL,
  buildGndLightmapAtlasData,
  GND_PREVIEW_AO_STRENGTH,
  computeGndPreviewColor,
  computeGndLightDirection,
  computeGndLightMultiplier,
  transformGndNormalToRoSpace,
  buildRsmNodeTransformData,
  buildRsm2NodeTransformData,
  buildRsmNodeMeshData,
  buildRsm2NodeMeshData,
  transformRsmVertex,
  transformRsm2Vertex,
  buildGndMeshData,
  analyzeRswPlacementBounds,
  buildGndWaterMeshData,
  buildGndWaterMeshDataByPlane,
  compareGndGatHeights,
  insetGndTextureUvs,
  resolveGndDiffuseCropRect,
  mapGndDiffuseUvToSourcePixel,
  parseGndBuffer,
  parseRsmBuffer,
  parseRswBuffer,
  resolveRagassetsMapUrls,
  resolveMapTextureUrl,
  resolveWaterFramesForType,
  sampleGndHeightAtGatCell,
  sampleRsmAnimationPose,
  sampleRsmTextureAnimation,
  sampleRoWaterTextureIntervalMs,
  fillRoWaterWaveOffsets,
  sampleRoWaterWaveOffset,
} from './ro_map_assets.mjs';

function makeGnd(surfaceStride = 40, minor = 7, gridU = 1, gridV = 1, lightmapCount = 0) {
  const width = 1;
  const height = 1;
  const texturePath = Buffer.alloc(80);
  Buffer.from('c7cab5e5b9d9b4da5c7072745fc3cabff830312e626d70', 'hex').copy(texturePath);
  const waterPlaneCount = gridU * gridV;
  const waterBytes = minor === 8 ? 32 + waterPlaneCount * 4
    : minor === 9 ? 32 + waterPlaneCount * 24 : 0;
  const buffer = Buffer.alloc(26 + texturePath.length + 16 + lightmapCount * 256
    + 4 + surfaceStride + 28 + waterBytes);
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
  buffer.writeInt32LE(lightmapCount, offset); offset += 4;
  buffer.writeInt32LE(8, offset); offset += 4;
  buffer.writeInt32LE(8, offset); offset += 4;
  buffer.writeInt32LE(1, offset); offset += 4;
  for (let slice = 0; slice < lightmapCount; slice++) {
    // GND 1.7+: 8×8 grayscale AO first, then 8×8 RGB lightmap.
    for (let pixel = 0; pixel < 64; pixel++) {
      buffer[offset + pixel] = 20 + pixel;
      const colorAt = offset + 64 + pixel * 3;
      buffer[colorAt] = 80 + pixel;
      buffer[colorAt + 1] = 120 + pixel;
      buffer[colorAt + 2] = 160 + pixel;
    }
    offset += 256;
  }
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
    buffer.writeInt32LE(gridU, waterOffset + 24);
    buffer.writeInt32LE(gridV, waterOffset + 28);
    for (let i = 0; i < waterPlaneCount; i++) {
      const at = waterOffset + 32 + i * (minor === 8 ? 4 : 24);
      if (minor === 8) {
        buffer.writeFloatLE(0.25 + i * 0.25, at);
      } else {
        buffer.writeFloatLE(0.25 + i * 0.25, at);
        buffer.writeInt32LE(2 + i, at + 4);
        buffer.writeFloatLE(0.1 + i * 0.05, at + 8);
        buffer.writeFloatLE(0.2 + i * 0.1, at + 12);
        buffer.writeFloatLE(i * 10, at + 16);
        buffer.writeInt32LE(4 + i, at + 20);
      }
    }
  }
  return buffer;
}

function makeStandardGnd(cornerColors = [
  [255, 255, 255, 255], [255, 255, 255, 255],
  [255, 255, 255, 255], [255, 255, 255, 255],
]) {
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
    buffer.set(cornerColors[corner], surfaceAt + 40 + corner * 4);
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


function makeRsm2(minor = 2) {
  const chunks = [];
  function bytes(length) { const result = Buffer.alloc(length); chunks.push(result); return result; }
  function u8(value) { const result = bytes(1); result.writeUInt8(value); }
  function u16(value) { const result = bytes(2); result.writeUInt16LE(value); }
  function u32(value) { const result = bytes(4); result.writeUInt32LE(value); }
  function i32(value) { const result = bytes(4); result.writeInt32LE(value); }
  function f32(value) { const result = bytes(4); result.writeFloatLE(value); }
  function string(value) {
    const result = Buffer.from(value, 'ascii');
    u32(result.length);
    chunks.push(result);
  }
  function vec(values) { values.forEach(f32); }

  chunks.push(Buffer.from('GRSM', 'ascii'));
  u8(2); u8(minor);
  u32(1000); u32(2); u8(255); f32(30);
  if (minor < 3) { u32(1); string('grass.bmp'); }
  u32(1); string('root');
  u32(1); string('root'); string('');
  if (minor < 3) { u32(1); u32(0); }
  else { u32(1); string('grass.bmp'); }
  vec([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  vec([5, 10, 15]);
  u32(3); vec([0, 0, 0]); vec([1, 0, 0]); vec([0, 0, 1]);
  u32(3);
  u32(0xffffffff); vec([0, 0]);
  u32(0xffffffff); vec([1, 0]);
  u32(0xffffffff); vec([0, 1]);
  u32(1); u32(24);
  [0, 1, 2, 0, 1, 2, 0, 0].forEach(u16);
  i32(1); i32(0);
  u32(0); u32(0); u32(0);
  if (minor >= 3) u32(0);
  return Buffer.concat(chunks);
}

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


const rsm2 = parseRsmBuffer(makeRsm2(2));
assert.equal(rsm2.version, '2.2');
assert.equal(rsm2.nodes[0].translation1, null);
assert.deepEqual(rsm2.textures, ['grass.bmp']);
assert.deepEqual(buildRsm2NodeTransformData(rsm2.nodes[0], null, 0.2).position, [1, 2, -3]);
const rsm2Vertex = transformRsm2Vertex(rsm2.nodes[0], [1, 2, 3], 0.2);
[0.2, 0.4, -0.6].forEach((value, index) => {
  assert.ok(Math.abs(rsm2Vertex[index] - value) < 1e-6);
});
const rsm2Mesh = buildRsm2NodeMeshData(rsm2.nodes[0], rsm2.shadeType, 0.2);
assert.equal(rsm2Mesh.triangleCount, 1);
assert.equal(rsm2Mesh.buckets.length, 1);
assert.equal(rsm2Mesh.buckets[0].positions.length, rsm2Mesh.buckets[0].normals.length);
assert.ok(rsm2Mesh.buckets[0].normals.every(Number.isFinite));
assert.ok(rsm2Mesh.buckets[0].indices.every(index => index >= 0 && index < rsm2Mesh.buckets[0].positions.length / 3));

const rsm2Child = { offsetMatrix: [0, 0, -1, 0, 1, 0, 1, 0, 0], translation2: [2, 2, 3] };
const rsm2Parent = { offsetMatrix: [0, 0, -1, 0, 1, 0, 1, 0, 0], translation2: [1, 2, 3] };
const childLocal = buildRsm2NodeTransformData(rsm2Child, rsm2Parent, 0.2);
assert.deepEqual(childLocal.position, [0, 0, -0.2]);
assert.ok(Math.abs(childLocal.rotation[0]) < 1e-6);
assert.ok(Math.abs(childLocal.rotation[1]) < 1e-6);
assert.ok(Math.abs(childLocal.rotation[2]) < 1e-6);
assert.ok(Math.abs(childLocal.rotation[3] - 1) < 1e-6);

const rsm23 = parseRsmBuffer(makeRsm2(3));
assert.equal(rsm23.version, '2.3');
assert.deepEqual(rsm23.nodes[0].textureNames, ['grass.bmp']);
assert.equal(buildRsm2NodeMeshData(rsm23.nodes[0], rsm23.shadeType, 0.2).triangleCount, 1);



const shadingFixture = {
  offsetMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation1: [0, 0, 0],
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
  uvs: [[0, 0], [1, 0], [0, 1], [1, 1]],
  faces: [
    { vertexIndices: [0, 1, 2], uvIndices: [0, 1, 2], textureIndex: 0, smoothGroup: [1] },
    { vertexIndices: [0, 3, 1], uvIndices: [0, 3, 1], textureIndex: 0, smoothGroup: [1] },
  ],
};
const smoothMesh = buildRsmNodeMeshData(shadingFixture, 2, 1);
assert.equal(smoothMesh.triangleCount, 2);
assert.equal(smoothMesh.buckets[0].indices.length, 6);
assert.equal(smoothMesh.buckets[0].positions.length / 3, 4);
const sharedSmoothNormal = smoothMesh.buckets[0].normals.slice(0, 3);
assert.ok(Math.abs(sharedSmoothNormal[0]) < 1e-6);
assert.ok(Math.abs(sharedSmoothNormal[1] + Math.SQRT1_2) < 1e-6);
assert.ok(Math.abs(sharedSmoothNormal[2] + Math.SQRT1_2) < 1e-6);
const flatMesh = buildRsmNodeMeshData(shadingFixture, 1, 1);
assert.equal(flatMesh.buckets[0].positions.length / 3, 6);
assert.deepEqual(flatMesh.buckets[0].normals.slice(0, 3), [0, 0, -1]);
assert.deepEqual(flatMesh.buckets[0].normals.slice(9, 12), [0, -1, 0]);
const separatedGroups = {
  ...shadingFixture,
  faces: [
    { ...shadingFixture.faces[0], smoothGroup: [1] },
    { ...shadingFixture.faces[1], smoothGroup: [2] },
  ],
};
assert.equal(buildRsmNodeMeshData(separatedGroups, 2, 1).buckets[0].positions.length / 3, 6);
const unlitMesh = buildRsmNodeMeshData(shadingFixture, 0, 1);
assert.ok(unlitMesh.buckets[0].normals.every(value => value === -1));
assert.throws(() => buildRsmNodeMeshData(shadingFixture, 9), /ShadeType/);
assert.throws(() => buildRsmNodeMeshData({
  ...shadingFixture,
  faces: [{ ...shadingFixture.faces[0], vertexIndices: [0, 99, 2] }],
}, 2), /頂點索引/);

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
assert.deepEqual(rsmNodeTransform.scale, [2, 3, 4]);
assert.ok(Math.abs(rsmNodeTransform.rotation[0]) < 1e-6);
assert.ok(Math.abs(rsmNodeTransform.rotation[1]) < 1e-6);
assert.ok(Math.abs(rsmNodeTransform.rotation[2] + Math.SQRT1_2) < 1e-6);
assert.ok(Math.abs(rsmNodeTransform.rotation[3] - Math.SQRT1_2) < 1e-6);
const transformedRsmVertex = transformRsmVertex({
  offsetMatrix: [1, 0, 0, 2, 1, 0, 0, 0, 1],
  translation1: [1, 2, 3],
}, [4, 5, 6], 0.2);
[3, -1.4, -1.8].forEach((value, index) => {
  assert.ok(Math.abs(transformedRsmVertex[index] - value) < 1e-6);
});
assert.deepEqual(
  transformRsmVertex({
    offsetMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    translation1: null,
  }, [2, 3, 4], 0.5),
  [1, -1.5, -2]
);
const staticAnimatedNodeTransform = buildRsmNodeTransformData({
  offsetMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation1: null,
  translation2: [0, 0, 0],
  rotationAngle: 1,
  rotationAxis: [0, 1, 0],
  scale: [1, 1, 1],
  rotationKeyframes: [{ frame: 0, value: 1 }],
}, 1);
assert.deepEqual(staticAnimatedNodeTransform.position, [0, 0, 0]);
assert.deepEqual(staticAnimatedNodeTransform.rotation, [0, 0, 0, 1]);
assert.deepEqual(staticAnimatedNodeTransform.scale, [1, 1, 1]);
assert.throws(() => buildRsmNodeTransformData({ offsetMatrix: [] }), /offsetMatrix/);
assert.throws(() => buildRsmNodeTransformData({
  offsetMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation2: [0, NaN, 0],
}), /position/);
assert.throws(() => transformRsmVertex({
  offsetMatrix: [1, 0, 0],
}, [0, 0, 0]), /offsetMatrix/);

const standardGnd = parseGndBuffer(makeStandardGnd());
assert.equal(standardGnd.version, '1.7');
assert.equal(standardGnd.surfaceRecordBytes, 56);
assert.equal(standardGnd.lightmapLayout, 'standard-split');
assert.equal(standardGnd.lightmapCount, 1);
assert.equal(standardGnd.lightmapSlices[0].colorPixels.length, 192);
assert.equal(standardGnd.lightmapSlices[0].shadowPixels.length, 64);
assert.deepEqual(standardGnd.surfaces[0].colors[0], [1, 1, 1, 1]);

const sourceBgraCorners = [
  [13, 27, 41, 255],
  [53, 67, 79, 255],
  [89, 101, 113, 255],
  [127, 139, 151, 255],
];
const expectedRgbaCorners = sourceBgraCorners.map(([b, g, r, a]) => [
  r / 255, g / 255, b / 255, a / 255,
]);
const channelOrderGnd = parseGndBuffer(makeStandardGnd(sourceBgraCorners));
assert.deepEqual(channelOrderGnd.surfaces[0].colors, expectedRgbaCorners,
  '56-byte GND surface BGRA bytes must become RGB colors without changing SW/SE/NW/NE corner order');
const channelOrderMesh = buildGndMeshData(channelOrderGnd, 0.2, null);
assert.deepEqual(channelOrderMesh.buckets[0].colors,
  expectedRgbaCorners.flatMap(color => color.slice(0, 3)),
  'native GND mesh must preserve each source corner tint instead of spreading a tint across neighboring corners');

const lightmapAtlas = buildGndLightmapAtlasData(standardGnd, 0);
function readAtlasRgbaAt(pixels, width, x, y) {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}
assert.equal(lightmapAtlas.width, 16);
assert.equal(lightmapAtlas.height, 16);
assert.deepEqual(Array.from(lightmapAtlas.lightMapPixels.slice((4 * 16 + 4) * 4, (4 * 16 + 4) * 4 + 4)),
  [127, 95, 63, 255]);
assert.deepEqual(Array.from(lightmapAtlas.aoMapPixels.slice((4 * 16 + 4) * 4, (4 * 16 + 4) * 4 + 4)),
  [128, 128, 128, 255]);
assert.equal(lightmapAtlas.sourceGutter, 1,
  '真實 RO lightmap slices reserve one source pixel of border');
assert.deepEqual(lightmapAtlas.uvsBySlice[0], [
  [0.3125, 0.3125], [0.6875, 0.3125],
  [0.3125, 0.6875], [0.6875, 0.6875],
], 'lightmap UV spans six texels between the inner borders, excluding the reserved 8×8 outer ring');
const standardMesh = buildGndMeshData(standardGnd, 0.2, lightmapAtlas);
assert.equal(standardMesh.buckets[0].lightmapUvs.length, 8);
assert.deepEqual(standardMesh.buckets[0].lightmapEnabled, [1, 1, 1, 1]);
assert.deepEqual(standardMesh.buckets[0].colors.slice(0, 3), [1, 1, 1]);
const noLightmapMesh = buildGndMeshData({
  ...standardGnd,
  surfaces: standardGnd.surfaces.map(surface => ({ ...surface, lightmapIndex: -1 })),
}, 0.2, lightmapAtlas);
assert.deepEqual(noLightmapMesh.buckets[0].lightmapEnabled, [0, 0, 0, 0],
  'surfaces without a valid GND lightmap must not sample atlas UV (0,0)');
const outOfRangeLightmapMesh = buildGndMeshData({
  ...standardGnd,
  surfaces: standardGnd.surfaces.map(surface => ({ ...surface, lightmapIndex: lightmapAtlas.uvsBySlice.length })),
}, 0.2, lightmapAtlas);
assert.deepEqual(outOfRangeLightmapMesh.buckets[0].lightmapEnabled, [0, 0, 0, 0],
  'out-of-range GND lightmap indexes must not sample an unrelated atlas slice');

const legacyAtlas = buildGndLightmapAtlasData({
  lightmapSlices: [{
    width: 1, height: 1, channels: 4,
    colorPixels: new Uint8Array([20, 40, 60, 90]),
    shadowPixels: null,
  }],
}, 0);
assert.deepEqual(Array.from(legacyAtlas.lightMapPixels.slice(0, 4)), [20, 40, 60, 255]);
assert.equal(legacyAtlas.width, 9);
assert.equal(legacyAtlas.sourceGutter, 0, 'sub-4px synthetic slices do not lose their complete data');
assert.deepEqual(legacyAtlas.uvsBySlice[0], [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]);
assert.deepEqual(readAtlasRgbaAt(legacyAtlas.aoMapPixels, legacyAtlas.width, 4, 4), [90, 90, 90, 255]);
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
assert.deepEqual(mesh.buckets[0].surfaceIndices, [0]);
assert.deepEqual(mesh.buckets[0].sourceUvs, [0, 0, 1, 0, 0, 1, 1, 1]);
assert.deepEqual(mesh.buckets[0].diffuseUvRect, {
  minU: 0, maxU: 1, minV: 0, maxV: 1,
}, 'full-texture GND surfaces retain their source UV rectangle while using local UVs');

// Legacy single-tint surfaces assign their tint to the south-west grid vertex.
// Both quads sharing a position must receive the same color; coordinates with
// no source tile must remain neutral instead of inheriting face-local fallback.
const sharedTintBoundary = buildGndMeshData({
  width: 2,
  height: 1,
  textures: ['grass.bmp'],
  surfaces: [
    { textureIndex: 0, lightmapIndex: -1, color: [1, 0, 0, 1],
      uv: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { textureIndex: 0, lightmapIndex: -1, color: [0, 1, 0, 1],
      uv: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  ],
  cubes: [
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 0, northSurface: -1, eastSurface: -1 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 1, northSurface: -1, eastSurface: -1 },
  ],
});
const sharedTintBucket = sharedTintBoundary.buckets[0];
const tintAtVertex = vertex => sharedTintBucket.colors.slice(vertex * 3, vertex * 3 + 3);
assert.deepEqual(tintAtVertex(1), tintAtVertex(4),
  'adjacent legacy top surfaces must share the color anchored at their common grid vertex');
assert.deepEqual(tintAtVertex(3), [1, 1, 1],
  'an unanchored north-east vertex must use neutral white, not the left quad tint');
assert.deepEqual(tintAtVertex(6), [1, 1, 1],
  'an unanchored north-west vertex must use the same neutral white, not the right quad tint');

// East wall corners arrive in geometric order NE, SE, NW, SW, while the
// color array remains indexed by source UV corner. Catch accidental NE/SW swaps.
const eastWallTintMesh = buildGndMeshData({
  width: 2,
  height: 1,
  textures: ['grass.bmp'],
  surfaces: [
    { textureIndex: 0, lightmapIndex: -1, color: [1, 0, 0, 1],
      uv: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { textureIndex: 0, lightmapIndex: -1, color: [0, 1, 0, 1],
      uv: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { textureIndex: 0, lightmapIndex: -1, color: [0, 0, 0, 1],
      uv: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  ],
  cubes: [
    { hSW: 0, hSE: 0, hNW: 0, hNE: 2, topSurface: 0, northSurface: -1, eastSurface: 2 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 1, northSurface: -1, eastSurface: -1 },
  ],
});
const eastWallBucket = eastWallTintMesh.buckets[0];
const eastTintAtVertex = vertex => eastWallBucket.colors.slice(vertex * 3, vertex * 3 + 3);
assert.deepEqual(eastTintAtVertex(3), eastTintAtVertex(4),
  'the east wall north-east corner must match the coincident top-surface vertex');
assert.deepEqual(eastTintAtVertex(8), eastTintAtVertex(7),
  'the east wall south-west corner must match the coincident top-surface vertex');

const splitDiffuseRegions = buildGndMeshData({
  width: 3,
  height: 1,
  textures: ['packed-atlas.png'],
  surfaces: [
    { textureIndex: 0, uv: [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]], color: [1, 1, 1, 1] },
    { textureIndex: 0, uv: [[0.5, 0], [1, 0], [0.5, 0.5], [1, 0.5]], color: [1, 1, 1, 1] },
    { textureIndex: 0, uv: [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]], color: [1, 1, 1, 1] },
  ],
  cubes: [
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 0, northSurface: -1, eastSurface: -1 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 1, northSurface: -1, eastSurface: -1 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 2, northSurface: -1, eastSurface: -1 },
  ],
});
assert.equal(splitDiffuseRegions.buckets.length, 2,
  'same source texture but different UV sub-rectangles must use separate mip-safe regions');
const leftDiffuseRegion = splitDiffuseRegions.buckets.find(bucket => bucket.diffuseUvRect.minU === 0);
const rightDiffuseRegion = splitDiffuseRegions.buckets.find(bucket => bucket.diffuseUvRect.minU === 0.5);
assert.ok(leftDiffuseRegion && rightDiffuseRegion);
assert.deepEqual(leftDiffuseRegion.surfaceIndices, [0, 2],
  'surfaces sharing the same texture rectangle remain batched together');
assert.deepEqual(leftDiffuseRegion.uvs, [
  0, 0, 1, 0, 0, 1, 1, 1,
  0, 0, 1, 0, 0, 1, 1, 1,
], 'each isolated diffuse region remaps original UVs to the complete local texture');
assert.deepEqual(rightDiffuseRegion.uvs, [0, 0, 1, 0, 0, 1, 1, 1]);
assert.deepEqual(rightDiffuseRegion.sourceUvs, [
  0.5, 0, 1, 0, 0.5, 0.5, 1, 0.5,
], 'source diffuse UVs remain available for exact inspection after local remapping');
assert.deepEqual(rightDiffuseRegion.diffuseUvRect, {
  minU: 0.5, maxU: 1, minV: 0, maxV: 0.5,
});

// Shared terrain vertices must use the same smoothed normal even after adjacent
// tiles are split into separate material/texture buckets.
const smoothNormalsAcrossMaterials = buildGndMeshData({
  width: 2,
  height: 1,
  textures: ['left.png', 'right.png'],
  surfaces: [
    { textureIndex: 0, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [1, 1, 1, 1] },
    { textureIndex: 1, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [1, 1, 1, 1] },
  ],
  cubes: [
    { hSW: 0, hSE: 0, hNW: 0, hNE: 10, topSurface: 0, northSurface: -1, eastSurface: -1 },
    { hSW: 0, hSE: 10, hNW: 10, hNE: 20, topSurface: 1, northSurface: -1, eastSurface: -1 },
  ],
});
const smoothLeftTile = smoothNormalsAcrossMaterials.buckets.find(bucket => bucket.textureIndex === 0);
const smoothRightTile = smoothNormalsAcrossMaterials.buckets.find(bucket => bucket.textureIndex === 1);
assert.ok(smoothLeftTile && smoothRightTile);
assert.deepEqual(smoothLeftTile.normals.slice(3, 6), smoothRightTile.normals.slice(0, 3),
  'the shared south grid vertex keeps one normal across different material buckets');
assert.deepEqual(smoothLeftTile.normals.slice(9, 12), smoothRightTile.normals.slice(6, 9),
  'the shared north grid vertex keeps one normal across different material buckets');
assert.notDeepEqual(smoothLeftTile.normals.slice(3, 6), [0, 1, 0],
  'sloped terrain must use its measured smooth normal instead of a fixed up-vector');
for (const bucket of smoothNormalsAcrossMaterials.buckets) {
  for (let i = 0; i < bucket.normals.length; i += 3) {
    const length = Math.hypot(...bucket.normals.slice(i, i + 3));
    assert.ok(Math.abs(length - 1) < 1e-6, 'every terrain normal is normalized');
  }
}

// Shared UV boundaries must map to the same source texel coordinate even when
// adjacent surfaces use different isolated crops. A 1/4 atlas edge is between
// source pixels 63 and 64; the padded crop keeps that same bilinear midpoint.
const leftCropRect = resolveGndDiffuseCropRect({
  minU: 0, maxU: 0.25, minV: 0, maxV: 0.25,
}, 256, 256);
const rightCropRect = resolveGndDiffuseCropRect({
  minU: 0.25, maxU: 0.5, minV: 0, maxV: 0.25,
}, 256, 256);
assert.deepEqual([leftCropRect.x0, leftCropRect.x1], [0, 128],
  'left UV crop includes the neighboring source texel region for bilinear filtering');
assert.deepEqual([rightCropRect.x0, rightCropRect.x1], [0, 192],
  'right UV crop has a power-of-two-aligned sampling guard');
const leftSharedUv = mapGndDiffuseUvToSourcePixel(
  [0.25, 0.25], { minU: 0, maxU: 0.25, minV: 0, maxV: 0.25 }, 256, 256
);
const rightSharedUv = mapGndDiffuseUvToSourcePixel(
  [0.25, 0.25], { minU: 0.25, maxU: 0.5, minV: 0, maxV: 0.25 }, 256, 256
);
assert.deepEqual(leftSharedUv.sourcePosition, [63.5, 191.5]);
assert.deepEqual(rightSharedUv.sourcePosition, leftSharedUv.sourcePosition,
  'adjacent padded crops preserve the same actual source sampling position at a shared UV');
assert.deepEqual(leftSharedUv.localUv, [0.25, 0.25],
  'POT crops retain original atlas UVs rather than shifting them to local crop coordinates');
assert.deepEqual(rightSharedUv.localUv, leftSharedUv.localUv,
  'neighboring source-aligned crops use the same UV and mipmap texel phase');
const clampedUpperUv = mapGndDiffuseUvToSourcePixel(
  [1, 1], { minU: 0, maxU: 1, minV: 0, maxV: 1 }, 256, 256
);
assert.deepEqual(clampedUpperUv.nearestPixel, [255, 0],
  'UV=1 clamps to the final image texel rather than incorrectly wrapping to pixel zero');

assert.throws(() => parseGndBuffer(makeGnd(56)), /40-byte surface/);

const splitLightmapGnd = parseGndBuffer(makeGnd(40, 7, 1, 1, 1));
assert.equal(splitLightmapGnd.lightmapLayout, 'legacy-split');
assert.equal(splitLightmapGnd.lightmapCount, 1);
assert.equal(splitLightmapGnd.lightmapSlices[0].channels, 3);
assert.deepEqual(Array.from(splitLightmapGnd.lightmapSlices[0].shadowPixels.slice(0, 3)),
  [20, 21, 22], 'legacy-sized RO slices start with the independent grayscale AO channel');
assert.deepEqual(Array.from(splitLightmapGnd.lightmapSlices[0].colorPixels.slice(0, 9)),
  [80, 120, 160, 81, 121, 161, 82, 122, 162],
  'RGB lightmap bytes must not be read as interleaved RGBA');
const defaultSplitLightmapAtlas = buildGndLightmapAtlasData(splitLightmapGnd);
assert.deepEqual(readAtlasRgbaAt(
  defaultSplitLightmapAtlas.lightMapPixels, defaultSplitLightmapAtlas.width, 4, 4
), [80, 120, 160, 255],
'default atlas generation preserves the source 8-bit RGB instead of posterizing it');
const splitLightmapAtlas = buildGndLightmapAtlasData(splitLightmapGnd, 0);
assert.deepEqual(splitLightmapAtlas.uvsBySlice[0], [
  [5 / 16, 5 / 16],
  [11 / 16, 5 / 16],
  [5 / 16, 11 / 16],
  [11 / 16, 11 / 16],
], 'lightmap UVs span the six valid texels between the one-pixel source borders, matching classic RO');
assert.equal(
  splitLightmapAtlas.uvsBySlice[0][1][0] - splitLightmapAtlas.uvsBySlice[0][0][0],
  6 / 16,
  'the mapped lightmap footprint is six texels wide, not five texels between pixel centers'
);
assert.deepEqual(readAtlasRgbaAt(
  splitLightmapAtlas.lightMapPixels, splitLightmapAtlas.width, 4, 4
), [80, 120, 160, 255], 'atlas preserves the first RGB lightmap texel');
assert.deepEqual(readAtlasRgbaAt(
  splitLightmapAtlas.aoMapPixels, splitLightmapAtlas.width, 4, 4
), [20, 20, 20, 255], 'atlas preserves the independent first AO texel');

// Real maps ice_dun02/thor_v03 exceed the old 16,384-slice parser/atlas cap.
const highSliceCount = 16959;
const highSliceGnd = parseGndBuffer(makeGnd(40, 7, 1, 1, highSliceCount));
assert.equal(highSliceGnd.lightmapCount, highSliceCount);
assert.equal(highSliceGnd.lightmapSlices.length, highSliceCount);
assert.equal(highSliceGnd.surfaceRecordBytes, 40);
assert.deepEqual(Array.from(highSliceGnd.lightmapSlices.at(-1).shadowPixels.slice(0, 3)),
  [20, 21, 22], 'large GND preserves the last slice instead of rejecting the map at an arbitrary count');
const highSliceAtlas = buildGndLightmapAtlasData(highSliceGnd, 0);
assert.equal(highSliceAtlas.uvsBySlice.length, highSliceCount,
  'large GND lightmap atlas supports the real ice_dun02 slice count');
const splitLightmapMesh = buildGndMeshData(splitLightmapGnd, 0.2, splitLightmapAtlas);
assert.equal(splitLightmapMesh.buckets[0].lightmapUvs.length, 8);
assert.deepEqual(splitLightmapMesh.buckets[0].lightmapUvs.slice(0, 2),
  splitLightmapAtlas.uvsBySlice[0][0], 'surface corner zero maps to the RO bottom-left lightmap UV');

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

const sharedWallTint = buildGndMeshData({
  width: 2,
  height: 2,
  textures: ['top_sw.png', 'north_wall.png', 'top_se.png', 'top_nw.png', 'top_ne.png'],
  surfaces: [
    { textureIndex: 0, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [1, 0, 0, 1] },
    { textureIndex: 1, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [1, 0, 1, 1] },
    { textureIndex: 2, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [0, 1, 0, 1] },
    { textureIndex: 3, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [0, 0, 1, 1] },
    { textureIndex: 4, uv: [[0, 0], [1, 0], [0, 1], [1, 1]], color: [1, 1, 0, 1] },
  ],
  cubes: [
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 0, northSurface: 1, eastSurface: -1 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 2, northSurface: -1, eastSurface: -1 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 3, northSurface: -1, eastSurface: -1 },
    { hSW: 0, hSE: 0, hNW: 0, hNE: 0, topSurface: 4, northSurface: -1, eastSurface: -1 },
  ],
});
const northWall = sharedWallTint.buckets.find(bucket => bucket.textureIndex === 1);
assert.deepEqual(northWall.colors.slice(0, 12),
  [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0],
  'legacy north wall reuses colors at the shared ground-grid vertices instead of a flat tint');

assert.deepEqual(
  Array.from(insetGndTextureUvs([0, 0, 1, 1], 100, 50)),
  [0.004999999888241291, 0.009999999776482582, 0.9950000047683716, 0.9900000095367432],
  'legacy UV-pair callers retain the original full-texture inset'
);
assert.deepEqual(
  Array.from(insetGndTextureUvs([
    0.25, 0.25, 0.5, 0.25,
    0.25, 0.5, 0.5, 0.5,
  ], 64, 64)),
  [
    0.2578125, 0.2578125, 0.4921875, 0.2578125,
    0.2578125, 0.4921875, 0.4921875, 0.4921875,
  ],
  'GND sub-rectangle UVs inset half a texel at each surface edge'
);
const leftSubTexture = insetGndTextureUvs([
  0, 0, 0.5, 0, 0, 1, 0.5, 1,
], 64, 64);
const rightSubTexture = insetGndTextureUvs([
  0.5, 0, 1, 0, 0.5, 1, 1, 1,
], 64, 64);
assert.ok(leftSubTexture[2] < rightSubTexture[0],
  'adjacent GND UV sub-regions no longer sample across their shared texel boundary');
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
assert.deepEqual(waterMesh.tileCoordinates, [0, 0]);

assert.equal(sampleRoWaterTextureIntervalMs(3), 50);
assert.equal(sampleRoWaterTextureIntervalMs(3) * 32, 1600);
assert.ok(Math.abs(sampleRoWaterTextureIntervalMs(1) - 1000 / 60) < 1e-10);
assert.equal(sampleRoWaterTextureIntervalMs(NaN), 50);
assert.equal(sampleRoWaterTextureIntervalMs(300), 4000);

const stationaryWater = { waveHeight: 0, waveSpeed: 0, wavePitch: 0 };
assert.equal(sampleRoWaterWaveOffset(stationaryWater, 0, 0, 1, 1), 0);
const waveConfig = { waveHeight: 2, waveSpeed: 2, wavePitch: 0 };
assert.equal(sampleRoWaterWaveOffset(waveConfig, 0, 0, 0, 0.5), 0);
// waveSpeed advances the wave phase in degrees at fixed 60 Hz steps.
assert.ok(Math.abs(sampleRoWaterWaveOffset(waveConfig, 0, 0, 0.25, 0.5) + 0.5) < 1e-6);
assert.ok(Math.abs(sampleRoWaterWaveOffset(waveConfig, 0, 0, 0.75, 0.5) + 1) < 1e-6);
// The angle wraps around 180 degrees instead of accumulating without bound.
assert.ok(Math.abs(sampleRoWaterWaveOffset(waveConfig, 0, 0, 1.5, 0.5)) < 1e-6);
assert.ok(Math.abs(
  sampleRoWaterWaveOffset(waveConfig, 0, 0, 91 / 60, 0.5) - Math.sin(2 * Math.PI / 180)
) < 1e-6);
const pitchedWave = { waveHeight: 1, waveSpeed: 0, wavePitch: 90 };
assert.ok(Math.abs(
  sampleRoWaterWaveOffset(pitchedWave, 3, 4, 0, 1)
  - sampleRoWaterWaveOffset(pitchedWave, 4, 3, 0, 1)
) < 1e-9);
assert.ok(Math.abs(
  sampleRoWaterWaveOffset(pitchedWave, 3, 4, 0, 1)
  - sampleRoWaterWaveOffset(pitchedWave, 4, 4, 0, 1)
) > 0.1);
assert.throws(() => sampleRoWaterWaveOffset(waveConfig, NaN, 0, 0), /有限數值/);
assert.throws(() => sampleRoWaterWaveOffset(waveConfig, 0, 0, 0, 0), /比例/);

const waveOffsetBuffer = new Float32Array(9);
assert.equal(
  fillRoWaterWaveOffsets(waveConfig, 4, 4, 0.875, waveOffsetBuffer, 0.5),
  waveOffsetBuffer
);
for (let diagonal = 0; diagonal < waveOffsetBuffer.length; diagonal++) {
  assert.ok(Math.abs(
    waveOffsetBuffer[diagonal] - sampleRoWaterWaveOffset(waveConfig, diagonal, 0, 0.875, 0.5)
  ) < 1e-6);
}
assert.throws(() => fillRoWaterWaveOffsets(
  waveConfig, 4, 4, 0.875, new Float32Array(8), 0.5
), /緩衝區尺寸不足/);
assert.throws(() => fillRoWaterWaveOffsets(
  waveConfig, 0, 4, 0.875, new Float32Array(5), 0.5
), /尺寸無效/);

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
assert.equal(water19.water.planes.length, 1);
assert.equal(water19.water.planes[0].type, 2);
assert.equal(water19.water.planes[0].textureCyclingInterval, 4);

const multiWaterGnd = parseGndBuffer(makeGnd(40, 9, 2, 1));
assert.equal(multiWaterGnd.water.planes.length, 2);
assert.equal(multiWaterGnd.water.planes[1].level, 0.5);
assert.equal(multiWaterGnd.water.planes[1].type, 3);
assert.equal(multiWaterGnd.water.planes[1].textureCyclingInterval, 5);
const multiWaterGat = {
  version: '1.3',
  width: 4,
  height: 2,
  terrainTypes: new Uint16Array(8),
  water: new Uint8Array(8).fill(1),
};
const waterMeshes = buildGndWaterMeshDataByPlane(multiWaterGat, multiWaterGnd.water, 0.2);
assert.equal(waterMeshes.planes.length, 2);
assert.equal(waterMeshes.waterTileCount, 8);
assert.equal(waterMeshes.planes[0].data.waterTileCount, 4);
assert.equal(waterMeshes.planes[1].data.waterTileCount, 4);
assert.ok(waterMeshes.planes[0].data.tileCoordinates.every((value, index) =>
  index % 2 !== 0 || value < 2));
assert.ok(waterMeshes.planes[1].data.tileCoordinates.every((value, index) =>
  index % 2 !== 0 || value >= 2));
assert.equal(waterMeshes.planes[0].data.positions[1], -0.05);
assert.equal(waterMeshes.planes[1].data.positions[1], -0.1);

const legacyWaterMeshes = buildGndWaterMeshDataByPlane({
  version: '1.3', width: 2, height: 1,
  terrainTypes: new Uint16Array([0, 0]), water: new Uint8Array([1, 0]),
}, { level: 1, waveHeight: 0, waveSpeed: 0, wavePitch: 0 }, 0.2);
assert.equal(legacyWaterMeshes.planes.length, 1);
assert.equal(legacyWaterMeshes.waterTileCount, 1);

const gnd18Multi = parseGndBuffer(makeGnd(40, 8, 2, 1));
assert.equal(gnd18Multi.water.planes.length, 2);
assert.equal(gnd18Multi.water.planes[1].level, 0.5);
assert.equal(gnd18Multi.water.planes[1].type, gnd18Multi.water.type);

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
    'tree/tree02.rsm2': '../_m/0123456789abcdef.rsm2',
    'bad.rsm': 'https://example.invalid/model.rsm',
    'escape.rsm': '../../secrets.rsm',
  },
  water: {
    type: 3,
    frames: ['../_w/0123456789abcdef.jpg', 'https://example.invalid/water.jpg', '../../secrets.jpg'],
    planes: [{
      type: 5,
      frames: ['../_w/fedcba9876543210.jpg'],
    }],
  },
};
const urls = resolveRagassetsMapUrls('prontera', manifest);
assert.equal(urls.manifest, RAGASSETS_BASE_URL + '/maps/prontera/manifest.json');
assert.equal(urls.gat, RAGASSETS_BASE_URL + '/maps/prontera/prontera.gat');
assert.equal(urls.textures['필드바닥/prt_초원01.bmp'], RAGASSETS_BASE_URL + '/maps/_t/0123456789abcdef.png');
assert.equal(Object.keys(urls.textures).length, 1);
assert.equal(urls.models['tree/tree01.rsm'], RAGASSETS_BASE_URL + '/maps/_m/abcdef0123456789.rsm');
assert.equal(urls.models['tree/tree02.rsm2'], RAGASSETS_BASE_URL + '/maps/_m/0123456789abcdef.rsm2');
assert.equal(Object.keys(urls.models).length, 2);
assert.deepEqual(urls.waterFrames, [RAGASSETS_BASE_URL + '/maps/_w/0123456789abcdef.jpg']);
assert.equal(urls.waterType, 3);
assert.deepEqual(urls.waterFramesByType['3'], [RAGASSETS_BASE_URL + '/maps/_w/0123456789abcdef.jpg']);
assert.deepEqual(urls.waterFramesByType['5'], [RAGASSETS_BASE_URL + '/maps/_w/fedcba9876543210.jpg']);
const bundledType10Frames = Array.from({ length: 32 }, (_, frameIndex) => (
  new URL(
    '../assets/ro_water/type10/WATER10' + String(frameIndex).padStart(2, '0') + '.jpg',
    import.meta.url
  ).href
));
assert.deepEqual(urls.waterFramesByType['10'], bundledType10Frames);
for (const [frameIndex, frameUrl] of bundledType10Frames.entries()) {
  const bytes = readFileSync(new URL(frameUrl));
  assert.ok(bytes.length > 20000, 'bundled type-10 water frame ' + frameIndex + ' is non-empty JPEG data');
  assert.equal(bytes[0], 0xff, 'bundled type-10 water frame ' + frameIndex + ' has JPEG SOI marker');
  assert.equal(bytes[1], 0xd8, 'bundled type-10 water frame ' + frameIndex + ' has JPEG SOI marker');
}

assert.deepEqual(resolveWaterFramesForType(urls, 3), {
  frames: [RAGASSETS_BASE_URL + '/maps/_w/0123456789abcdef.jpg'],
  sourceType: 3,
  exactTypeMatch: true,
  usedFallback: false,
});
assert.deepEqual(resolveWaterFramesForType(urls, 5), {
  frames: [RAGASSETS_BASE_URL + '/maps/_w/fedcba9876543210.jpg'],
  sourceType: 5,
  exactTypeMatch: true,
  usedFallback: false,
});
assert.deepEqual(resolveWaterFramesForType(urls, 10), {
  frames: bundledType10Frames,
  sourceType: 10,
  exactTypeMatch: true,
  usedFallback: false,
});
assert.deepEqual(resolveWaterFramesForType({
  waterFrames: [], waterFramesByType: {}, waterType: null,
}, 10), {
  frames: [], sourceType: null, exactTypeMatch: false, usedFallback: false,
});
assert.throws(() => resolveWaterFramesForType(null, 1), /水面素材 URL/);

assert.throws(() => resolveRagassetsMapUrls('../prontera', manifest), /地圖 ID/);
assert.throws(() => resolveRagassetsMapUrls('payon', manifest), /ID 不一致/);
assert.throws(() => resolveRagassetsMapUrls('prontera', {
  ...manifest,
  files: { ...manifest.files, gat: 'other.gat' },
}), /檔名不符合/);


const rsmAnimationTrack = {
  rotationKeyframes: [
    { frame: 0, value: [0, 0, 0, 1] },
    { frame: 10, value: [0, 0, 1, 0] },
  ],
  scaleKeyframes: [
    { frame: 0, value: [1, 1, 1] },
    { frame: 10, value: [3, 5, 7] },
  ],
  translationKeyframes: [
    { frame: 0, value: [0, 0, 0] },
    { frame: 10, value: [10, 20, 30] },
  ],
};
const rsm2Pose = sampleRsmAnimationPose(rsmAnimationTrack, 5, 2, 0.2);
assert.deepEqual(rsm2Pose.scale, [2, 3, 4]);
assert.deepEqual(rsm2Pose.translation, [1, 2, -3]);
assert.ok(Math.abs(rsm2Pose.rotation[2] - Math.SQRT1_2) < 1e-6);
assert.ok(Math.abs(rsm2Pose.rotation[3] - Math.SQRT1_2) < 1e-6);
const rsm1Pose = sampleRsmAnimationPose({
  rotationKeyframes: rsmAnimationTrack.rotationKeyframes,
  scaleKeyframes: [],
}, 5, 1, 0.2);
assert.ok(Math.abs(rsm1Pose.rotation[2] + Math.SQRT1_2) < 1e-6);
assert.ok(Math.abs(rsm1Pose.rotation[3] - Math.SQRT1_2) < 1e-6);
assert.deepEqual(sampleRsmAnimationPose({ scaleKeyframes: rsmAnimationTrack.scaleKeyframes }, -1, 1).scale, [1, 1, 1]);
assert.deepEqual(sampleRsmAnimationPose({ scaleKeyframes: rsmAnimationTrack.scaleKeyframes }, 20, 1).scale, [3, 5, 7]);
assert.throws(() => sampleRsmAnimationPose(rsmAnimationTrack, NaN, 2), /有限數值/);
assert.throws(() => sampleRsmAnimationPose(rsmAnimationTrack, 5, 2, 0), /世界比例/);

const rsmTextureChannels = [
  { operation: 0, frames: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }] },
  { operation: 1, frames: [{ frame: 0, value: 0.25 }, { frame: 10, value: 0.75 }] },
  { operation: 2, frames: [{ frame: 0, value: 1 }, { frame: 10, value: 3 }] },
  { operation: 3, frames: [{ frame: 0, value: 2 }, { frame: 10, value: 4 }] },
  { operation: 4, frames: [{ frame: 0, value: 0 }, { frame: 10, value: Math.PI }] },
];
const texturePose = sampleRsmTextureAnimation(rsmTextureChannels, 5, 20);
assert.deepEqual(texturePose.offset, [0.5, 0.5]);
assert.deepEqual(texturePose.scale, [2, 3]);
assert.ok(Math.abs(texturePose.rotation - Math.PI / 2) < 1e-9);
const heldTexturePose = sampleRsmTextureAnimation(rsmTextureChannels, 15, 20);
assert.deepEqual(heldTexturePose.offset, [1, 0.75]);
assert.deepEqual(heldTexturePose.scale, [3, 4]);
assert.equal(heldTexturePose.rotation, Math.PI);
assert.deepEqual(sampleRsmTextureAnimation([], 5, 20), {
  offset: [0, 0], scale: [1, 1], rotation: 0,
});
assert.deepEqual(sampleRsmTextureAnimation([
  { operation: 0, frames: [{ frame: 5, value: 1 }] },
], 0, 20).offset, [0, 0]);
assert.deepEqual(sampleRsmTextureAnimation([
  { operation: 0, frames: [{ frame: 5, value: 1 }] },
], 2.5, 20).offset, [0.5, 0]);
assert.throws(() => sampleRsmTextureAnimation([], NaN, 20), /有限數值/);
assert.throws(() => sampleRsmTextureAnimation([], 0, 0), /長度/);

console.log('RO 原生 GND 解析、幾何、素材 URL 與 RSM 變換／UV 動畫取樣測試通過');


const terrainTextureManifest = {
  'field/grass.bmp': 'https://assets.example/maps/_t/1234567890abcdef.png',
  'field/stone.bmp': 'https://assets.example/maps/_t/abcdef1234567890.png',
};
assert.equal(
  resolveMapTextureUrl(terrainTextureManifest, 'field/grass.bmp'),
  terrainTextureManifest['field/grass.bmp'],
  '地表貼圖優先精確匹配完整路徑'
);
assert.equal(
  resolveMapTextureUrl(terrainTextureManifest, 'another-folder/grass.bmp'),
  terrainTextureManifest['field/grass.bmp'],
  '地表貼圖路徑不同時可使用唯一檔名回退'
);
assert.equal(
  resolveMapTextureUrl({
    'field/grass.bmp': 'https://assets.example/maps/_t/1234567890abcdef.png',
    'dungeon/grass.bmp': 'https://assets.example/maps/_t/abcdef1234567890.png',
  }, 'another-folder/grass.bmp'),
  null,
  '同名地表貼圖有多個候選時不應任意挑選'
);
assert.equal(resolveMapTextureUrl(terrainTextureManifest, ''),
  null, '空白貼圖名稱不會解析到任意材質');


assert.equal(GND_PREVIEW_AO_STRENGTH, 1, 'RO applies the stored grayscale AO map at full strength');
assert.deepEqual(
  computeGndPreviewColor([0.6, 0.4, 0.2], [0.1, 0.25, 0.5], 0.5),
  [0.4, 0.45, 0.6],
  'RO compositing multiplies diffuse by AO, then adds the RGB lightmap'
);
assert.deepEqual(
  computeGndPreviewColor([0.6, 0.4, 0.2], [0.1, 0.25, 0.5], 1),
  [0.7, 0.65, 0.7],
  'white AO preserves diffuse before the additive lightmap pass'
);
assert.deepEqual(
  computeGndPreviewColor([0.6, 0.4, 0.2], [0.1, 0.25, 0.5], 0),
  [0.1, 0.25, 0.5],
  'black AO darkens only diffuse; it does not erase baked colored light'
);
assert.deepEqual(
  computeGndPreviewColor([0.1, 0.5, 1.2], [-1, 0.5, 2], 2),
  [0.1, 1, 2.2],
  'AO and RGB lightmap channels are clamped to their legal ranges'
);
assert.throws(() => computeGndPreviewColor([1, 1], [0, 0, 0], 1),
  /GND 預覽合成/, 'invalid diffuse or lightmap data is rejected');
assert.deepEqual(
  computeGndPreviewColor([0.6, 0.4, 0.2], [0.1, 0.25, 0.5], 0.5, [0.5, 1, 0.25], [0.8, 0.4, 1]),
  [0.22, 0.33, 0.525],
  'diffuse is multiplied by RSW light, vertex tint and AO before RGB lightmap is added'
);
const equatorialLightDirection = computeGndLightDirection(0, 0);
assert.ok(Math.abs(equatorialLightDirection[0]) < 1e-12
  && Math.abs(equatorialLightDirection[1] - 1) < 1e-12
  && Math.abs(equatorialLightDirection[2]) < 1e-12,
  'GND RSW angles must follow GRFEditor rotations rather than a generic spherical-angle mapping');
const quarterTurnLightDirection = computeGndLightDirection(90, 90);
assert.ok(Math.abs(quarterTurnLightDirection[0] - 1) < 1e-12
  && Math.abs(quarterTurnLightDirection[1]) < 1e-12
  && Math.abs(quarterTurnLightDirection[2]) < 1e-12,
  'GND longitude and latitude rotation order is preserved');
assert.throws(() => computeGndLightDirection(NaN, 0), /光照方向/,
  'invalid RSW angles are rejected');
assert.deepEqual(transformGndNormalToRoSpace([0, 1, 0]), [0, -1, -0],
  'flat Three.js ground normals are converted to RO GND Y-down normal space');
assert.deepEqual(transformGndNormalToRoSpace([0.25, 0.5, -0.75]), [0.25, -0.5, 0.75],
  'slope normals undo both the view-space Y and Z axis flips');
assert.throws(() => transformGndNormalToRoSpace([0, NaN, 1]), /法線換算/,
  'invalid ground normals are rejected');
const brightSideMultiplier = computeGndLightMultiplier(
  transformGndNormalToRoSpace([0, 1, 0]), [0, 1, 0],
  [0.2, 0.2, 0.2], [0.8, 0.8, 0.8]
);
assert.ok(brightSideMultiplier.every(value => Math.abs(value - 0.84) < 1e-12),
  'official RSW light formula produces the expected facing-surface multiplier');
const awaySideMultiplier = computeGndLightMultiplier(
  transformGndNormalToRoSpace([0, -1, 0]), [0, 1, 0],
  [0.2, 0.2, 0.2], [0.8, 0.8, 0.8]
);
assert.ok(awaySideMultiplier.every(value => Math.abs(value - 0.168) < 1e-12),
  'official RSW light formula retains ambient light when the surface faces away');
assert.throws(() => computeGndLightMultiplier([0, 0, 0], [0, 1, 0], [0.2, 0.2, 0.2], [1, 1, 1]),
  /零向量/, 'zero normals are rejected instead of making an unstable light value');
const gndExplorerSource = readFileSync(new URL('./ro_explorer.mjs', import.meta.url), 'utf8');
assert.match(gndExplorerSource, /vRooGndLightMultiplier/,
  'native ground shader applies the computed RSW lighting multiplier');
assert.match(gndExplorerSource, /transformGndNormalToRoSpace/,
  'native ground shader converts Three.js normals back to the official GND coordinate system');
assert.match(gndExplorerSource, /computeGndLightDirection/,
  'native ground shader uses the reference RSW angle conversion');
assert.match(gndExplorerSource, /sourcePixelRect\.sourceAligned === true/,
  'POT diffuse crops retain absolute atlas texel alignment for mipmaps');
assert.match(gndExplorerSource, /crop\.sourceAligned\s*\?\s*\[uv\[0\], uv\[1\]\]/,
  'GPU crop audit compares source-aligned textures using the original UV coordinates');
assert.match(gndExplorerSource, /rooGndHasLightmap/,
  'native ground shader masks surfaces without valid lightmap slices');


for (const [pixels, label] of [
  [lightmapAtlas.lightMapPixels, 'lightmap'],
  [lightmapAtlas.aoMapPixels, 'AO'],
]) {
  const edgePixel = readAtlasRgbaAt(pixels, lightmapAtlas.width, 4, 4);
  for (const x of [0, 1, 2, 3, 12, 13, 14, 15]) {
    assert.deepEqual(readAtlasRgbaAt(pixels, lightmapAtlas.width, x, 4), edgePixel,
      label + ' atlas 的水平 mipmap gutter 應複製切片邊緣');
  }
  for (const y of [0, 1, 2, 3, 12, 13, 14, 15]) {
    assert.deepEqual(readAtlasRgbaAt(pixels, lightmapAtlas.width, 4, y), edgePixel,
      label + ' atlas 的垂直 mipmap gutter 應複製切片邊緣');
  }
}
