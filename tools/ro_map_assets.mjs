const MAP_ID_PATTERN = /^[a-z0-9_@-]{1,64}$/;
const TEXTURE_BLOB_PATTERN = /^\.\.\/_t\/[a-f0-9]{16}\.png$/i;

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

  const lightmapCount = view.getInt32(offset, true); offset += 4;
  const lightmapWidth = view.getInt32(offset, true); offset += 4;
  const lightmapHeight = view.getInt32(offset, true); offset += 4;
  const cellsPerGrid = view.getInt32(offset, true); offset += 4;
  if (lightmapCount < 0 || lightmapCount > 1000000
    || lightmapWidth < 0 || lightmapHeight < 0
    || lightmapWidth > 128 || lightmapHeight > 128 || cellsPerGrid < 0) {
    throw new Error('GND lightmap 區段標頭無效。');
  }
  const lightmapBytes = lightmapCount * lightmapWidth * lightmapHeight * 4;
  if (!Number.isSafeInteger(lightmapBytes) || offset + lightmapBytes + 4 > length) {
    throw new Error('GND lightmap 區段超出檔案長度。');
  }
  offset += lightmapBytes;

  const surfaceCount = view.getInt32(offset, true);
  offset += 4;
  if (surfaceCount < 0 || surfaceCount > 1000000) {
    throw new Error('GND surface 數量無效。');
  }

  const surfaceStride = 40;
  const cubeOffset = offset + surfaceCount * surfaceStride;
  const tailOffset = cubeOffset + cubeCount * 28;
  if (tailOffset > length || !validWaterTail(view, tailOffset, [major, minor])) {
    throw new Error('GND surface／cube 區段長度不符；預期 40-byte surface 記錄。');
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
    const textureIndex = view.getInt16(at + 32, true);
    const lightmapIndex = view.getInt16(at + 34, true);
    const c = at + 36;
    const color = [
      view.getUint8(c + 2) / 255,
      view.getUint8(c + 1) / 255,
      view.getUint8(c) / 255,
      view.getUint8(c + 3) / 255,
    ];
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
      color,
    });
  }

  let water = null;
  if (minor >= 8) {
    const base = tailOffset;
    water = {
      level: view.getFloat32(base, true),
      type: view.getInt32(base + 4, true),
      waveHeight: view.getFloat32(base + 8, true),
      waveSpeed: view.getFloat32(base + 12, true),
      wavePitch: view.getFloat32(base + 16, true),
      textureCyclingInterval: view.getInt32(base + 20, true),
      gridU: view.getInt32(base + 24, true),
      gridV: view.getInt32(base + 28, true),
    };
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
    surfaceRecordBytes: surfaceStride,
    surfaces,
    cubes,
    water,
  };
}

export function buildGndMeshData(gnd, worldScale = 0.2) {
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

  function addQuad(surfaceIndex, corners) {
    if (surfaceIndex < 0 || surfaceIndex >= surfaces.length) return;
    const surface = surfaces[surfaceIndex];
    const textureIndex = surface.textureIndex;
    if (textureIndex === -1) return;
    const bucketKey = textureIndex >= 0 && textureIndex < gnd.textures.length ? textureIndex : -1;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { textureIndex: bucketKey, positions: [], uvs: [], colors: [], indices: [] };
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
      const color = corner.color || surface.color || [1, 1, 1, 1];
      bucket.colors.push(color[0], color[1], color[2]);
    }
    bucket.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    quadCount++;
  }

  for (let i = 0; i < cubes.length; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const cube = cubes[i];
    addQuad(cube.topSurface, [
      { x, z: y, h: cube.hSW, uvIndex: 0 },
      { x: x + 1, z: y, h: cube.hSE, uvIndex: 1 },
      { x, z: y + 1, h: cube.hNW, uvIndex: 2 },
      { x: x + 1, z: y + 1, h: cube.hNE, uvIndex: 3 },
    ]);

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
  const urls = { manifest: manifestUrl.href, gat: null, gnd: null, rsw: null, textures: {} };
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
  return urls;
}

export { normalizeTextureName };
