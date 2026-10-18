/* RO 原生 GAT 地形資料解析。
   只負責讀取格子高度與通行旗標；必須搭配同一張地圖的 GND/RSW 才能完整呈現場景。
   格式參考：Ragnarok Research Lab 的 GAT 1.2 / 1.3 規格。 */
(function exposeRoMapData(root) {
  'use strict';

  const GAT_HEADER_BYTES = 14;
  const GAT_TILE_BYTES = 20;
  const GAT_MAX_TILES = 2000000;

  function asBytes(input) {
    if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') {
      return new Uint8Array(input);
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new TypeError('GAT 解析需要 ArrayBuffer 或 TypedArray。');
  }

  function terrainTypeOf(raw, minorVersion) {
    // GAT 1.3 將地形代碼放在最高位元組，最低位元組可能包含水面旗標。
    return minorVersion >= 3 ? (raw >>> 24) & 0xff : raw & 0xff;
  }

  function isBlockedTerrainType(type) {
    // 已知 1 為障礙格、5 為不可行走的懸崖；其餘旗標保留供原始資料查閱。
    return type === 1 || type === 5;
  }

  function parseGat(input) {
    const bytes = asBytes(input);
    if (bytes.byteLength < GAT_HEADER_BYTES) {
      throw new Error('GAT 檔案太短，缺少標頭。');
    }

    const hasMagicAt = offset =>
      bytes[offset] === 0x47 && bytes[offset + 1] === 0x52
      && bytes[offset + 2] === 0x41 && bytes[offset + 3] === 0x54;
    // 少數舊格式在 GRAT 前多一個零位元組。
    const base = hasMagicAt(0) ? 0 : (bytes[0] === 0 && hasMagicAt(1) ? 1 : -1);
    if (base < 0) throw new Error('無效的 GAT 標頭（預期 GRAT）。');
    if (bytes.byteLength < base + GAT_HEADER_BYTES) {
      throw new Error('GAT 檔案太短，缺少尺寸資料。');
    }

    const majorVersion = bytes[base + 4];
    const minorVersion = bytes[base + 5];
    if (majorVersion !== 1 || (minorVersion !== 2 && minorVersion !== 3)) {
      throw new Error('尚不支援 GAT ' + majorVersion + '.' + minorVersion + '。');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(base + 6, true);
    const height = view.getUint32(base + 10, true);
    const tileCount = width * height;
    if (!width || !height || !Number.isSafeInteger(tileCount) || tileCount > GAT_MAX_TILES) {
      throw new Error('GAT 地圖尺寸不合法或超過安全上限。');
    }

    const tilesOffset = base + GAT_HEADER_BYTES;
    const requiredBytes = tilesOffset + tileCount * GAT_TILE_BYTES;
    if (bytes.byteLength < requiredBytes) {
      throw new Error('GAT 格子資料不完整：預期 ' + requiredBytes + ' bytes，實得 ' + bytes.byteLength + ' bytes。');
    }

    const heights = new Float32Array(tileCount * 4);
    const terrainTypesRaw = new Uint32Array(tileCount);
    for (let i = 0; i < tileCount; i++) {
      const offset = tilesOffset + i * GAT_TILE_BYTES;
      const h = i * 4;
      heights[h] = view.getFloat32(offset, true);
      heights[h + 1] = view.getFloat32(offset + 4, true);
      heights[h + 2] = view.getFloat32(offset + 8, true);
      heights[h + 3] = view.getFloat32(offset + 12, true);
      if (!Number.isFinite(heights[h]) || !Number.isFinite(heights[h + 1])
        || !Number.isFinite(heights[h + 2]) || !Number.isFinite(heights[h + 3])) {
        throw new Error('GAT 第 ' + i + ' 格含有無效高度。');
      }
      terrainTypesRaw[i] = view.getUint32(offset + 16, true);
    }

    function indexOf(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y)
        || x < 0 || y < 0 || x >= width || y >= height) return -1;
      // GAT 座標原點在地圖西南角；y=0 是南側第一列。
      return y * width + x;
    }

    function getTile(x, y) {
      const index = indexOf(x, y);
      if (index < 0) return null;
      const raw = terrainTypesRaw[index];
      const terrainType = terrainTypeOf(raw, minorVersion);
      const h = index * 4;
      return {
        x,
        y,
        southWestAltitude: heights[h],
        southEastAltitude: heights[h + 1],
        northWestAltitude: heights[h + 2],
        northEastAltitude: heights[h + 3],
        terrainType,
        terrainTypeRaw: raw,
        isWater: minorVersion >= 3 && (raw & 0x80) !== 0,
        walkable: !isBlockedTerrainType(terrainType),
      };
    }

    function isWalkable(x, y) {
      const index = indexOf(x, y);
      return index >= 0 && !isBlockedTerrainType(terrainTypeOf(terrainTypesRaw[index], minorVersion));
    }

    function isWater(x, y) {
      const index = indexOf(x, y);
      return index >= 0 && minorVersion >= 3 && (terrainTypesRaw[index] & 0x80) !== 0;
    }

    return {
      format: 'GAT',
      majorVersion,
      minorVersion,
      version: majorVersion + '.' + minorVersion,
      width,
      height,
      tileCount,
      trailingBytes: bytes.byteLength - requiredBytes,
      heights,
      terrainTypesRaw,
      indexOf,
      getTile,
      isWalkable,
      isWater,
    };
  }

  async function loadGat(url, fetcher) {
    if (typeof url !== 'string' || !url.trim()) throw new TypeError('請提供 GAT 檔案網址。');
    const request = typeof fetcher === 'function'
      ? fetcher
      : (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (!request) throw new Error('目前環境沒有 fetch，無法載入 GAT 檔案。');
    const response = await request(url);
    if (!response || response.ok === false) {
      const status = response && response.status ? '（HTTP ' + response.status + '）' : '';
      throw new Error('GAT 載入失敗' + status + '。');
    }
    return parseGat(await response.arrayBuffer());
  }

  root.ROMapData = Object.freeze({
    parseGat,
    loadGat,
    terrainTypeOf,
  });
})(typeof window !== 'undefined' ? window : globalThis);
