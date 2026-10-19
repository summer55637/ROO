const MAP_ID_PATTERN = /^[a-z0-9_@-]{1,64}$/;
const TEXTURE_BLOB_PATTERN = /^\.\.\/_t\/[a-f0-9]{16}\.png$/i;
const MODEL_BLOB_PATTERN = /^\.\.\/_m\/[a-f0-9]{16}\.rsm2?$/i;

export const RAGASSETS_BASE_URL = 'https://assets.latam-tools.com.br';

function asView(input) {
  if (input instanceof DataView) return input;
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('GND 輸入必須是 ArrayBuffer 或 TypedArray。');
}

function readString(view, offset, length) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  const end = bytes.indexOf(0);
  const slice = end >= 0 ? bytes.subarray(0, end) : bytes;
  let decoded;
  try {
    // Matches the public asset pipeline's GRF filename decoder.
    decoded = new TextDecoder('euc-kr', { fatal: true }).decode(slice);
  } catch (error) {
    decoded = new TextDecoder('windows-1252').decode(slice);
  }
  return decoded.trim().replace(/\\/g, '/');
}

function normalizeTextureName(name) {
  return String(name || '').replace(/\\/g, '/').trim().toLowerCase()
    .replace(/^data\/texture\//, '').replace(/^texture\//, '');
}

export function normalizeModelName(name) {
  return String(name || '').replace(/\\/g, '/').trim().toLowerCase()
    .replace(/^data\/model\//, '').replace(/^model\//, '');
}

function validWaterTail(view, offset, version) {
  if (version[1] === 7) return offset === view.byteLength;
  if (offset + 32 > view.byteLength) return false;
  const numU = view.getInt32(offset + 24, true);
  const numV = view.getInt32(offset + 28, true);
  if (numU < 0 || numV < 0 || numU > 64 || numV > 64) return false;
  const count = numU * numV;
  const perPlane = version[1] === 8 ? 4 : 24;
  return offset + 32 + count * perPlane === view.byteLength;
}

function validateSurfaceReferences(cubes, surfaceCount) {
  for (const cube of cubes) {
    for (const index of [cube.topSurface, cube.northSurface, cube.eastSurface]) {
      if (index < -1 || index >= surfaceCount) return false;
    }
  }
  return true;
}

/**
 * Parse modern Ragnarok GND 1.7–1.9 terrain files.
 * Each surface is the 40-byte layout: eight float UV values, two int16
 * indices, and one BGRA vertex tint. Lengths are checked before allocation.
 */
export function parseGndBuffer(input) {
  const view = asView(input);
  const length = view.byteLength;
  if (length < 24
    || String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'GRGN') {
    throw new Error('不是有效的 GND 檔：找不到 GRGN 標頭。');
  }

  const major = view.getUint8(4);
  const minor = view.getUint8(5);
  if (major !== 1 || ![7, 8, 9].includes(minor)) {
    throw new Error('目前只支援 GND 1.7／1.8／1.9；收到 ' + major + '.' + minor + '。');
  }

  let offset = 6;
  const width = view.getInt32(offset, true); offset += 4;
  const height = view.getInt32(offset, true); offset += 4;
  const zoom = view.getFloat32(offset, true); offset += 4;
  const textureCount = view.getInt32(offset, true); offset += 4;
  const textureNameLength = view.getInt32(offset, true); offset += 4;
  const cubeCount = width * height;
  if (!Number.isFinite(zoom) || zoom <= 0 || !width || !height
    || width < 1 || height < 1 || width > 4096 || height > 4096
    || !Number.isSafeInteger(cubeCount) || cubeCount > 1000000
    || textureCount < 0 || textureCount > 4096
    || textureNameLength < 1 || textureNameLength > 512) {
    throw new Error('GND 地圖尺寸或材質表大小無效。');
  }
  if (offset + textureCount * textureNameLength + 16 > length) {
    throw new Error('GND 材質路徑區段超出檔案長度。');
  }

  const textures = [];
  for (let i = 0; i < textureCount; i++) {
    textures.push(readString(view, offset, textureNameLength));
    offset += textureNameLength;
  }

  const lightmapHeaderOffset = offset;
  let lightmapCount;
  let lightmapWidth;
  let lightmapHeight;
  let cellsPerGrid;
  let lightmapSlices = [];
  let lightmapLayout;
  let legacyLightmapPixels = null;
  let surfaceCount;
  let surfaceStride;
  let surfaceLayout;
  let surfaceStart;
  let cubeOffset;
  let tailOffset;

  function candidateFits(surfaceAt, stride) {
    if (surfaceAt + 4 > length) return null;
    const count = view.getInt32(surfaceAt, true);
    if (count < 0 || count > 1000000) return null;
    const start = surfaceAt + 4;
    const cubesAt = start + count * stride;
    const tailAt = cubesAt + cubeCount * 28;
    if (!Number.isSafeInteger(cubesAt) || tailAt > length
      || !validWaterTail(view, tailAt, [major, minor])) return null;
    return { count, start, cubesAt, tailAt };
  }

  // Standard GND 1.7+ stores independent 8x8 AO/RGB slices and 56-byte surfaces.
  let standardCandidate = null;
  const standardCount = view.getInt32(lightmapHeaderOffset, true);
  if (standardCount >= 0 && standardCount <= 16384) {
    const standardSlicesStart = lightmapHeaderOffset + 4;
    const standardSurfaceCountAt = standardSlicesStart + standardCount * 268;
    if (standardSurfaceCountAt + 4 <= length) {
      const candidate = candidateFits(standardSurfaceCountAt, 56);
      let validSlices = !!candidate;
      for (let i = 0; validSlices && i < standardCount; i++) {
        const at = standardSlicesStart + i * 268;
        validSlices = view.getInt32(at, true) === 1
          && view.getInt32(at + 4, true) === 8
          && view.getInt32(at + 8, true) === 8;
      }
      if (validSlices) {
        standardCandidate = {
          lightmapCount: standardCount,
          sliceStart: standardSlicesStart,
          surfaceCountAt: standardSurfaceCountAt,
          ...candidate,
        };
      }
    }
  }

  // Keep support for the global-dimension/40-byte surface variant already used
  // by the public test corpus; only select it when its complete file layout fits.
  let legacyCandidate = null;
  if (lightmapHeaderOffset + 16 <= length) {
    const count = view.getInt32(lightmapHeaderOffset, true);
    const lmWidth = view.getInt32(lightmapHeaderOffset + 4, true);
    const lmHeight = view.getInt32(lightmapHeaderOffset + 8, true);
    const cells = view.getInt32(lightmapHeaderOffset + 12, true);
    const bytes = count * lmWidth * lmHeight * 4;
    const surfaceCountAt = lightmapHeaderOffset + 16 + bytes;
    if (count >= 0 && count <= 16384 && lmWidth >= 0 && lmHeight >= 0
      && lmWidth <= 128 && lmHeight <= 128 && cells >= 0
      && Number.isSafeInteger(bytes) && surfaceCountAt + 4 <= length) {
      const candidate = candidateFits(surfaceCountAt, 40);
      if (candidate) {
        legacyCandidate = {
          lightmapCount: count,
          lightmapWidth: lmWidth,
          lightmapHeight: lmHeight,
          cellsPerGrid: cells,
          bytes,
          surfaceCountAt,
          sliceStart: lightmapHeaderOffset + 16,
          ...candidate,
        };
      }
    }
  }

  if (standardCandidate) {
    lightmapCount = standardCandidate.lightmapCount;
    lightmapWidth = 8;
    lightmapHeight = 8;
    cellsPerGrid = 0;
    lightmapLayout = 'standard-split';
    surfaceCount = standardCandidate.count;
    surfaceStride = 56;
    surfaceLayout = 'standard';
    surfaceStart = standardCandidate.start;
    cubeOffset = standardCandidate.cubesAt;
    tailOffset = standardCandidate.tailAt;
    offset = surfaceStart;
    for (let i = 0; i < lightmapCount; i++) {
      const at = standardCandidate.sliceStart + i * 268;
      lightmapSlices.push({
        width: 8,
        height: 8,
        shadowPixels: new Uint8Array(view.buffer, view.byteOffset + at + 12, 64).slice(),
        colorPixels: new Uint8Array(view.buffer, view.byteOffset + at + 76, 192).slice(),
        channels: 3,
      });
    }
  } else if (legacyCandidate) {
    lightmapCount = legacyCandidate.lightmapCount;
    lightmapWidth = legacyCandidate.lightmapWidth;
    lightmapHeight = legacyCandidate.lightmapHeight;
    cellsPerGrid = legacyCandidate.cellsPerGrid;
    lightmapLayout = 'legacy-rgba';
    surfaceCount = legacyCandidate.count;
    surfaceStride = 40;
    surfaceLayout = 'legacy';
    surfaceStart = legacyCandidate.start;
    cubeOffset = legacyCandidate.cubesAt;
    tailOffset = legacyCandidate.tailAt;
    offset = surfaceStart;
    legacyLightmapPixels = new Uint8Array(
      view.buffer,
      view.byteOffset + legacyCandidate.sliceStart,
      legacyCandidate.bytes
    ).slice();
    const pixelsPerSlice = lightmapWidth * lightmapHeight * 4;
    for (let i = 0; i < lightmapCount; i++) {
      lightmapSlices.push({
        width: lightmapWidth,
        height: lightmapHeight,
        colorPixels: legacyLightmapPixels.slice(i * pixelsPerSlice, (i + 1) * pixelsPerSlice),
        shadowPixels: null,
        channels: 4,
      });
    }
  } else {
    throw new Error('GND lightmap／surface 版面無法驗證（標準 56-byte surface 或舊式 40-byte surface）。');
  }

  const cubes = [];
  for (let i = 0; i < cubeCount; i++) {
    const at = cubeOffset + i * 28;
    const heights = [
      view.getFloat32(at, true),
      view.getFloat32(at + 4, true),
      view.getFloat32(at + 8, true),
      view.getFloat32(at + 12, true),
    ];
    const topSurface = view.getInt32(at + 16, true);
    const northSurface = view.getInt32(at + 20, true);
    const eastSurface = view.getInt32(at + 24, true);
    if (!heights.every(Number.isFinite) || heights.some(value => Math.abs(value) > 1000000)
      || [topSurface, northSurface, eastSurface].some(index => index < -1 || index >= surfaceCount)) {
      throw new Error('GND 第 ' + i + ' 個 cube 的高度或 surface 索引無效。');
    }
    cubes.push({ hSW: heights[0], hSE: heights[1], hNW: heights[2], hNE: heights[3],
      topSurface, northSurface, eastSurface });
  }
  if (!validateSurfaceReferences(cubes, surfaceCount)) {
    throw new Error('GND cube 引用了不存在的 surface。');
  }

  const surfaces = [];
  for (let i = 0; i < surfaceCount; i++) {
    const at = offset + i * surfaceStride;
    const uv = [];
    for (let j = 0; j < 4; j++) uv.push(view.getFloat32(at + j * 4, true));
    for (let j = 0; j < 4; j++) uv.push(view.getFloat32(at + 16 + j * 4, true));
    const textureIndex = surfaceLayout === 'standard'
      ? view.getInt32(at + 32, true) : view.getInt16(at + 32, true);
    const lightmapIndex = surfaceLayout === 'standard'
      ? view.getInt32(at + 36, true) : view.getInt16(at + 34, true);
    const colors = [];
    if (surfaceLayout === 'standard') {
      for (let corner = 0; corner < 4; corner++) {
        const c = at + 40 + corner * 4;
        colors.push([
          view.getUint8(c + 2) / 255,
          view.getUint8(c + 1) / 255,
          view.getUint8(c) / 255,
          view.getUint8(c + 3) / 255,
        ]);
      }
    } else {
      const c = at + 36;
      colors.push([
        view.getUint8(c + 2) / 255,
        view.getUint8(c + 1) / 255,
        view.getUint8(c) / 255,
        view.getUint8(c + 3) / 255,
      ]);
    }
    if (!uv.every(Number.isFinite)
      || textureIndex < -1 || textureIndex >= textureCount
      || lightmapIndex < -1 || lightmapIndex >= lightmapCount && lightmapCount > 0) {
      throw new Error('GND 第 ' + i + ' 個 surface 的 UV、材質或 lightmap 索引無效。');
    }
    surfaces.push({
      uv: [
        [uv[0], uv[4]], [uv[1], uv[5]],
        [uv[2], uv[6]], [uv[3], uv[7]],
      ],
      textureIndex,
      lightmapIndex,
      color: colors[0],
      colors: surfaceLayout === 'standard' ? colors : null,
    });
  }

  let water = null;
  if (minor >= 8) {
    const base = tailOffset;
    const gridU = view.getInt32(base + 24, true);
    const gridV = view.getInt32(base + 28, true);
    const defaultPlane = {
      level: view.getFloat32(base, true),
      type: view.getInt32(base + 4, true),
      waveHeight: view.getFloat32(base + 8, true),
      waveSpeed: view.getFloat32(base + 12, true),
      wavePitch: view.getFloat32(base + 16, true),
      textureCyclingInterval: view.getInt32(base + 20, true),
    };
    const planeCount = gridU * gridV;
    const planes = [];

    for (let i = 0; i < planeCount; i++) {
      const gridX = i % gridU;
      const gridY = Math.floor(i / gridU);
      if (minor === 8) {
        planes.push({
          ...defaultPlane,
          level: view.getFloat32(base + 32 + i * 4, true),
          gridX,
          gridY,
        });
      } else {
        const at = base + 32 + i * 24;
        planes.push({
          level: view.getFloat32(at, true),
          type: view.getInt32(at + 4, true),
          waveHeight: view.getFloat32(at + 8, true),
          waveSpeed: view.getFloat32(at + 12, true),
          wavePitch: view.getFloat32(at + 16, true),
          textureCyclingInterval: view.getInt32(at + 20, true),
          gridX,
          gridY,
        });
      }
    }

    water = { ...defaultPlane, gridU, gridV, planes };
  }

  return {
    format: 'roo-gnd-v1',
    version: major + '.' + minor,
    width,
    height,
    zoom,
    textures,
    lightmapCount,
    lightmapWidth,
    lightmapHeight,
    cellsPerGrid,
    lightmapLayout,
    lightmapSlices,
    lightmapPixels: legacyLightmapPixels,
    surfaceRecordBytes: surfaceStride,
    surfaces,
    cubes,
    water,
  };
}

/**
 * Prepare an RSM 1.x node transform in RO source order:
 * vertex offset -> scale -> rotation -> transformation matrix -> node position.
 * Returned 4x4 matrix values are row-major for THREE.Matrix4.set().
 */
/**
 * Prepare an RSM 1.x node's own TRS and its vertex-local transform.
 * RSM1 applies T(translation1) * offsetMatrix to vertices, while the
 * node hierarchy applies T(translation2) * rotation * scale.
 */
export function buildRsmNodeTransformData(node, worldScale = 0.2) {
  if (!node || !Array.isArray(node.offsetMatrix) || node.offsetMatrix.length !== 9) {
    throw new TypeError('必須提供含 3×3 offsetMatrix 的 RSM 節點。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('RSM 世界比例必須大於 0，且不可大於 10。');
  }
  if (!node.offsetMatrix.every(Number.isFinite)) {
    throw new TypeError('RSM offsetMatrix 含無效數值。');
  }

  function vec3(value, label, fallback = null) {
    const candidate = value === null || value === undefined ? fallback : value;
    if (!Array.isArray(candidate) || candidate.length !== 3
      || !candidate.every(Number.isFinite)) {
      throw new TypeError('RSM ' + label + ' 必須是三個有限數值。');
    }
    return candidate;
  }

  const positionSource = vec3(node.translation2, 'position');
  const scale = vec3(node.scale, 'scale', [1, 1, 1]);
  const hasRotationAnimation = Array.isArray(node.rotationKeyframes)
    && node.rotationKeyframes.length > 0;
  let rotation = [0, 0, 0, 1];
  if (!hasRotationAnimation && node.rotationAngle !== null && node.rotationAngle !== undefined) {
    if (!Number.isFinite(node.rotationAngle)) {
      throw new TypeError('RSM rotationAngle 必須是有限數值。');
    }
    const axis = vec3(node.rotationAxis, 'rotationAxis');
    const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
    if (axisLength > 1e-8) {
      const halfAngle = node.rotationAngle * 0.5;
      const sine = Math.sin(halfAngle) / axisLength;
      // RSM1's Y-down coordinates are reflected into the renderer axes.
      rotation = [
        axis[0] * sine,
        -axis[1] * sine,
        -axis[2] * sine,
        Math.cos(halfAngle),
      ];
      const length = Math.hypot(...rotation);
      rotation = rotation.map(value => {
        const normalized = value / length;
        return normalized === 0 ? 0 : normalized;
      });
    }
  }

  function worldCoordinate(value, sign = 1) {
    const coordinate = value * worldScale * sign;
    return coordinate === 0 ? 0 : coordinate;
  }
  return {
    position: [
      worldCoordinate(positionSource[0]),
      worldCoordinate(positionSource[1], -1),
      worldCoordinate(positionSource[2], -1),
    ],
    rotation,
    scale: [...scale],
  };
}

/** Apply the RSM1 vertex offset and stored column-major 3×3 matrix. */
export function transformRsmVertex(node, vertex, worldScale = 0.2) {
  if (!node || !Array.isArray(node.offsetMatrix) || node.offsetMatrix.length !== 9
    || !node.offsetMatrix.every(Number.isFinite)) {
    throw new TypeError('必須提供有效的 RSM offsetMatrix。');
  }
  if (!Array.isArray(vertex) || vertex.length !== 3 || !vertex.every(Number.isFinite)) {
    throw new TypeError('RSM 頂點必須是三個有限數值。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('RSM 世界比例必須大於 0，且不可大於 10。');
  }
  const offset = node.translation1 === null || node.translation1 === undefined
    ? [0, 0, 0] : node.translation1;
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) {
    throw new TypeError('RSM translation1 必須是三個有限數值。');
  }
  const matrix = node.offsetMatrix;
  const x = matrix[0] * vertex[0] + matrix[3] * vertex[1] + matrix[6] * vertex[2] + offset[0];
  const y = matrix[1] * vertex[0] + matrix[4] * vertex[1] + matrix[7] * vertex[2] + offset[1];
  const z = matrix[2] * vertex[0] + matrix[5] * vertex[1] + matrix[8] * vertex[2] + offset[2];
  return [
    x * worldScale,
    y === 0 ? 0 : -y * worldScale,
    z === 0 ? 0 : -z * worldScale,
  ];
}

/**
 * Build RSM1 mesh buffers with RO shading semantics before splitting by texture.
 * Type 0 is unlit, type 1 uses per-triangle normals, type 2 uses smoothing groups.
 */
function buildRsmNodeMeshDataInternal(node, shadeType, worldScale, transformVertex) {
  if (!node || !Array.isArray(node.vertices) || !Array.isArray(node.faces)) {
    throw new TypeError('必須提供含頂點與面的 RSM 節點。');
  }
  if (![0, 1, 2].includes(shadeType)) {
    throw new Error('RSM ShadeType 只支援 0、1、2。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('RSM 世界比例必須大於 0，且不可大於 10。');
  }

  const vertices = node.vertices.map(vertex => transformVertex(node, vertex, worldScale));
  const positionKey = point => point.map(value => Math.round(value * 1e6)).join(',');
  const normalize = vector => {
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    return length > 1e-9 ? vector.map(value => value / length) : [0, 1, 0];
  };
  const faceNormals = [];
  const faceGroups = [];

  for (const face of node.faces) {
    if (!Array.isArray(face.vertexIndices) || face.vertexIndices.length !== 3
      || face.vertexIndices.some(index => !Number.isInteger(index) || index < 0 || index >= vertices.length)) {
      throw new Error('RSM face 頂點索引無效。');
    }
    if (!Array.isArray(face.uvIndices) || face.uvIndices.length !== 3
      || face.uvIndices.some(index => !Number.isInteger(index) || index < 0
        || !Array.isArray(node.uvs) || index >= node.uvs.length)) {
      throw new Error('RSM face UV 索引無效。');
    }
    const [a, b, c] = face.vertexIndices.map(index => vertices[index]);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    faceNormals.push(normalize([
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]));

    const groups = [];
    for (const group of (Array.isArray(face.smoothGroup) ? face.smoothGroup : [])) {
      if (!Number.isInteger(group) || group < 0) break;
      const normalizedGroup = group % 128;
      if (!groups.includes(normalizedGroup)) groups.push(normalizedGroup);
    }
    faceGroups.push(groups);
  }

  const groupNormals = new Map();
  if (shadeType === 2) {
    for (let faceIndex = 0; faceIndex < node.faces.length; faceIndex++) {
      const face = node.faces[faceIndex];
      for (const group of faceGroups[faceIndex]) {
        for (const vertexIndex of face.vertexIndices) {
          const key = group + ':' + positionKey(vertices[vertexIndex]);
          let total = groupNormals.get(key);
          if (!total) {
            total = [0, 0, 0];
            groupNormals.set(key, total);
          }
          for (let axis = 0; axis < 3; axis++) total[axis] += faceNormals[faceIndex][axis];
        }
      }
    }
  }

  const buckets = new Map();
  for (let faceIndex = 0; faceIndex < node.faces.length; faceIndex++) {
    const face = node.faces[faceIndex];
    const textureIndex = face.textureIndex;
    let bucket = buckets.get(textureIndex);
    if (!bucket) {
      bucket = { textureIndex, positions: [], uvs: [], normals: [], indices: [], lookup: new Map() };
      buckets.set(textureIndex, bucket);
    }

    for (let corner = 0; corner < 3; corner++) {
      const vertexIndex = face.vertexIndices[corner];
      const uvIndex = face.uvIndices[corner];
      let normal = [-1, -1, -1];
      if (shadeType === 1) {
        normal = faceNormals[faceIndex];
      } else if (shadeType === 2) {
        const accum = [0, 0, 0];
        const pointKey = positionKey(vertices[vertexIndex]);
        for (const group of faceGroups[faceIndex]) {
          const contribution = groupNormals.get(group + ':' + pointKey);
          if (contribution) {
            for (let axis = 0; axis < 3; axis++) accum[axis] += contribution[axis];
          }
        }
        const length = Math.hypot(accum[0], accum[1], accum[2]);
        normal = length > 1e-9 ? accum.map(value => value / length) : faceNormals[faceIndex];
      }

      const normalKey = normal.map(value => Math.round(value * 1e6)).join(',');
      const key = shadeType === 1
        ? faceIndex + ':' + corner
        : positionKey(vertices[vertexIndex]) + ':' + uvIndex + ':' + normalKey;
      let destinationIndex = bucket.lookup.get(key);
      if (destinationIndex === undefined) {
        destinationIndex = bucket.positions.length / 3;
        bucket.lookup.set(key, destinationIndex);
        bucket.positions.push(...vertices[vertexIndex]);
        const uv = node.uvs[uvIndex] || [0, 0];
        bucket.uvs.push(uv[0], uv[1]);
        bucket.normals.push(...normal);
      }
      bucket.indices.push(destinationIndex);
    }
  }

  return {
    triangleCount: node.faces.length,
    buckets: [...buckets.values()].map(bucket => ({
      textureIndex: bucket.textureIndex,
      positions: bucket.positions,
      uvs: bucket.uvs,
      normals: bucket.normals,
      indices: bucket.indices,
    })),
  };
}


/** RSM2 keeps raw mesh vertices; node transforms are applied as hierarchy TRS. */
export function transformRsm2Vertex(node, vertex, worldScale = 0.2) {
  if (!node || !Array.isArray(node.offsetMatrix) || node.offsetMatrix.length !== 9
    || !node.offsetMatrix.every(Number.isFinite)) {
    throw new TypeError('必須提供有效的 RSM2 transformation matrix。');
  }
  if (!Array.isArray(vertex) || vertex.length !== 3 || !vertex.every(Number.isFinite)) {
    throw new TypeError('RSM2 頂點必須是三個有限數值。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('RSM 世界比例必須大於 0，且不可大於 10。');
  }
  const x = vertex[0] * worldScale;
  const y = vertex[1] * worldScale;
  const z = vertex[2] * worldScale;
  return [x === 0 ? 0 : x, y === 0 ? 0 : y, z === 0 ? 0 : -z];
}

export function buildRsmNodeMeshData(node, shadeType, worldScale = 0.2) {
  return buildRsmNodeMeshDataInternal(node, shadeType, worldScale, transformRsmVertex);
}

export function buildRsm2NodeMeshData(node, shadeType, worldScale = 0.2) {
  return buildRsmNodeMeshDataInternal(node, shadeType, worldScale, transformRsm2Vertex);
}

/**
 * Convert an RSM2 absolute node matrix/position into a local transform.
 * Matrix values are column-major; the parent matrix is treated as a rotation.
 */
export function buildRsm2NodeTransformData(node, parentNode = null, worldScale = 0.2) {
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('RSM 世界比例必須大於 0，且不可大於 10。');
  }
  function sourceMatrix(candidate, label) {
    if (!candidate || !Array.isArray(candidate.offsetMatrix) || candidate.offsetMatrix.length !== 9
      || !candidate.offsetMatrix.every(Number.isFinite)) {
      throw new TypeError('RSM2 ' + label + ' 缺少有效的 3×3 transformation matrix。');
    }
    const value = candidate.offsetMatrix;
    return [
      [value[0], value[3], value[6]],
      [value[1], value[4], value[7]],
      [value[2], value[5], value[8]],
    ];
  }
  function sourcePosition(candidate, label) {
    if (!candidate) return [0, 0, 0];
    if (!Array.isArray(candidate.translation2) || candidate.translation2.length !== 3
      || !candidate.translation2.every(Number.isFinite)) {
      throw new TypeError('RSM2 ' + label + ' translation2 必須是三個有限數值。');
    }
    return candidate.translation2;
  }
  const parentMatrix = parentNode
    ? sourceMatrix(parentNode, 'parent')
    : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const nodeMatrix = sourceMatrix(node, 'node');
  const parentPosition = sourcePosition(parentNode, 'parent');
  const nodePosition = sourcePosition(node, 'node');
  const delta = nodePosition.map((value, axis) => value - parentPosition[axis]);

  // Absolute node matrices are converted to parent-local TRS.
  const localMatrix = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) =>
      parentMatrix[0][row] * nodeMatrix[0][column]
      + parentMatrix[1][row] * nodeMatrix[1][column]
      + parentMatrix[2][row] * nodeMatrix[2][column]
    )
  );
  const localTranslation = [0, 1, 2].map(row =>
    parentMatrix[0][row] * delta[0]
    + parentMatrix[1][row] * delta[1]
    + parentMatrix[2][row] * delta[2]
  );

  // Current RO scene coordinates reflect both Y and Z.
  const signs = [1, 1, -1];
  const matrix = localMatrix.map((row, r) => row.map((value, c) => value * signs[r] * signs[c]));
  let x, y, z, w;
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (matrix[2][1] - matrix[1][2]) / s;
    y = (matrix[0][2] - matrix[2][0]) / s;
    z = (matrix[1][0] - matrix[0][1]) / s;
  } else if (matrix[0][0] > matrix[1][1] && matrix[0][0] > matrix[2][2]) {
    const s = Math.sqrt(1 + matrix[0][0] - matrix[1][1] - matrix[2][2]) * 2;
    w = (matrix[2][1] - matrix[1][2]) / s;
    x = 0.25 * s;
    y = (matrix[0][1] + matrix[1][0]) / s;
    z = (matrix[0][2] + matrix[2][0]) / s;
  } else if (matrix[1][1] > matrix[2][2]) {
    const s = Math.sqrt(1 + matrix[1][1] - matrix[0][0] - matrix[2][2]) * 2;
    w = (matrix[0][2] - matrix[2][0]) / s;
    x = (matrix[0][1] + matrix[1][0]) / s;
    y = 0.25 * s;
    z = (matrix[1][2] + matrix[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + matrix[2][2] - matrix[0][0] - matrix[1][1]) * 2;
    w = (matrix[1][0] - matrix[0][1]) / s;
    x = (matrix[0][2] + matrix[2][0]) / s;
    y = (matrix[1][2] + matrix[2][1]) / s;
    z = 0.25 * s;
  }
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length < 1e-8) {
    throw new Error('RSM2 transformation matrix 無法轉成有效旋轉。');
  }
  const rotation = [x, y, z, w].map(value => {
    const normalized = value / length;
    return Math.abs(normalized) < 1e-12 ? 0 : normalized;
  });
  const position = [
    localTranslation[0] * worldScale,
    localTranslation[1] * worldScale,
    -localTranslation[2] * worldScale,
  ].map(value => value === 0 ? 0 : value);
  return { position, rotation, scale: [1, 1, 1] };
}


function sampleRsmKeyframeSegment(keyframes, time) {
  if (!Array.isArray(keyframes)) throw new TypeError('RSM keyframes 必須是陣列。');
  if (!Number.isFinite(time)) throw new TypeError('RSM 動畫時間必須是有限數值。');
  if (!keyframes.length) return null;
  for (const key of keyframes) {
    if (!key || !Number.isFinite(key.frame) || !Array.isArray(key.value)
      || !key.value.every(Number.isFinite)) {
      throw new TypeError('RSM 動畫 keyframe 格式無效。');
    }
  }

  let ordered = keyframes;
  for (let i = 1; i < keyframes.length; i++) {
    if (keyframes[i].frame < keyframes[i - 1].frame) {
      ordered = [...keyframes].sort((a, b) => a.frame - b.frame);
      break;
    }
  }
  if (time <= ordered[0].frame) return { from: ordered[0], to: ordered[0], alpha: 0 };
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1];
    const to = ordered[i];
    if (time <= to.frame) {
      const span = to.frame - from.frame;
      const alpha = span > 0 ? Math.max(0, Math.min(1, (time - from.frame) / span)) : 1;
      return { from, to, alpha };
    }
  }
  const last = ordered[ordered.length - 1];
  return { from: last, to: last, alpha: 0 };
}

function normalizedRsmQuaternion(value, major) {
  const [x, y, z, w] = value;
  // RSM1 uses Y-down model space; RSM2 uses the Z-mirrored RO render space.
  const converted = major === 1 ? [x, -y, -z, w] : [-x, -y, z, w];
  const length = Math.hypot(...converted);
  return length < 1e-12 ? [0, 0, 0, 1] : converted.map(component => component / length);
}

function slerpRsmQuaternion(a, b, alpha) {
  let target = b;
  let dot = a.reduce((sum, value, index) => sum + value * target[index], 0);
  if (dot < 0) {
    target = target.map(value => -value);
    dot = -dot;
  }
  if (dot > 0.9995) {
    const value = a.map((component, index) => component + (target[index] - component) * alpha);
    const length = Math.hypot(...value);
    return length < 1e-12 ? [0, 0, 0, 1] : value.map(component => component / length);
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sine = Math.sin(angle);
  if (Math.abs(sine) < 1e-12) return a.slice();
  const fromWeight = Math.sin((1 - alpha) * angle) / sine;
  const toWeight = Math.sin(alpha * angle) / sine;
  return a.map((component, index) => component * fromWeight + target[index] * toWeight);
}

/** Sample the RSM transform channels at a source-frame timestamp. */
export function sampleRsmAnimationPose(track, time, major, worldScale = 0.2) {
  if (!track || typeof track !== 'object') throw new TypeError('必須提供 RSM 動畫軌道。');
  if (major !== 1 && major !== 2) throw new Error('RSM 動畫版本只支援 1.x 或 2.x。');
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('RSM 動畫世界比例必須大於 0，且不可大於 10。');
  }
  const pose = {};
  const rotation = sampleRsmKeyframeSegment(track.rotationKeyframes || [], time);
  if (rotation) {
    pose.rotation = slerpRsmQuaternion(
      normalizedRsmQuaternion(rotation.from.value, major),
      normalizedRsmQuaternion(rotation.to.value, major),
      rotation.alpha
    );
  }
  const scale = sampleRsmKeyframeSegment(track.scaleKeyframes || [], time);
  if (scale) {
    pose.scale = scale.from.value.map((value, index) =>
      value + (scale.to.value[index] - value) * scale.alpha);
  }
  if (major === 2) {
    const translation = sampleRsmKeyframeSegment(track.translationKeyframes || [], time);
    if (translation) {
      const value = translation.from.value.map((component, index) =>
        component + (translation.to.value[index] - component) * translation.alpha);
      pose.translation = [value[0] * worldScale, value[1] * worldScale, -value[2] * worldScale];
    }
  }
  return pose;
}

function sampleRsmTextureChannelValue(frames, frame, durationTicks) {
  const keys = (Array.isArray(frames) ? frames : [])
    .filter(key => key && Number.isFinite(key.frame) && Number.isFinite(key.value))
    .map(key => ({ frame: key.frame, value: key.value }))
    .sort((a, b) => a.frame - b.frame);
  if (!keys.length) return 0;

  let fromFrame = 0;
  let fromValue = 0;
  let toFrame = durationTicks;
  let toValue = keys[keys.length - 1].value;
  for (const key of keys) {
    if (key.frame <= frame) {
      fromFrame = key.frame;
      fromValue = key.value;
    } else {
      toFrame = key.frame;
      toValue = key.value;
      break;
    }
  }

  if (frame < keys[0].frame) {
    fromFrame = 0;
    fromValue = 0;
    toFrame = keys[0].frame;
    toValue = keys[0].value;
  } else if (frame >= keys[keys.length - 1].frame) {
    fromFrame = keys[keys.length - 1].frame;
    fromValue = keys[keys.length - 1].value;
    toFrame = durationTicks;
    toValue = fromValue;
  }

  if (toFrame <= fromFrame) return fromValue;
  const alpha = Math.max(0, Math.min(1, (frame - fromFrame) / (toFrame - fromFrame)));
  return fromValue + (toValue - fromValue) * alpha;
}

export function sampleRsmTextureAnimation(channels, time, durationTicks) {
  if (!Number.isFinite(time)) throw new Error('RSM 貼圖動畫時間必須是有限數值。');
  if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
    throw new Error('RSM 貼圖動畫長度必須大於 0。');
  }
  const frame = ((time % durationTicks) + durationTicks) % durationTicks;
  const transform = { offset: [0, 0], scale: [1, 1], rotation: 0 };
  if (!Array.isArray(channels)) return transform;

  for (const channel of channels) {
    if (!channel || !Number.isInteger(channel.operation)
      || channel.operation < 0 || channel.operation > 4) continue;
    const value = sampleRsmTextureChannelValue(channel.frames, frame, durationTicks);
    switch (channel.operation) {
      case 0:
        transform.offset[0] = value;
        break;
      case 1:
        transform.offset[1] = value;
        break;
      case 2:
        transform.scale[0] = value;
        break;
      case 3:
        transform.scale[1] = value;
        break;
      case 4:
        transform.rotation = value;
        break;
      default:
        break;
    }
  }
  return transform;
}

export function parseRsmBuffer(input) {
  const view = asView(input);
  let offset = 0;
  function requireBytes(size, label) {
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > view.byteLength) {
      throw new Error('RSM ' + label + ' 超出檔案長度。');
    }
  }
  function u8(label) {
    requireBytes(1, label);
    return view.getUint8(offset++);
  }
  function u16(label) {
    requireBytes(2, label);
    const value = view.getUint16(offset, true);
    offset += 2;
    return value;
  }
  function i32(label) {
    requireBytes(4, label);
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  }
  function u32(label) {
    requireBytes(4, label);
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }
  function f32(label) {
    requireBytes(4, label);
    const value = view.getFloat32(offset, true);
    offset += 4;
    if (!Number.isFinite(value)) throw new Error('RSM ' + label + ' 含無效數值。');
    return value;
  }
  function vec2(label) {
    return [f32(label), f32(label)];
  }
  function vec3(label) {
    return [f32(label), f32(label), f32(label)];
  }
  function vec4(label) {
    return [f32(label), f32(label), f32(label), f32(label)];
  }
  function skip(size, label) {
    requireBytes(size, label);
    offset += size;
  }
  function modelString(label, fixedLength = 40) {
    let size = fixedLength;
    if (isV22) {
      size = u32(label + ' length');
      if (size > 4096) throw new Error('RSM ' + label + ' 字串長度無效。');
    }
    requireBytes(size, label);
    const value = readString(view, offset, size);
    offset += size;
    return value;
  }
  function readCount(label, max = 1000000) {
    const count = u32(label + ' count');
    if (count > max) throw new Error('RSM ' + label + ' 數量超過安全上限。');
    return count;
  }

  requireBytes(6, 'header');
  if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'GRSM') {
    throw new Error('不是有效的 RSM 檔：找不到 GRSM 標頭。');
  }
  offset = 4;
  const major = u8('version');
  const minor = u8('version');
  if (!(major === 1 && minor >= 4 && minor <= 9)
    && !(major === 2 && (minor === 2 || minor === 3))) {
    throw new Error('目前支援 RSM 1.4–1.9 與 RSM2 2.2–2.3；收到 ' + major + '.' + minor + '。');
  }
  const isV22 = compareVersion(major, minor, 2, 2);
  const isV23 = compareVersion(major, minor, 2, 3);
  const animationLength = readCount('animation length', 10000000);
  const shadeType = u32('shade type');
  const alpha = compareVersion(major, minor, 1, 4) ? u8('alpha') : 255;
  const framesPerSecond = isV22 ? f32('frames per second') : 60;
  if (!isV22) skip(16, 'reserved header');

  const textures = [];
  if (!isV23) {
    const count = readCount('textures', 4096);
    for (let i = 0; i < count; i++) textures.push(modelString('texture name'));
  }

  const rootNodeNames = [];
  if (!isV22) {
    rootNodeNames.push(modelString('root node'));
  } else {
    const count = readCount('root nodes', 10000);
    for (let i = 0; i < count; i++) rootNodeNames.push(modelString('root node'));
  }

  const nodeCount = readCount('nodes', 20000);
  const nodes = [];
  let totalVertices = 0;
  let totalFaces = 0;
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    const name = modelString('node ' + nodeIndex + ' name');
    const parentName = modelString('node ' + nodeIndex + ' parent');
    const textureIndices = [];
    const textureNames = [];
    if (!isV23) {
      const count = readCount('node textures', 4096);
      for (let i = 0; i < count; i++) textureIndices.push(u32('node texture index'));
    } else {
      const count = readCount('node texture names', 4096);
      for (let i = 0; i < count; i++) textureNames.push(modelString('node texture name'));
    }

    const offsetMatrix = [];
    for (let i = 0; i < 9; i++) offsetMatrix.push(f32('node offset matrix'));
    let translation1 = null;
    let rotationAngle = null;
    let rotationAxis = null;
    let scale = null;
    if (!isV22) translation1 = vec3('node translation 1');
    const translation2 = vec3('node translation 2');
    if (!isV22) {
      rotationAngle = f32('node rotation angle');
      rotationAxis = vec3('node rotation axis');
      scale = vec3('node scale');
    }

    const vertexCount = readCount('vertices');
    totalVertices += vertexCount;
    if (totalVertices > 2000000) throw new Error('RSM 頂點總數超過安全上限。');
    const vertices = [];
    for (let i = 0; i < vertexCount; i++) vertices.push(vec3('vertex'));

    const uvCount = readCount('UVs');
    const uvs = [];
    const uvColors = [];
    for (let i = 0; i < uvCount; i++) {
      uvColors.push(compareVersion(major, minor, 1, 2) ? u32('UV color') : 0xffffffff);
      uvs.push(vec2('UV'));
    }

    const faceCount = readCount('faces');
    totalFaces += faceCount;
    if (totalFaces > 2000000) throw new Error('RSM 面總數超過安全上限。');
    const faces = [];
    for (let i = 0; i < faceCount; i++) {
      const faceLength = isV22 ? u32('face record length') : 24;
      if (faceLength < 24 || (faceLength - 24) % 4 !== 0) {
        throw new Error('RSM face 記錄長度無效。');
      }
      requireBytes(faceLength, 'face');
      const vertexIndices = [u16('face vertex'), u16('face vertex'), u16('face vertex')];
      const uvIndices = [u16('face UV'), u16('face UV'), u16('face UV')];
      const textureIndex = u16('face texture');
      u16('face padding');
      const twoSided = i32('face two-sided flag');
      const smoothGroup = [i32('face smoothing group')];
      for (let extra = 24; extra < faceLength; extra += 4) smoothGroup.push(i32('face extra smoothing group'));
      if (vertexIndices.some(index => index >= vertexCount)
        || uvIndices.some(index => index >= uvCount)) {
        throw new Error('RSM face 索引超出頂點／UV 範圍。');
      }
      faces.push({ vertexIndices, uvIndices, textureIndex, twoSided, smoothGroup });
    }

    const scaleKeyframes = [];
    if (compareVersion(major, minor, 1, 6)) {
      const count = readCount('scale keyframes');
      for (let i = 0; i < count; i++) {
        const frame = i32('scale keyframe');
        const value = vec3('scale keyframe value');
        f32('scale keyframe reserved');
        scaleKeyframes.push({ frame, value });
      }
    }
    const rotationKeyframes = [];
    const rotationCount = readCount('rotation keyframes');
    for (let i = 0; i < rotationCount; i++) {
      rotationKeyframes.push({ frame: i32('rotation keyframe'), value: vec4('rotation keyframe value') });
    }
    const translationKeyframes = [];
    if (isV22) {
      const count = readCount('translation keyframes');
      for (let i = 0; i < count; i++) {
        const frame = i32('translation keyframe');
        const value = vec3('translation keyframe value');
        f32('translation keyframe reserved');
        translationKeyframes.push({ frame, value });
      }
    }
    const textureAnimations = [];
    if (isV23) {
      const count = readCount('texture animations', 4096);
      for (let i = 0; i < count; i++) {
        const textureIndex = u32('texture animation index');
        const channelCount = readCount('texture animation channels', 64);
        const channels = [];
        for (let channel = 0; channel < channelCount; channel++) {
          const operation = u32('texture animation operation');
          const frameCount = readCount('texture animation frames', 100000);
          const frames = [];
          for (let frame = 0; frame < frameCount; frame++) {
            frames.push({ frame: i32('texture animation frame'), value: f32('texture animation value') });
          }
          channels.push({ operation, frames });
        }
        textureAnimations.push({ textureIndex, channels });
      }
    }

    nodes.push({
      name,
      parentName,
      textureIndices,
      textureNames,
      offsetMatrix,
      translation1,
      translation2,
      rotationAngle,
      rotationAxis,
      scale,
      vertices,
      uvs,
      uvColors,
      faces,
      scaleKeyframes,
      rotationKeyframes,
      translationKeyframes,
      textureAnimations,
    });
  }

  const nodeNames = new Set(nodes.map(node => node.name));
  const validRoots = rootNodeNames.filter(name => nodeNames.has(name));
  if (!validRoots.length && nodes.length) validRoots.push(nodes[0].name);
  return {
    format: 'roo-rsm-v1',
    version: major + '.' + minor,
    major,
    minor,
    animationLength,
    shadeType,
    alpha,
    framesPerSecond,
    textures,
    rootNodeNames: validRoots,
    nodes,
  };
}

function compareVersion(major, minor, targetMajor, targetMinor) {
  return major > targetMajor || (major === targetMajor && minor >= targetMinor);
}

export function parseRswBuffer(input) {
  const view = asView(input);
  let offset = 0;

  function requireBytes(size, label) {
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > view.byteLength) {
      throw new Error('RSW ' + label + ' 超出檔案長度。');
    }
  }
  function readU8(label) {
    requireBytes(1, label);
    const value = view.getUint8(offset);
    offset += 1;
    return value;
  }
  function readI32(label) {
    requireBytes(4, label);
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  }
  function readU32(label) {
    requireBytes(4, label);
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }
  function readF32(label) {
    requireBytes(4, label);
    const value = view.getFloat32(offset, true);
    offset += 4;
    if (!Number.isFinite(value)) throw new Error('RSW ' + label + ' 含無效數值。');
    return value;
  }
  function readVec3(label) {
    return [readF32(label), readF32(label), readF32(label)];
  }
  function readVec4(label) {
    return [readF32(label), readF32(label), readF32(label), readF32(label)];
  }
  function readFixedString(size, label) {
    requireBytes(size, label);
    const value = readString(view, offset, size);
    offset += size;
    return value;
  }
  function skip(size, label) {
    requireBytes(size, label);
    offset += size;
  }

  requireBytes(6, 'header');
  if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'GRSW') {
    throw new Error('不是有效的 RSW 檔：找不到 GRSW 標頭。');
  }
  offset = 4;
  const major = readU8('version');
  const minor = readU8('version');
  if (![1, 2].includes(major) || (major === 1 && minor < 3) || (major === 2 && minor > 7)) {
    throw new Error('目前只支援 RSW 1.3–2.7；收到 ' + major + '.' + minor + '。');
  }
  const isV22 = compareVersion(major, minor, 2, 2);
  const isV25 = compareVersion(major, minor, 2, 5);
  const isV26 = compareVersion(major, minor, 2, 6);
  const isV27 = compareVersion(major, minor, 2, 7);
  let buildNumber = 0;
  if (compareVersion(major, minor, 2, 2) && !isV25) {
    buildNumber = readU8('build number');
  } else if (isV25) {
    buildNumber = readU32('build number');
    readU8('render flag');
  }

  const iniFile = readFixedString(40, 'ini filename');
  const gndFile = readFixedString(40, 'GND filename');
  const gatFile = readFixedString(40, 'GAT filename');
  const sourceFile = compareVersion(major, minor, 1, 4)
    ? readFixedString(40, 'source filename') : '';

  let water = null;
  if (!isV26) {
    water = {
      level: compareVersion(major, minor, 1, 3) ? readF32('water level') : 0,
      type: 0,
      waveHeight: 0,
      waveSpeed: 0,
      wavePitch: 0,
      textureCyclingInterval: 3,
    };
    if (compareVersion(major, minor, 1, 8)) {
      water.type = readI32('water type');
      water.waveHeight = readF32('water wave height');
      water.waveSpeed = readF32('water wave speed');
      water.wavePitch = readF32('water wave pitch');
    }
    if (compareVersion(major, minor, 1, 9)) {
      water.textureCyclingInterval = readI32('water texture interval');
    }
  }

  const light = {
    longitude: 45,
    latitude: 45,
    diffuse: [1, 1, 1],
    ambient: [0.3, 0.3, 0.3],
    shadowMapAlpha: 1,
  };
  if (compareVersion(major, minor, 1, 5)) {
    light.longitude = readI32('sun longitude');
    light.latitude = readI32('sun latitude');
    light.diffuse = readVec3('diffuse light');
    light.ambient = readVec3('ambient light');
  }
  if (compareVersion(major, minor, 1, 7)) {
    light.shadowMapAlpha = readF32('shadow map alpha');
  }

  let bounds = [0, 0, 0, 0];
  if (compareVersion(major, minor, 1, 6)) {
    bounds = [readI32('top bound'), readI32('bottom bound'), readI32('left bound'), readI32('right bound')];
  }
  if (isV27) {
    const unknownCount = readI32('v2.7 auxiliary count');
    if (unknownCount < 0 || unknownCount > 100000) throw new Error('RSW v2.7 auxiliary count 無效。');
    skip(unknownCount * 4, 'v2.7 auxiliary table');
  }

  const models = [];
  const lights = [];
  const sounds = [];
  const effects = [];
  const objectCount = readI32('object count');
  if (objectCount < 0 || objectCount > 100000) throw new Error('RSW 場景物件數量無效。');
  const propMysteryByte = isV26 && buildNumber > 161;
  for (let i = 0; i < objectCount; i++) {
    const objectType = readI32('object ' + i + ' type');
    if (objectType === 1) {
      const name = compareVersion(major, minor, 1, 3) ? readFixedString(40, 'model name') : '';
      const animationType = compareVersion(major, minor, 1, 3) ? readI32('model animation type') : 0;
      const animationSpeed = compareVersion(major, minor, 1, 3) ? readF32('model animation speed') : 1;
      const blockType = compareVersion(major, minor, 1, 3) ? readI32('model block type') : 0;
      if (propMysteryByte) readU8('model compatibility byte');
      if (isV27) readI32('model compatibility integer');
      models.push({
        name,
        animationType,
        animationSpeed,
        blockType,
        modelName: readFixedString(80, 'model resource'),
        nodeName: readFixedString(80, 'model node'),
        position: readVec3('model position'),
        rotation: readVec3('model rotation'),
        scale: readVec3('model scale'),
      });
    } else if (objectType === 2) {
      lights.push({
        name: readFixedString(80, 'point light name'),
        position: readVec3('point light position'),
        color: readVec3('point light color'),
        range: readF32('point light range'),
      });
    } else if (objectType === 3) {
      const sound = {
        name: readFixedString(80, 'sound name'),
        soundFile: readFixedString(80, 'sound file'),
        position: readVec3('sound position'),
        volume: readF32('sound volume'),
        width: readI32('sound width'),
        height: readI32('sound height'),
        range: readF32('sound range'),
        cycle: compareVersion(major, minor, 2, 0) ? readF32('sound cycle') : 4,
      };
      sounds.push(sound);
    } else if (objectType === 4) {
      effects.push({
        name: readFixedString(80, 'effect name'),
        position: readVec3('effect position'),
        type: readI32('effect type'),
        emitSpeed: readF32('effect speed'),
        params: readVec4('effect parameters'),
      });
    } else {
      throw new Error('RSW 場景物件類型 ' + objectType + ' 無效（項目 ' + i + '）。');
    }
  }

  if (compareVersion(major, minor, 2, 1)) {
    skip(1365 * 48, 'quadtree');
  }
  if (offset !== view.byteLength) {
    throw new Error('RSW v' + major + '.' + minor + ' build ' + buildNumber
      + ' 尚有 ' + (view.byteLength - offset) + ' bytes 未解析。');
  }

  return {
    format: 'roo-rsw-v1',
    version: major + '.' + minor,
    buildNumber,
    iniFile,
    gndFile,
    gatFile,
    sourceFile,
    water,
    light,
    bounds,
    models,
    lights,
    sounds,
    effects,
  };
}

export function analyzeRswPlacementBounds(gnd, rsw, worldScale = 0.2) {
  if (!gnd || !Number.isInteger(gnd.width) || !Number.isInteger(gnd.height)
    || gnd.width < 1 || gnd.height < 1 || !rsw || !Array.isArray(rsw.models)) {
    throw new TypeError('必須提供已解析的 GND 與 RSW 場景資料。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('世界比例必須大於 0，且不可大於 10。');
  }

  // RSW positions are world coordinates; the renderer centers the map at the origin
  // and flips world Z when translating file coordinates into Three.js coordinates.
  const halfWidth = gnd.width * 5 * worldScale;
  const halfDepth = gnd.height * 5 * worldScale;
  const oneTile = 5 * worldScale;
  let withinBounds = 0;
  let withinOneTileMargin = 0;
  let invalidPositions = 0;
  let maximumOutsideDistance = 0;

  for (const [index, model] of rsw.models.entries()) {
    if (!model || !Array.isArray(model.position) || model.position.length < 3
      || !model.position.every(Number.isFinite)) {
      invalidPositions++;
      continue;
    }
    const x = model.position[0] * worldScale;
    const z = -model.position[2] * worldScale;
    const outsideX = Math.max(0, Math.abs(x) - halfWidth);
    const outsideZ = Math.max(0, Math.abs(z) - halfDepth);
    const outside = Math.hypot(outsideX, outsideZ);
    if (outside <= 1e-6) withinBounds++;
    if (outside <= oneTile + 1e-6) withinOneTileMargin++;
    maximumOutsideDistance = Math.max(maximumOutsideDistance, outside);
  }

  const total = rsw.models.length;
  return {
    total,
    withinBounds,
    withinOneTileMargin,
    outsideBounds: Math.max(0, total - invalidPositions - withinBounds),
    invalidPositions,
    maximumOutsideDistance,
    insidePercent: total ? withinBounds / total * 100 : null,
  };
}

export function sampleGndHeightAtGatCell(gnd, cellX, cellY, worldScale = 0.2) {
  if (!gnd || !Number.isInteger(gnd.width) || !Number.isInteger(gnd.height)
    || gnd.width < 1 || gnd.height < 1 || !Array.isArray(gnd.cubes)) {
    throw new TypeError('必須提供已解析的 GND 高度資料。');
  }
  if (!Number.isInteger(cellX) || !Number.isInteger(cellY)
    || cellX < 0 || cellY < 0 || cellX >= gnd.width * 2 || cellY >= gnd.height * 2) {
    throw new RangeError('GAT 格座標超出 GND 地圖範圍。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('世界比例必須大於 0，且不可大於 10。');
  }

  const cubeX = Math.floor(cellX / 2);
  const cubeY = Math.floor(cellY / 2);
  const cube = gnd.cubes[cubeY * gnd.width + cubeX];
  if (!cube) throw new Error('GND 對應 cube 不存在。');

  // GND cubes span 2×2 GAT cells; sample each GAT cell at its center.
  const u = ((cellX % 2) + 0.5) / 2;
  const v = ((cellY % 2) + 0.5) / 2;
  const south = cube.hSW * (1 - u) + cube.hSE * u;
  const north = cube.hNW * (1 - u) + cube.hNE * u;
  const height = south * (1 - v) + north * v;
  if (!Number.isFinite(height)) throw new Error('GND 插值高度不是有限數值。');
  return -height * worldScale;
}

export function compareGndGatHeights(gnd, gat, worldScale = 0.2) {
  if (!gat || !Number.isInteger(gat.width) || !Number.isInteger(gat.height)
    || !gat.heights || gat.width !== gnd.width * 2 || gat.height !== gnd.height * 2
    || gat.heights.length < gat.width * gat.height) {
    throw new Error('GND/GAT 高度比對需要尺寸相符且含完整高度的兩張地圖。');
  }
  const differences = [];
  const count = gat.width * gat.height;
  for (let y = 0; y < gat.height; y++) {
    for (let x = 0; x < gat.width; x++) {
      const cube = gnd.cubes[Math.floor(y / 2) * gnd.width + Math.floor(x / 2)];
      if (!cube || cube.topSurface < 0 || !Number.isFinite(gat.heights[y * gat.width + x])) continue;
      const gndY = sampleGndHeightAtGatCell(gnd, x, y, worldScale);
      const gatY = -gat.heights[y * gat.width + x] * worldScale;
      differences.push(Math.abs(gndY - gatY));
    }
  }
  if (!differences.length) {
    return { samples: 0, meanAbsoluteError: null, p95AbsoluteError: null, maxAbsoluteError: null };
  }
  differences.sort((a, b) => a - b);
  const sum = differences.reduce((acc, value) => acc + value, 0);
  return {
    samples: differences.length,
    meanAbsoluteError: sum / differences.length,
    p95AbsoluteError: differences[Math.min(differences.length - 1, Math.floor(differences.length * 0.95))],
    maxAbsoluteError: differences[differences.length - 1],
    comparedTiles: count,
  };
}

export function buildGndLightmapAtlasData(gnd, posterizationLevel = 16) {
  if (!gnd || !Array.isArray(gnd.lightmapSlices)) {
    throw new TypeError('必須提供已解析的 GND lightmap slices。');
  }
  if (!Number.isInteger(posterizationLevel) || posterizationLevel < 0 || posterizationLevel > 255) {
    throw new Error('lightmap posterization 必須是 0–255 的整數。');
  }
  const slices = gnd.lightmapSlices;
  if (!slices.length) return null;
  if (slices.length > 16384) throw new Error('GND lightmap 超過 16384 個 slice 的安全上限。');

  const sliceWidth = slices[0].width;
  const sliceHeight = slices[0].height;
  const channels = slices[0].channels || 4;
  if (!Number.isInteger(sliceWidth) || !Number.isInteger(sliceHeight)
    || sliceWidth < 1 || sliceHeight < 1 || sliceWidth > 128 || sliceHeight > 128) {
    throw new Error('GND lightmap slice 尺寸無效。');
  }
  for (const [index, slice] of slices.entries()) {
    const pixelCount = slice.width * slice.height;
    const channelCount = slice.channels || 4;
    if (slice.width !== sliceWidth || slice.height !== sliceHeight
      || (channelCount !== 3 && channelCount !== 4)
      || !slice.colorPixels || slice.colorPixels.length !== pixelCount * channelCount
      || slice.shadowPixels && slice.shadowPixels.length !== pixelCount) {
      throw new Error('GND lightmap slice ' + index + ' 尺寸或像素長度無效。');
    }
  }

  const columns = Math.ceil(Math.sqrt(slices.length));
  const rows = Math.ceil(slices.length / columns);
  const gutter = 1;
  const cellWidth = sliceWidth + gutter * 2;
  const cellHeight = sliceHeight + gutter * 2;
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const pixelBytes = width * height * 4;
  if (!Number.isSafeInteger(pixelBytes) || pixelBytes > 128 * 1024 * 1024) {
    throw new Error('GND lightmap atlas 超過 128 MiB 安全上限。');
  }

  const lightMapPixels = new Uint8Array(pixelBytes);
  const aoMapPixels = new Uint8Array(pixelBytes);
  lightMapPixels.fill(255);
  aoMapPixels.fill(255);

  function setRgba(target, x, y, rgba) {
    const at = (y * width + x) * 4;
    target[at] = rgba[0];
    target[at + 1] = rgba[1];
    target[at + 2] = rgba[2];
    target[at + 3] = 255;
  }

  const uvsBySlice = [];
  for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
    const slice = slices[sliceIndex];
    const sourceChannels = slice.channels || 4;
    const column = sliceIndex % columns;
    const row = Math.floor(sliceIndex / columns);
    const baseX = column * cellWidth + gutter;
    const baseY = row * cellHeight + gutter;

    for (let y = 0; y < sliceHeight; y++) {
      for (let x = 0; x < sliceWidth; x++) {
        const pixel = y * sliceWidth + x;
        const src = pixel * sourceChannels;
        let r = slice.colorPixels[src];
        let g = slice.colorPixels[src + 1];
        let b = slice.colorPixels[src + 2];
        if (posterizationLevel > 1) {
          r = Math.floor(r / posterizationLevel) * posterizationLevel;
          g = Math.floor(g / posterizationLevel) * posterizationLevel;
          b = Math.floor(b / posterizationLevel) * posterizationLevel;
        }
        setRgba(lightMapPixels, baseX + x, baseY + y, [r, g, b]);
        const ao = slice.shadowPixels
          ? slice.shadowPixels[pixel]
          : sourceChannels === 4 ? slice.colorPixels[src + 3] : 255;
        setRgba(aoMapPixels, baseX + x, baseY + y, [ao, ao, ao]);
      }
    }

    // Duplicate each slice's border pixels into the atlas gutter to prevent bleed.
    for (let y = 0; y < sliceHeight; y++) {
      for (const target of [lightMapPixels, aoMapPixels]) {
        const rowAt = (baseY + y) * width * 4;
        const firstAt = rowAt + baseX * 4;
        const lastAt = rowAt + (baseX + sliceWidth - 1) * 4;
        target.set(target.subarray(firstAt, firstAt + 4), rowAt + (baseX - 1) * 4);
        target.set(target.subarray(lastAt, lastAt + 4), rowAt + (baseX + sliceWidth) * 4);
      }
    }
    for (let x = 0; x < sliceWidth + 2; x++) {
      for (const target of [lightMapPixels, aoMapPixels]) {
        const topAt = (baseY * width + baseX - 1 + x) * 4;
        const bottomAt = ((baseY + sliceHeight - 1) * width + baseX - 1 + x) * 4;
        target.set(target.subarray(topAt, topAt + 4), ((baseY - 1) * width + baseX - 1 + x) * 4);
        target.set(target.subarray(bottomAt, bottomAt + 4), ((baseY + sliceHeight) * width + baseX - 1 + x) * 4);
      }
    }

    const u0 = (column * cellWidth + gutter + 0.5) / width;
    const u1 = (column * cellWidth + gutter + sliceWidth - 0.5) / width;
    const v0 = (row * cellHeight + gutter + 0.5) / height;
    const v1 = (row * cellHeight + gutter + sliceHeight - 0.5) / height;
    uvsBySlice.push([[u0, v0], [u1, v0], [u0, v1], [u1, v1]]);
  }

  return {
    width,
    height,
    columns,
    rows,
    sliceWidth,
    sliceHeight,
    channels,
    lightMapPixels,
    aoMapPixels,
    uvsBySlice,
  };
}

export function buildGndMeshData(gnd, worldScale = 0.2, lightmapAtlas = null) {
  if (!gnd || !Array.isArray(gnd.cubes) || !Array.isArray(gnd.surfaces)) {
    throw new TypeError('必須提供已解析的 GND 地圖。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('世界比例必須大於 0，且不可大於 10。');
  }
  const { width, height, cubes, surfaces } = gnd;
  if (width * height > 300000) throw new Error('地圖超過原生預覽 30 萬個地表方格的安全上限。');
  const buckets = new Map();
  let quadCount = 0;

  function topColor(tileX, tileY, fallback) {
    if (tileX < 0 || tileY < 0 || tileX >= width || tileY >= height) return fallback;
    const neighbor = cubes[tileX + tileY * width];
    if (!neighbor || neighbor.topSurface < 0 || neighbor.topSurface >= surfaces.length) return fallback;
    return surfaces[neighbor.topSurface].color || fallback;
  }

  function addQuad(surfaceIndex, corners, vertexColors = null) {
    if (surfaceIndex < 0 || surfaceIndex >= surfaces.length) return;
    const surface = surfaces[surfaceIndex];
    const textureIndex = surface.textureIndex;
    if (textureIndex === -1) return;
    const bucketKey = textureIndex >= 0 && textureIndex < gnd.textures.length ? textureIndex : -1;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { textureIndex: bucketKey, positions: [], uvs: [], lightmapUvs: [], colors: [], indices: [] };
      buckets.set(bucketKey, bucket);
    }
    const base = bucket.positions.length / 3;
    for (const corner of corners) {
      const worldHeight = corner.h === 0 ? 0 : -corner.h * worldScale;
      bucket.positions.push(
        (corner.x * 10 - width * 5) * worldScale,
        worldHeight,
        -(corner.z * 10 - height * 5) * worldScale
      );
      const uv = surface.uv[corner.uvIndex];
      bucket.uvs.push(uv[0], uv[1]);
      const lightmapUvs = lightmapAtlas && surface.lightmapIndex >= 0
        ? lightmapAtlas.uvsBySlice[surface.lightmapIndex] : null;
      const lightmapUv = lightmapUvs && lightmapUvs[corner.uvIndex] || [0, 0];
      bucket.lightmapUvs.push(lightmapUv[0], lightmapUv[1]);
      const color = surface.colors && surface.colors[corner.uvIndex]
        || (vertexColors && vertexColors[corner.uvIndex]) || surface.color || [1, 1, 1, 1];
      bucket.colors.push(color[0], color[1], color[2]);
    }
    bucket.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    quadCount++;
  }

  for (let i = 0; i < cubes.length; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const cube = cubes[i];
    const baseSurface = surfaces[cube.topSurface];
    const fallbackColor = baseSurface && baseSurface.color || [1, 1, 1, 1];
    const vertexColors = [
      fallbackColor,
      topColor(x + 1, y, fallbackColor),
      topColor(x, y + 1, fallbackColor),
      topColor(x + 1, y + 1, fallbackColor),
    ];
    addQuad(cube.topSurface, [
      { x, z: y, h: cube.hSW, uvIndex: 0 },
      { x: x + 1, z: y, h: cube.hSE, uvIndex: 1 },
      { x, z: y + 1, h: cube.hNW, uvIndex: 2 },
      { x: x + 1, z: y + 1, h: cube.hNE, uvIndex: 3 },
    ], vertexColors);

    if (cube.northSurface >= 0 && y + 1 < height) {
      const neighbor = cubes[i + width];
      addQuad(cube.northSurface, [
        { x, z: y + 1, h: cube.hNW, uvIndex: 2 },
        { x: x + 1, z: y + 1, h: cube.hNE, uvIndex: 3 },
        { x, z: y + 1, h: neighbor.hSW, uvIndex: 0 },
        { x: x + 1, z: y + 1, h: neighbor.hSE, uvIndex: 1 },
      ]);
    }

    if (cube.eastSurface >= 0 && x + 1 < width) {
      const neighbor = cubes[i + 1];
      addQuad(cube.eastSurface, [
        { x: x + 1, z: y + 1, h: cube.hNE, uvIndex: 3 },
        { x: x + 1, z: y, h: cube.hSE, uvIndex: 1 },
        { x: x + 1, z: y + 1, h: neighbor.hNW, uvIndex: 2 },
        { x: x + 1, z: y, h: neighbor.hSW, uvIndex: 0 },
      ]);
    }
  }

  return {
    buckets: [...buckets.values()],
    quadCount,
    cubeCount: cubes.length,
  };
}

export function insetGndTextureUvs(uvs, textureWidth, textureHeight) {
  if (!uvs || typeof uvs.length !== 'number' || uvs.length % 2 !== 0) {
    throw new TypeError('UV 必須是偶數長度的陣列。');
  }
  if (!Number.isInteger(textureWidth) || !Number.isInteger(textureHeight)
    || textureWidth < 1 || textureHeight < 1) {
    throw new Error('貼圖寬高必須是正整數。');
  }
  const result = Float32Array.from(uvs);
  const halfU = 0.5 / textureWidth;
  const halfV = 0.5 / textureHeight;
  for (let i = 0; i < result.length; i += 2) {
    result[i] = halfU + result[i] * (1 - 2 * halfU);
    result[i + 1] = halfV + result[i + 1] * (1 - 2 * halfV);
  }
  return result;
}

// TextureCyclingInterval is measured in frames; the classic client advances at ~60 FPS.
// Keep the 32-frame sequence aligned to that cadence, with sane limits for malformed data.
export function sampleRoWaterTextureIntervalMs(interval) {
  const frames = Number.isFinite(interval) && interval > 0 ? interval : 3;
  return Math.max(1000 / 60, Math.min(4000, frames * (1000 / 60)));
}

// RSW describes vertex-height waves separately from the cycling water textures.
// This lightweight sine-wave approximation uses a stable 3.5 s cycle; it is not
// claimed to be pixel-identical to the original client's proprietary animation.
const RO_WATER_WAVE_CYCLE_SECONDS = 3.5;

export function sampleRoWaterWaveOffset(waterConfig, gridX, gridZ, elapsedSeconds, worldScale = 0.2) {
  if (!waterConfig || typeof waterConfig !== 'object') {
    throw new TypeError('必須提供 RO 水面參數。');
  }
  if (![gridX, gridZ, elapsedSeconds].every(Number.isFinite)) {
    throw new TypeError('水波座標與時間必須是有限數值。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('水波世界比例必須大於 0，且不可大於 10。');
  }
  const amplitude = Number(waterConfig.waveHeight);
  if (!Number.isFinite(amplitude) || Math.abs(amplitude) < 1e-8) return 0;
  const phaseOffset = Number.isFinite(waterConfig.waveSpeed) ? waterConfig.waveSpeed : 0;
  const pitchDegrees = Number.isFinite(waterConfig.wavePitch) ? waterConfig.wavePitch : 0;
  // A GND surface spans 2×2 GAT cells, so one GAT-grid step adds half a pitch.
  const spatialPhase = (gridX + gridZ) * pitchDegrees * Math.PI / 360;
  const temporalPhase = elapsedSeconds * Math.PI * 2 / RO_WATER_WAVE_CYCLE_SECONDS;
  // Renderer Y is mirrored relative to the source file's vertical axis.
  const offset = -Math.sin(temporalPhase + phaseOffset + spatialPhase) * Math.abs(amplitude) * worldScale;
  return Math.abs(offset) < 1e-12 ? 0 : offset;
}

/**
 * Fill a caller-owned buffer with the water-wave offset for each x+z diagonal.
 * Water planes update synchronously, so the renderer can reuse one shared buffer
 * instead of allocating a new Float32Array for every plane on every animation frame.
 */
export function fillRoWaterWaveOffsets(
  waterConfig, mapWidth, mapHeight, elapsedSeconds, target, worldScale = 0.2
) {
  if (!waterConfig || typeof waterConfig !== 'object') {
    throw new TypeError('必須提供 RO 水面參數。');
  }
  if (![mapWidth, mapHeight].every(Number.isInteger)
    || mapWidth < 1 || mapHeight < 1 || mapWidth > 8192 || mapHeight > 8192) {
    throw new Error('水波地圖尺寸無效。');
  }
  if (!Number.isFinite(elapsedSeconds)) {
    throw new TypeError('水波時間必須是有限數值。');
  }
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('水波世界比例必須大於 0，且不可大於 10。');
  }

  const required = mapWidth + mapHeight + 1;
  if (!(target instanceof Float32Array) || target.length < required) {
    throw new TypeError('水波暫存緩衝區尺寸不足。');
  }

  const amplitude = Number(waterConfig.waveHeight);
  if (!Number.isFinite(amplitude) || Math.abs(amplitude) < 1e-8) {
    target.fill(0, 0, required);
    return target;
  }
  const phaseOffset = Number.isFinite(waterConfig.waveSpeed) ? waterConfig.waveSpeed : 0;
  const pitchDegrees = Number.isFinite(waterConfig.wavePitch) ? waterConfig.wavePitch : 0;
  const phaseStep = pitchDegrees * Math.PI / 360;
  const temporalPhase = elapsedSeconds * Math.PI * 2 / RO_WATER_WAVE_CYCLE_SECONDS;
  const scaledAmplitude = Math.abs(amplitude) * worldScale;

  for (let diagonal = 0; diagonal < required; diagonal++) {
    const offset = -Math.sin(temporalPhase + phaseOffset + diagonal * phaseStep) * scaledAmplitude;
    target[diagonal] = Math.abs(offset) < 1e-12 ? 0 : offset;
  }
  return target;
}

export function buildGndWaterMeshData(gat, waterLevel, worldScale = 0.2) {
  if (!gat || !Number.isInteger(gat.width) || !Number.isInteger(gat.height)
    || gat.width < 1 || gat.height < 1 || !gat.terrainTypes || !gat.water) {
    throw new TypeError('必須提供已解析的 GAT 水域資料。');
  }
  if (!Number.isFinite(waterLevel)) throw new Error('水面高度必須是有限數值。');
  if (!Number.isFinite(worldScale) || worldScale <= 0 || worldScale > 10) {
    throw new Error('世界比例必須大於 0，且不可大於 10。');
  }
  const total = gat.width * gat.height;
  if (!Number.isSafeInteger(total) || total > 1000000
    || gat.terrainTypes.length < total || gat.water.length < total) {
    throw new Error('GAT 水域格線尺寸無效或超過安全上限。');
  }

  const positions = [];
  const uvs = [];
  const indices = [];
  const tileCoordinates = [];
  const size = 5 * worldScale;
  const y = -waterLevel * worldScale;
  let waterTileCount = 0;

  for (let i = 0; i < total; i++) {
    // GAT 1.3 has an explicit water flag; legacy GAT 1.2 maps may label water as type 6.
    const marked = gat.water[i] === 1
      || (gat.version === '1.2' && gat.terrainTypes[i] === 6);
    if (!marked) continue;

    const x = i % gat.width;
    const z = Math.floor(i / gat.width);
    tileCoordinates.push(x, z);
    const x0 = (x - gat.width / 2) * size;
    const x1 = x0 + size;
    const z1 = (gat.height / 2 - z) * size;
    const z0 = z1 - size;
    const base = positions.length / 3;
    positions.push(
      x0, y, z0,
      x1, y, z0,
      x0, y, z1,
      x1, y, z1
    );
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    waterTileCount++;
  }

  return { positions, uvs, indices, tileCoordinates, waterTileCount, level: waterLevel };
}

/**
 * Split the GAT water mask across the water-plane grid stored in GND 1.8/1.9.
 * GND 1.8 stores one level per plane; GND 1.9 stores a complete config per plane.
 */
export function buildGndWaterMeshDataByPlane(gat, waterConfig, worldScale = 0.2) {
  if (!waterConfig || typeof waterConfig !== 'object') {
    throw new TypeError('必須提供 GND／RSW 水面設定。');
  }
  if (!gat || !Number.isInteger(gat.width) || !Number.isInteger(gat.height)
    || !gat.terrainTypes || !gat.water) {
    throw new TypeError('必須提供已解析的 GAT 水域資料。');
  }

  const total = gat.width * gat.height;
  const gridU = Number.isInteger(waterConfig.gridU) && waterConfig.gridU > 0 ? waterConfig.gridU : 1;
  const gridV = Number.isInteger(waterConfig.gridV) && waterConfig.gridV > 0 ? waterConfig.gridV : 1;
  if (gridU > 64 || gridV > 64 || gridU * gridV > 4096) {
    throw new Error('水面分區數量超過安全上限。');
  }

  const declaredPlanes = Array.isArray(waterConfig.planes) ? waterConfig.planes : [];
  const planes = declaredPlanes.length
    ? declaredPlanes.slice(0, gridU * gridV)
    : [{ ...waterConfig, gridX: 0, gridY: 0, wholeMap: true }];
  const results = [];
  let waterTileCount = 0;

  for (let planeIndex = 0; planeIndex < planes.length; planeIndex++) {
    const plane = planes[planeIndex];
    if (!plane || !Number.isFinite(plane.level)) {
      throw new Error('第 ' + planeIndex + ' 組水面缺少有效水位。');
    }
    const gridX = Number.isInteger(plane.gridX) ? plane.gridX : planeIndex % gridU;
    const gridY = Number.isInteger(plane.gridY) ? plane.gridY : Math.floor(planeIndex / gridU);
    const filteredWater = new Uint8Array(total);
    const filteredTypes = new Uint16Array(total);

    for (let i = 0; i < total; i++) {
      const x = i % gat.width;
      const y = Math.floor(i / gat.width);
      const isWaterTile = gat.water[i] === 1
        || (gat.version === '1.2' && gat.terrainTypes[i] === 6);
      if (!isWaterTile) continue;

      const belongsToPlane = plane.wholeMap
        || (Math.floor(x * gridU / gat.width) === gridX
          && Math.floor(y * gridV / gat.height) === gridY);
      if (!belongsToPlane) continue;
      filteredWater[i] = 1;
      filteredTypes[i] = gat.terrainTypes[i];
    }

    const filteredGat = {
      ...gat,
      water: filteredWater,
      terrainTypes: filteredTypes,
    };
    const data = buildGndWaterMeshData(filteredGat, plane.level, worldScale);
    if (!data.waterTileCount) continue;
    results.push({ config: plane, data, gridX, gridY });
    waterTileCount += data.waterTileCount;
  }

  return { planes: results, waterTileCount };
}

export function resolveRagassetsMapUrls(mapId, manifest, baseUrl = RAGASSETS_BASE_URL) {
  const id = String(mapId || '').toLowerCase();
  if (!MAP_ID_PATTERN.test(id)) throw new Error('地圖 ID 格式無效。');
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('地圖 manifest 格式無效。');
  }
  if (manifest.map && String(manifest.map).toLowerCase() !== id) {
    throw new Error('地圖 manifest ID 不一致。');
  }

  const root = new URL('/maps/' + id + '/', baseUrl);
  const manifestUrl = new URL('manifest.json', root);
  const files = manifest.files && typeof manifest.files === 'object' ? manifest.files : {};
  const urls = {
    manifest: manifestUrl.href, gat: null, gnd: null, rsw: null,
    textures: {}, models: {}, waterFrames: [], waterFramesByType: {}, waterType: null,
  };
  for (const ext of ['gat', 'gnd', 'rsw']) {
    const name = files[ext] || id + '.' + ext;
    if (name !== id + '.' + ext) throw new Error('manifest 的 ' + ext.toUpperCase() + ' 檔名不符合地圖 ID。');
    urls[ext] = new URL(name, root).href;
  }

  const textures = manifest.textures && typeof manifest.textures === 'object'
    ? manifest.textures : {};
  for (const [name, reference] of Object.entries(textures)) {
    if (typeof reference !== 'string' || !TEXTURE_BLOB_PATTERN.test(reference)) continue;
    const url = new URL(reference, manifestUrl);
    if (url.origin !== manifestUrl.origin || !/^\/maps\/_t\/[a-f0-9]{16}\.png$/i.test(url.pathname)) continue;
    urls.textures[normalizeTextureName(name)] = url.href;
  }

  const models = manifest.models && typeof manifest.models === 'object'
    ? manifest.models : {};
  for (const [name, reference] of Object.entries(models)) {
    if (typeof reference !== 'string' || !MODEL_BLOB_PATTERN.test(reference)) continue;
    const url = new URL(reference, manifestUrl);
    if (url.origin !== manifestUrl.origin || !/^\/maps\/_m\/[a-f0-9]{16}\.rsm2?$/i.test(url.pathname)) continue;
    urls.models[normalizeModelName(name)] = url.href;
  }
  function safeWaterFrames(references) {
    const result = [];
    for (const reference of Array.isArray(references) ? references : []) {
      if (typeof reference !== 'string' || !/^\.\.\/_w\/[a-f0-9]{16}\.jpg$/i.test(reference)) continue;
      const url = new URL(reference, manifestUrl);
      if (url.origin !== manifestUrl.origin || !/^\/maps\/_w\/[a-f0-9]{16}\.jpg$/i.test(url.pathname)) continue;
      result.push(url.href);
    }
    return result;
  }

  const rawWater = manifest.water;
  const waterSets = Array.isArray(rawWater) ? rawWater
    : rawWater && typeof rawWater === 'object' ? [rawWater] : [];
  if (rawWater && !Array.isArray(rawWater) && typeof rawWater === 'object') {
    if (Array.isArray(rawWater.planes)) waterSets.push(...rawWater.planes);
    if (rawWater.types && typeof rawWater.types === 'object' && !Array.isArray(rawWater.types)) {
      for (const [type, config] of Object.entries(rawWater.types)) {
        if (config && typeof config === 'object') waterSets.push({ ...config, type: config.type ?? Number(type) });
      }
    }
  }
  if (Array.isArray(manifest.waters)) waterSets.push(...manifest.waters);

  let defaultWaterSetFound = false;
  for (const waterSet of waterSets) {
    if (!waterSet || typeof waterSet !== 'object') continue;
    const frames = safeWaterFrames(waterSet.frames);
    if (!frames.length) continue;
    const type = Number(waterSet.type);
    if (Number.isInteger(type) && type >= 0 && type <= 65535) {
      urls.waterFramesByType[String(type)] = frames;
      if (urls.waterType === null) urls.waterType = type;
    }
    if (!defaultWaterSetFound) {
      urls.waterFrames = frames;
      if (Number.isInteger(type) && type >= 0 && type <= 65535) urls.waterType = type;
      defaultWaterSetFound = true;
    }
  }
  return urls;
}

export { normalizeTextureName };
