/* 普隆德拉 GAT 衍生阻擋區：只依賴倉庫內靜態資料。 */
(function exposeRoPronteraMap(root) {
  'use strict';

  const ASSET_URL = 'data/maps/prontera-blocked-zones.json';
  const MAP_SIZE = 104;
  const WORLD_HALF_SIZE = 52;
  let cachedMap = null;
  let loading = null;

  function buildGrid(zones, size, halfSize) {
    const gridSize = Number(size) || MAP_SIZE;
    const half = Number(halfSize) || WORLD_HALF_SIZE;
    if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 512
      || !Number.isFinite(half) || half <= 0) {
      throw new RangeError('普隆德拉碰撞網格尺寸不合法。');
    }
    if (!Array.isArray(zones) || zones.length > 5000) {
      throw new TypeError('普隆德拉阻擋區資料格式不合法。');
    }

    const blocked = new Uint8Array(gridSize * gridSize);
    for (const zone of zones) {
      if (!zone || zone.kind !== 'rect'
        || !Number.isFinite(zone.x) || !Number.isFinite(zone.z)
        || !Number.isFinite(zone.width) || !Number.isFinite(zone.depth)
        || zone.width <= 0 || zone.depth <= 0) {
        throw new TypeError('普隆德拉含有不支援的阻擋區。');
      }
      const minX = zone.x - zone.width / 2;
      const maxX = zone.x + zone.width / 2;
      const minZ = zone.z - zone.depth / 2;
      const maxZ = zone.z + zone.depth / 2;
      const x0 = Math.max(0, Math.ceil(minX + half - 0.5));
      const x1 = Math.min(gridSize, Math.ceil(maxX + half - 0.5));
      for (let x = x0; x < x1; x++) {
        const worldX = x - half + 0.5;
        for (let y = 0; y < gridSize; y++) {
          const worldZ = half - y - 0.5;
          if (worldZ >= minZ && worldZ < maxZ) blocked[y * gridSize + x] = 1;
        }
      }
    }

    // 用既有 GAT 解析／A* 核心承接衍生格網；高度為零，並非原始 .gat 檔。
    const bytesPerTile = 20;
    const buffer = new ArrayBuffer(14 + blocked.length * bytesPerTile);
    const bytes = new Uint8Array(buffer);
    bytes.set([0x47, 0x52, 0x41, 0x54, 1, 2], 0);
    const view = new DataView(buffer);
    view.setUint32(6, gridSize, true);
    view.setUint32(10, gridSize, true);
    for (let i = 0; i < blocked.length; i++) {
      view.setUint32(14 + i * bytesPerTile + 16, blocked[i] ? 1 : 0, true);
    }
    return root.ROMapData.parseGat(buffer);
  }

  async function load(fetcher) {
    if (cachedMap) return cachedMap;
    if (loading) return loading;
    const request = typeof fetcher === 'function'
      ? fetcher
      : (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (!request) throw new Error('目前環境無法載入普隆德拉地形資料。');

    loading = Promise.resolve(request(ASSET_URL))
      .then(response => {
        if (!response || response.ok === false || typeof response.json !== 'function') {
          throw new Error('普隆德拉地形資料載入失敗。');
        }
        return response.json();
      })
      .then(data => {
        cachedMap = buildGrid(data);
        return cachedMap;
      })
      .catch(error => {
        loading = null;
        throw error;
      });
    return loading;
  }

  root.ROPronteraMap = Object.freeze({ buildGrid, load });
})(typeof window !== 'undefined' ? window : globalThis);
