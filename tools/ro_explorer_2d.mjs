const finite = value => Number.isFinite(value);

/**
 * RSW placements still have useful map coordinates when their RSM asset cannot load.
 * Return lightweight 2D stand-ins only for placements without a rendered 3D model.
 */
export function buildRoExplorer2DFallbackProps(rswModels, renderedPositions = [], worldScale = 1,
  maxPlacements = 450) {
  if (!Array.isArray(rswModels) || !Array.isArray(renderedPositions)
    || !finite(worldScale) || worldScale <= 0 || worldScale > 10
    || !Number.isInteger(maxPlacements) || maxPlacements < 0) return [];

  const positionKey = position => {
    if (!position || ![position.x, position.y, position.z].every(finite)) return null;
    return [position.x, position.y, position.z].map(value => Math.round(value * 1000)).join(':');
  };
  const renderedKeys = new Set(renderedPositions.map(positionKey).filter(Boolean));
  const props = [];
  for (const model of rswModels.slice(0, Math.min(450, maxPlacements))) {
    if (!model || !Array.isArray(model.position) || model.position.length < 3
      || !model.position.slice(0, 3).every(finite)) continue;
    const position = {
      x: model.position[0] * worldScale,
      y: -model.position[1] * worldScale,
      z: -model.position[2] * worldScale,
    };
    if (renderedKeys.has(positionKey(position))) continue;
    const modelName = String(model.modelName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
    const name = String(model.modelName || model.name || 'RO 場景物件')
      .replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || 'RO 場景物件';
    const modelScale = Array.isArray(model.scale) && model.scale.length >= 3
      ? model.scale.slice(0, 3).map(value => Number.isFinite(value) ? value : 1) : [1, 1, 1];
    props.push({
      name, modelName, modelScale, position, fallback: true,
      kind: classifyRoExplorer2DProp(name + ' ' + modelName),
    });
  }
  return props;
}


const RO_EXPLORER_2D_PROP_BASES = Object.freeze({
  tree: { width: 30, height: 45, shadow: 0.92 },
  building: { width: 34, height: 42, shadow: 1.18 },
  wall: { width: 38, height: 18, shadow: 1.1 },
  bridge: { width: 42, height: 17, shadow: 1.12 },
  plant: { width: 25, height: 20, shadow: 0.92 },
  flower: { width: 22, height: 22, shadow: 0.78 },
  grass: { width: 24, height: 17, shadow: 0.86 },
  mushroom: { width: 18, height: 20, shadow: 0.72 },
  rock: { width: 23, height: 18, shadow: 0.9 },
  fixture: { width: 17, height: 32, shadow: 0.7 },
  water: { width: 31, height: 12, shadow: 0.9 },
  unknown: { width: 21, height: 18, shadow: 0.85 },
});

/** Classify public RSW/RSM object names without assuming their model assets loaded. */
export function classifyRoExplorer2DProp(value) {
  const name = String(value || '').toLowerCase().replace(/\\/g, '/');
  if (/bridge|footbridge|wooden_bridge/.test(name)) return 'bridge';
  if (/tree|palm|pinetree|fir_tree|coconut|banana_tree/.test(name)) return 'tree';
  if (/house|building|tower|inn|castle|roof|gate|church|mansion|fort|temple|shop|hut/.test(name)) {
    return 'building';
  }
  if (/wall|fence|barrier|railing|guardrail|palisade/.test(name)) return 'wall';
  if (/flower|flowerbed|tulip|lily|rose|petal/.test(name)) return 'flower';
  if (/grass|weed|reed|bamboo|vine/.test(name)) return 'grass';
  if (/mushroom|shroom|fungus/.test(name)) return 'mushroom';
  if (/plant|bush|shrub|leaf|leaves|fern|herb|sprout|banana/.test(name)) return 'plant';
  if (/rock|stone|boulder|crystal|ore|cliff|stalagmite/.test(name)) return 'rock';
  if (/water|pond|river|waterfall|fountain|well/.test(name)) return 'water';
  if (/lamp|light|sign|pillar|post|statue|torch|lantern|gravestone|monument|cairn/.test(name)) {
    return 'fixture';
  }
  return 'unknown';
}

/** Fit a scene proxy to RSW per-axis scale, while clamping malformed/extreme values. */
export function getRoExplorer2DPropStyle(name, modelScale = [1, 1, 1]) {
  const kind = classifyRoExplorer2DProp(name);
  const base = RO_EXPLORER_2D_PROP_BASES[kind] || RO_EXPLORER_2D_PROP_BASES.unknown;
  const readScale = index => {
    const value = Array.isArray(modelScale) ? Number(modelScale[index]) : NaN;
    return Number.isFinite(value) && Math.abs(value) > 1e-5
      ? Math.max(0.5, Math.min(2.25, Math.abs(value))) : 1;
  };
  const horizontalScale = Math.max(0.55, Math.min(1.9, Math.sqrt(readScale(0) * readScale(2))));
  const verticalScale = Math.max(0.55, Math.min(1.9, readScale(1)));
  return {
    kind,
    width: base.width * horizontalScale,
    height: base.height * verticalScale,
    shadowWidth: base.width * base.shadow * horizontalScale,
    horizontalScale,
    verticalScale,
  };
}

/** Sort by projected ground-anchor Y; equal-depth scenery stays behind monsters/player. */
export function sortRoExplorer2DSceneItems(items) {
  if (!Array.isArray(items)) return [];
  const layerOrder = { prop: 0, monster: 1, player: 2 };
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const depthA = a.item && Number.isFinite(a.item.depth) ? a.item.depth : Infinity;
      const depthB = b.item && Number.isFinite(b.item.depth) ? b.item.depth : Infinity;
      if (depthA !== depthB) return depthA - depthB;
      const layerA = layerOrder[a.item && a.item.kind] ?? 3;
      const layerB = layerOrder[b.item && b.item.kind] ?? 3;
      return layerA - layerB || a.index - b.index;
    })
    .map(entry => entry.item);
}

function readPoint(point) {
  if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
  return { x: Number(point && point.x), y: Number(point && point.y) };
}

export function projectRoExplorer2DPoint(point, center, width, height, pixelsPerWorldUnit) {
  const p = point || {};
  const c = center || {};
  if (![p.x, p.y, p.z, c.x, c.y, c.z, width, height, pixelsPerWorldUnit].every(finite)
    || width <= 0 || height <= 0 || pixelsPerWorldUnit <= 0) {
    throw new TypeError('2D 等角投影需要有效的世界座標、畫面尺寸與縮放比例。');
  }
  return {
    x: width / 2 + ((p.x + p.z) - (c.x + c.z)) * pixelsPerWorldUnit,
    y: height / 2 + ((p.x - p.z) - (c.x - c.z)) * pixelsPerWorldUnit * 0.5
      - (p.y - c.y) * pixelsPerWorldUnit,
  };
}

export function unprojectRoExplorer2DPoint(screenX, screenY, center, width, height,
  pixelsPerWorldUnit, targetWorldY = center && center.y) {
  const c = center || {};
  if (![screenX, screenY, c.x, c.y, c.z, width, height, pixelsPerWorldUnit, targetWorldY].every(finite)
    || width <= 0 || height <= 0 || pixelsPerWorldUnit <= 0) {
    throw new TypeError('2D 等角反投影需要有效的畫面座標、中心與地面高度。');
  }
  const sum = (screenX - width / 2) / pixelsPerWorldUnit;
  const difference = 2 * ((screenY - height / 2) / pixelsPerWorldUnit + targetWorldY - c.y);
  const dx = (sum + difference) / 2;
  const dz = (sum - difference) / 2;
  return { x: c.x + dx, y: targetWorldY, z: c.z + dz };
}

export function createRoExplorer2DAffineTransform(sourcePoints, targetPoints) {
  if (!Array.isArray(sourcePoints) || !Array.isArray(targetPoints)
    || sourcePoints.length !== 3 || targetPoints.length !== 3) return null;
  const [p1, p2, p3] = sourcePoints.map(readPoint);
  const [q1, q2, q3] = targetPoints.map(readPoint);
  if (![p1, p2, p3, q1, q2, q3].every(p => finite(p.x) && finite(p.y))) return null;
  const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
  const dx2 = p3.x - p1.x, dy2 = p3.y - p1.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-9) return null;
  const qx1 = q2.x - q1.x, qy1 = q2.y - q1.y;
  const qx2 = q3.x - q1.x, qy2 = q3.y - q1.y;
  const a = (qx1 * dy2 - qx2 * dy1) / determinant;
  const c = (dx1 * qx2 - dx2 * qx1) / determinant;
  const b = (qy1 * dy2 - qy2 * dy1) / determinant;
  const d = (dx1 * qy2 - dx2 * qy1) / determinant;
  const e = q1.x - a * p1.x - c * p1.y;
  const f = q1.y - b * p1.x - d * p1.y;
  const matrix = [a, b, c, d, e, f];
  return matrix.every(finite) ? matrix : null;
}

export function transformRoExplorer2DPoint(matrix, point) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(finite)) return null;
  const p = readPoint(point);
  if (!finite(p.x) || !finite(p.y)) return null;
  return {
    x: matrix[0] * p.x + matrix[2] * p.y + matrix[4],
    y: matrix[1] * p.x + matrix[3] * p.y + matrix[5],
  };
}

export function drawRoExplorer2DTexturedTriangle(context, image, sourcePoints, targetPoints) {
  if (!context || !image || !image.width || !image.height
    || !Array.isArray(targetPoints) || targetPoints.length !== 3) return false;
  const matrix = createRoExplorer2DAffineTransform(sourcePoints, targetPoints);
  if (!matrix) return false;
  const [p1, p2, p3] = targetPoints.map(readPoint);
  if (![p1, p2, p3].every(p => finite(p.x) && finite(p.y))) return false;
  context.save();
  try {
    context.beginPath();
    context.moveTo(p1.x, p1.y);
    context.lineTo(p2.x, p2.y);
    context.lineTo(p3.x, p3.y);
    context.closePath();
    context.clip();
    context.transform(...matrix);
    context.drawImage(image, 0, 0);
  } finally {
    context.restore();
  }
  return true;
}

export function getRoExplorer2DViewportRadius(width, height) {
  const w = Number(width), h = Number(height);
  if (!finite(w) || !finite(h) || w <= 0 || h <= 0) {
    throw new TypeError('2D 視窗尺寸必須是正數。');
  }
  return {
    x: Math.max(4, Math.ceil(w / 32) + 4),
    z: Math.max(4, Math.ceil(h / 16) + 4),
  };
}

export function isRoExplorer2DPointVisible(point, width, height, padding = 64) {
  const p = readPoint(point);
  return finite(p.x) && finite(p.y) && finite(width) && finite(height) && finite(padding)
    && p.x >= -padding && p.y >= -padding
    && p.x <= width + padding && p.y <= height + padding;
}


/** Draw a compact contact shadow so textured RO sprites sit on the ground plane. */
export function drawRoExplorer2DGroundShadow(context, x, y, width) {
  if (!context || ![x, y, width].every(finite) || width <= 0
    || typeof context.save !== 'function' || typeof context.restore !== 'function'
    || typeof context.beginPath !== 'function' || typeof context.ellipse !== 'function'
    || typeof context.fill !== 'function') return false;

  const radiusX = Math.max(4, width * 0.38);
  const radiusY = Math.max(2, Math.min(7, width * 0.12));
  context.save();
  try {
    context.globalAlpha = 1;
    context.fillStyle = 'rgba(4, 9, 7, 0.28)';
    context.beginPath();
    context.ellipse(x, y - 1, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = 'rgba(0, 0, 0, 0.12)';
    context.beginPath();
    context.ellipse(x, y - 1, radiusX * 0.66, radiusY * 0.55, 0, 0, Math.PI * 2);
    context.fill();
  } finally {
    context.restore();
  }
  return true;
}

/** Keep the selected-target marker legible over both light and dark terrain. */
export function drawRoExplorer2DSelectionRing(context, x, y, width) {
  if (!context || ![x, y, width].every(finite) || width <= 0
    || typeof context.save !== 'function' || typeof context.restore !== 'function'
    || typeof context.beginPath !== 'function' || typeof context.ellipse !== 'function'
    || typeof context.stroke !== 'function') return false;

  const radiusX = Math.max(8, width * 0.56);
  const radiusY = Math.max(4, Math.min(8, width * 0.16));
  context.save();
  try {
    context.globalAlpha = 1;
    context.strokeStyle = 'rgba(5, 11, 8, 0.88)';
    context.lineWidth = Math.max(3, width * 0.08);
    context.beginPath();
    context.ellipse(x, y + 1, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = 'rgba(255, 225, 138, 0.98)';
    context.lineWidth = Math.max(1.25, width * 0.045);
    context.beginPath();
    context.ellipse(x, y + 1, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.stroke();
  } finally {
    context.restore();
  }
  return true;
}
