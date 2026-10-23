const MINIMAP_COLORS = Object.freeze({
  walkable: [62, 119, 77, 255],
  water: [70, 145, 207, 255],
  blocked: [87, 63, 75, 255],
  cliff: [190, 136, 70, 255],
});

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function getRoExplorerMinimapSize(mapWidth, mapHeight, maxSize = 196) {
  if (!isPositiveInteger(mapWidth) || !isPositiveInteger(mapHeight)
    || mapWidth * mapHeight > 4000000
    || !isPositiveInteger(maxSize) || maxSize > 512) {
    throw new RangeError('小地圖尺寸無效。');
  }
  const scale = maxSize / Math.max(mapWidth, mapHeight);
  return {
    width: Math.max(1, Math.round(mapWidth * scale)),
    height: Math.max(1, Math.round(mapHeight * scale)),
  };
}

export function buildRoExplorerMinimapPixels(gat, pixelWidth, pixelHeight) {
  if (!gat || !isPositiveInteger(gat.width) || !isPositiveInteger(gat.height)
    || gat.width * gat.height > 4000000
    || !isPositiveInteger(pixelWidth) || !isPositiveInteger(pixelHeight)
    || pixelWidth > 512 || pixelHeight > 512
    || !gat.walkable || gat.walkable.length !== gat.width * gat.height) {
    throw new TypeError('小地圖 GAT 或輸出尺寸無效。');
  }

  const total = pixelWidth * pixelHeight;
  const pixels = new Uint8ClampedArray(total * 4);
  for (let y = 0; y < pixelHeight; y++) {
    const mapY = Math.min(gat.height - 1, Math.floor((y + 0.5) * gat.height / pixelHeight));
    for (let x = 0; x < pixelWidth; x++) {
      const mapX = Math.min(gat.width - 1, Math.floor((x + 0.5) * gat.width / pixelWidth));
      const sourceIndex = mapY * gat.width + mapX;
      const terrain = gat.terrainTypes ? gat.terrainTypes[sourceIndex] : 0;
      const color = gat.water && gat.water[sourceIndex]
        ? MINIMAP_COLORS.water
        : (terrain === 5 ? MINIMAP_COLORS.cliff
          : (gat.walkable[sourceIndex] ? MINIMAP_COLORS.walkable : MINIMAP_COLORS.blocked));
      const targetIndex = (y * pixelWidth + x) * 4;
      pixels[targetIndex] = color[0];
      pixels[targetIndex + 1] = color[1];
      pixels[targetIndex + 2] = color[2];
      pixels[targetIndex + 3] = color[3];
    }
  }
  return pixels;
}

export function mapRoExplorerMinimapPointToCell(xRatio, yRatio, mapWidth, mapHeight) {
  if (!isPositiveInteger(mapWidth) || !isPositiveInteger(mapHeight)
    || mapWidth * mapHeight > 4000000) {
    throw new RangeError('小地圖座標尺寸無效。');
  }
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)
    || xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) {
    return null;
  }
  return {
    x: Math.min(mapWidth - 1, Math.floor(xRatio * mapWidth)),
    y: Math.min(mapHeight - 1, Math.floor(yRatio * mapHeight)),
  };
}

export function mapRoExplorerCellToMinimap(cell, mapWidth, mapHeight, pixelWidth, pixelHeight) {
  if (!isPositiveInteger(mapWidth) || !isPositiveInteger(mapHeight)
    || !isPositiveInteger(pixelWidth) || !isPositiveInteger(pixelHeight)) {
    throw new RangeError('小地圖座標尺寸無效。');
  }
  if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y)
    || cell.x < 0 || cell.y < 0 || cell.x >= mapWidth || cell.y >= mapHeight) {
    return null;
  }
  return {
    x: (cell.x + 0.5) * pixelWidth / mapWidth,
    y: (cell.y + 0.5) * pixelHeight / mapHeight,
  };
}
