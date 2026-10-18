/* RO GAT 通行格與路徑搜尋。
   座標原點位於西南角；x 向東增加，y 向北增加。
   只把合法的 RO 地形通行資料當成碰撞依據，不猜測地形。 */
const RO_WALKMAP_FORMAT = 'roo-walkmap-v1';
const RO_PATH_DIRECTIONS = [
  [1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10],
  [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14],
];

function decodeRoWalkMapData(data) {
  if (!data || data.format !== RO_WALKMAP_FORMAT) throw new Error('不支援的 RO 通行格格式。');
  const width = data.width;
  const height = data.height;
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 8192 || height > 8192
    || width * height > 16000000) {
    throw new Error('RO 地圖尺寸無效。');
  }
  if (typeof data.walkableRle !== 'string' || !data.walkableRle.length) {
    throw new Error('RO 地圖缺少通行格資料。');
  }

  const total = width * height;
  const walkable = new Uint8Array(total);
  let offset = 0;
  const runs = data.walkableRle.split(',');
  for (const run of runs) {
    const match = /^([1-9][0-9]*):([01])$/.exec(run);
    if (!match) throw new Error('RO 通行格 RLE 資料格式錯誤。');
    const count = Number(match[1]);
    const value = Number(match[2]);
    if (!Number.isSafeInteger(count) || offset + count > total) {
      throw new Error('RO 通行格資料超出地圖範圍。');
    }
    walkable.fill(value, offset, offset + count);
    offset += count;
  }
  if (offset !== total) throw new Error('RO 通行格資料長度與地圖尺寸不符。');

  return {
    format: RO_WALKMAP_FORMAT,
    mapId: String(data.mapId || ''),
    width,
    height,
    coordinateOrigin: 'south-west',
    walkable,
  };
}

function isRoMapCellWalkable(map, x, y) {
  if (!map || !map.walkable || !Number.isInteger(x) || !Number.isInteger(y)
    || x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.walkable[y * map.width + x] === 1;
}

function findNearestRoWalkableCell(map, x, y, maxRadius) {
  if (!map || !map.walkable || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const limit = Number.isInteger(maxRadius) ? Math.max(0, Math.min(64, maxRadius)) : 8;
  const originX = Math.max(0, Math.min(map.width - 1, Math.floor(x)));
  const originY = Math.max(0, Math.min(map.height - 1, Math.floor(y)));

  for (let radius = 0; radius <= limit; radius++) {
    let best = null;
    let bestDistance = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (radius && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cx = originX + dx;
        const cy = originY + dy;
        if (!isRoMapCellWalkable(map, cx, cy)) continue;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          best = { x: cx, y: cy };
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function findRoPath(map, start, target) {
  if (!map || !map.walkable || !start || !target
    || !isRoMapCellWalkable(map, start.x, start.y)
    || !isRoMapCellWalkable(map, target.x, target.y)) return null;

  const total = map.width * map.height;
  const startId = start.y * map.width + start.x;
  const targetId = target.y * map.width + target.x;
  if (startId === targetId) return [{ x: start.x, y: start.y }];

  // 16,000,000 格上限下，最長路徑成本遠低於 Uint32 上限。
  const scores = new Uint32Array(total);
  scores.fill(0xffffffff);
  const parents = new Int32Array(total);
  parents.fill(-1);
  const closed = new Uint8Array(total);
  const heap = [];
  const heuristic = (x, y) => {
    const dx = Math.abs(target.x - x);
    const dy = Math.abs(target.y - y);
    const diagonal = Math.min(dx, dy);
    return diagonal * 14 + (Math.max(dx, dy) - diagonal) * 10;
  };
  const push = node => {
    let i = heap.length;
    heap.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].f <= node.f) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) break;
        let child = left;
        if (right < heap.length && heap[right].f < heap[left].f) child = right;
        if (heap[child].f >= last.f) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return first;
  };

  scores[startId] = 0;
  push({ id: startId, x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y) });
  let expanded = 0;

  while (heap.length && expanded < total) {
    const current = pop();
    if (closed[current.id] || current.g !== scores[current.id]) continue;
    if (current.id === targetId) {
      const path = [];
      let id = targetId;
      while (id !== -1) {
        path.push({ x: id % map.width, y: Math.floor(id / map.width) });
        if (id === startId) break;
        id = parents[id];
      }
      if (path[path.length - 1].x !== start.x || path[path.length - 1].y !== start.y) return null;
      path.reverse();
      return path;
    }

    closed[current.id] = 1;
    expanded++;
    for (const direction of RO_PATH_DIRECTIONS) {
      const dx = direction[0];
      const dy = direction[1];
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isRoMapCellWalkable(map, nx, ny)) continue;
      if (dx && dy
        && (!isRoMapCellWalkable(map, current.x + dx, current.y)
          || !isRoMapCellWalkable(map, current.x, current.y + dy))) continue;

      const nextId = ny * map.width + nx;
      if (closed[nextId]) continue;
      const nextG = current.g + direction[2];
      if (nextG >= scores[nextId]) continue;
      scores[nextId] = nextG;
      parents[nextId] = current.id;
      push({ id: nextId, x: nx, y: ny, g: nextG, f: nextG + heuristic(nx, ny) });
    }
  }
  return null;
}

function roMapCellFromScreenPoint(map, clientX, clientY, rect) {
  if (!map || !rect || !rect.width || !rect.height
    || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  if (clientX < rect.left || clientY < rect.top
    || clientX >= rect.left + rect.width || clientY >= rect.top + rect.height) return null;
  const x = Math.floor((clientX - rect.left) / rect.width * map.width);
  const displayRow = Math.floor((clientY - rect.top) / rect.height * map.height);
  return { x, y: map.height - 1 - displayRow };
}
