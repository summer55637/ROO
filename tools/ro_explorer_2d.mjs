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
    const modelRotation = Array.isArray(model.rotation) && model.rotation.length >= 3
      ? model.rotation.slice(0, 3).map(value => Number.isFinite(value) ? value : 0) : [0, 0, 0];
    props.push({
      name, modelName, modelScale, modelRotation, position, fallback: true,
      kind: classifyRoExplorer2DProp(name + ' ' + modelName),
    });
  }
  return props;
}


const RO_EXPLORER_2D_PROP_BASES = Object.freeze({
  tree: { width: 30, height: 45, shadow: 0.92 },
  stump: { width: 17, height: 22, shadow: 0.86 },
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

/**
 * Stable per-resource variation for flat 2D proxies.
 * RSW placements of the same RSM resource share one silhouette; numbered RO assets
 * keep deterministic variants, while other names use a stable hash.
 */
export function getRoExplorer2DPropVariant(value) {
  const name = String(value || '').toLowerCase().replace(/\\/g, '/').trim();
  const leaf = (name.split('/').pop() || name).replace(/\.rsm2?\b/g, '');
  const kind = classifyRoExplorer2DProp(value);
  const counts = { tree: 4, rock: 3, plant: 3, grass: 3, flower: 3, fixture: 3, building: 2, bridge: 2, wall: 2, unknown: 3 };
  const count = counts[kind] || 1;
  const numbered = leaf.match(/(\d+)$/);
  if (numbered) return Number(numbered[1]) % count;
  let hash = 2166136261;
  for (let i = 0; i < leaf.length; i++) {
    hash ^= leaf.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

/** Classify from the actual model filename; Korean RO resource paths are common in maps. */
export function classifyRoExplorer2DProp(value) {
  const name = String(value || '').toLowerCase().replace(/\\/g, '/').trim();
  const leaf = (name.split('/').pop() || name).replace(/\.rsm2?\b/g, '');
  // Check model leaves before directory names: "나무잡초꽃" holds trees, bushes and rocks.
  if (/bridge|footbridge|wooden_bridge|나무다리|다리중간/.test(leaf)) return 'bridge';
  if (/wall|fence|barrier|railing|guardrail|palisade|성_성벽|성벽/.test(leaf)) return 'wall';
  if (/house|building|tower|inn|castle|roof|gate|church|mansion|fort|temple|shop|hut|성_앞문|입구초소/.test(leaf)) {
    return 'building';
  }
  if (/lamp|light|sign|pillar|post|statue|torch|lantern|gravestone|monument|cairn|bench|barrel|woodbox|crate|box|bag|chair|stool|프론테라성기둥|성_기둥|성기둥|벤치/.test(leaf)) {
    return 'fixture';
  }
  if (/stump|tree_trunk|cut_tree|나무기둥/.test(leaf)) return 'stump';
  if (/tree|palm|pinetree|fir_tree|coconut|banana_tree|나무\d+/.test(leaf)) return 'tree';
  if (/flower|flowerbed|tulip|lily|rose|petal|꽃/.test(leaf)) return 'flower';
  if (/grass|weed|reed|bamboo|vine|잡초/.test(leaf)) return 'grass';
  if (/mushroom|shroom|fungus/.test(leaf)) return 'mushroom';
  if (/plant|bush|shrub|leaf|leaves|fern|herb|sprout|banana|덤불/.test(leaf)) return 'plant';
  if (/rock|stone|boulder|crystal|ore|cliff|stalagmite|바위|바닥블럭/.test(leaf)) return 'rock';
  if (/water|pond|river|waterfall|fountain|well/.test(leaf)) return 'water';
  // Keep resources without trustworthy visual semantics explicit rather than guessing.
  return 'unknown';
}

const RO_EXPLORER_2D_ROTATABLE_KINDS = new Set([
  'tree', 'building', 'wall', 'bridge', 'plant', 'fixture', 'water',
]);

/**
 * Convert RSW yaw into the proxy's isometric screen-plane angle.
 * RSW's Z axis is mirrored by the native map transform, so its yaw sign flips.
 */
export function getRoExplorer2DPropOrientation(rotation = [0, 0, 0]) {
  const rawYaw = Array.isArray(rotation) ? Number(rotation[1]) : Number(rotation);
  if (!Number.isFinite(rawYaw)) {
    return { yawDegrees: 0, screenAngleRadians: 0, screenAngleDegrees: 0 };
  }
  const normalizedYaw = ((rawYaw % 360) + 360) % 360;
  const yawDegrees = -(normalizedYaw > 180 ? normalizedYaw - 360 : normalizedYaw);
  const theta = yawDegrees * Math.PI / 180;
  const screenBaseline = Math.atan2(0.5, 1);
  let screenAngleRadians = Math.atan2(
    (Math.cos(theta) + Math.sin(theta)) * 0.5,
    Math.cos(theta) - Math.sin(theta)
  ) - screenBaseline;
  // A prop's horizontal axis is undirected; keep the canvas shear within ±90°.
  while (screenAngleRadians > Math.PI / 2) screenAngleRadians -= Math.PI;
  while (screenAngleRadians < -Math.PI / 2) screenAngleRadians += Math.PI;
  return {
    yawDegrees,
    screenAngleRadians,
    screenAngleDegrees: screenAngleRadians * 180 / Math.PI,
  };
}

/** Fit a scene proxy to RSW scale and yaw, clamping malformed/extreme values. */
export function getRoExplorer2DPropStyle(name, modelScale = [1, 1, 1], modelRotation = [0, 0, 0]) {
  const kind = classifyRoExplorer2DProp(name);
  const base = RO_EXPLORER_2D_PROP_BASES[kind] || RO_EXPLORER_2D_PROP_BASES.unknown;
  const readScale = index => {
    const value = Array.isArray(modelScale) ? Number(modelScale[index]) : NaN;
    return Number.isFinite(value) && Math.abs(value) > 1e-5
      ? Math.max(0.5, Math.min(2.25, Math.abs(value))) : 1;
  };
  const horizontalScale = Math.max(0.55, Math.min(1.9, Math.sqrt(readScale(0) * readScale(2))));
  const verticalScale = Math.max(0.55, Math.min(1.9, readScale(1)));
  const orientation = getRoExplorer2DPropOrientation(modelRotation);
  const orientationAware = RO_EXPLORER_2D_ROTATABLE_KINDS.has(kind);
  return {
    kind,
    variant: getRoExplorer2DPropVariant(name),
    width: base.width * horizontalScale,
    height: base.height * verticalScale,
    shadowWidth: base.width * base.shadow * horizontalScale,
    horizontalScale,
    verticalScale,
    orientationAware,
    yawDegrees: orientation.yawDegrees,
    screenAngleRadians: orientationAware ? orientation.screenAngleRadians : 0,
    screenAngleDegrees: orientationAware ? orientation.screenAngleDegrees : 0,
  };
}

/**
 * Painter depth uses the ground plane only. World Y is height/elevation, not camera depth;
 * including it in sort keys can put a raised object in front of or behind the wrong actor.
 */
export function getRoExplorer2DDepthKey(position) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
  return position.x - position.z;
}

/** Sort from far to near; ground-depth ties keep scenery, monster, then player order. */
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

/**
 * Project a loaded static RSM mesh into textured Canvas 2D triangles.
 * The returned triangle coordinates are relative to the projected model anchor.
 * Return null for unsupported/unfinished geometry so the caller can safely use a proxy.
 */
export function collectRoExplorer2DModelTriangles(modelRoot, projectPoint, anchorPoint,
  maxTriangles = 12000) {
  if (!modelRoot || typeof projectPoint !== 'function' || !anchorPoint
    || !finite(anchorPoint.x) || !finite(anchorPoint.y)
    || !Number.isInteger(maxTriangles) || maxTriangles < 1 || maxTriangles > 24000) return null;

  const triangles = [];
  let failed = false;
  let stableOrder = 0;
  const component = (attribute, index, axis) => {
    if (!attribute || !Number.isInteger(index) || index < 0) return NaN;
    const getter = axis === 0 ? 'getX' : axis === 1 ? 'getY' : 'getZ';
    if (typeof attribute[getter] === 'function') return attribute[getter](index);
    const itemSize = Number.isInteger(attribute.itemSize) ? attribute.itemSize : 0;
    const array = attribute.array;
    if (!array || itemSize <= axis) return NaN;
    return array[index * itemSize + axis];
  };
  const indexAt = (indexAttribute, offset) => {
    if (!indexAttribute) return offset;
    if (typeof indexAttribute.getX === 'function') return indexAttribute.getX(offset);
    return indexAttribute.array ? indexAttribute.array[offset] : NaN;
  };
  const attributeCount = attribute => Number.isInteger(attribute && attribute.count)
    ? attribute.count
    : attribute && attribute.array && Number.isInteger(attribute.itemSize) && attribute.itemSize > 0
      ? Math.floor(attribute.array.length / attribute.itemSize) : 0;
  const colorString = color => {
    if (color && typeof color.getHexString === 'function') return '#' + color.getHexString();
    if (color && [color.r, color.g, color.b].every(finite)) {
      const channel = value => Math.max(0, Math.min(255, Math.round(value * 255)));
      return 'rgb(' + channel(color.r) + ',' + channel(color.g) + ',' + channel(color.b) + ')';
    }
    return '#b8b4a0';
  };
  const visit = (node, inheritedVisible = true) => {
    if (failed || !node || inheritedVisible === false || node.visible === false) return;
    const geometry = node.geometry;
    const positionAttribute = geometry && geometry.attributes && geometry.attributes.position;
    if (node.isMesh && geometry && positionAttribute) {
      const positionCount = attributeCount(positionAttribute);
      const uvAttribute = geometry.attributes.uv;
      const indices = geometry.index;
      const elementCount = indices ? attributeCount(indices) : positionCount;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const groups = Array.isArray(geometry.groups) && geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: elementCount, materialIndex: 0 }];
      const matrix = node.matrixWorld && node.matrixWorld.elements;
      if (!matrix || matrix.length !== 16 || !matrix.every(finite)
        || positionCount < 3 || elementCount < 3) {
        failed = true;
        return;
      }
      const drawStart = geometry.drawRange && finite(geometry.drawRange.start)
        ? Math.max(0, geometry.drawRange.start) : 0;
      const drawCount = geometry.drawRange && finite(geometry.drawRange.count)
        ? Math.max(0, geometry.drawRange.count) : elementCount;
      const drawEnd = Math.min(elementCount, drawStart + drawCount);

      for (const group of groups) {
        const start = Math.max(drawStart, Number.isFinite(group.start) ? group.start : 0);
        const groupEnd = Math.min(drawEnd, start + Math.max(0,
          Number.isFinite(group.count) ? group.count : drawEnd - start));
        const materialIndex = Number.isInteger(group.materialIndex) ? group.materialIndex : 0;
        const material = materials[materialIndex];
        if (!material) continue;
        const opacity = finite(material.opacity) ? Math.max(0, Math.min(1, material.opacity)) : 1;
        if (opacity <= 0) continue;
        const image = material.map && material.map.image ? material.map.image : null;
        const imageWidth = image && Number(image.naturalWidth || image.videoWidth || image.width);
        const imageHeight = image && Number(image.naturalHeight || image.videoHeight || image.height);
        if (material.map && (!image || !finite(imageWidth) || !finite(imageHeight)
          || imageWidth <= 0 || imageHeight <= 0 || !uvAttribute)) {
          failed = true;
          return;
        }
        const materialColor = colorString(material.color);

        for (let offset = start; offset + 2 < groupEnd; offset += 3) {
          if (triangles.length >= maxTriangles) {
            failed = true;
            return;
          }
          const vertexIndices = [
            indexAt(indices, offset),
            indexAt(indices, offset + 1),
            indexAt(indices, offset + 2),
          ];
          if (!vertexIndices.every(index => Number.isInteger(index) && index >= 0 && index < positionCount)) {
            failed = true;
            return;
          }
          const worldPoints = [];
          const sourcePoints = [];
          const screenPoints = [];
          for (const vertexIndex of vertexIndices) {
            const x = component(positionAttribute, vertexIndex, 0);
            const y = component(positionAttribute, vertexIndex, 1);
            const z = component(positionAttribute, vertexIndex, 2);
            if (![x, y, z].every(finite)) { failed = true; return; }
            const world = {
              x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
              y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
              z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
            };
            if (!Object.values(world).every(finite)) { failed = true; return; }
            const screen = projectPoint(world);
            if (!screen || !finite(screen.x) || !finite(screen.y)) { failed = true; return; }
            worldPoints.push(world);
            screenPoints.push({ x: screen.x - anchorPoint.x, y: screen.y - anchorPoint.y });
            if (image) {
              const u = component(uvAttribute, vertexIndex, 0);
              const v = component(uvAttribute, vertexIndex, 1);
              if (![u, v].every(finite)) { failed = true; return; }
              sourcePoints.push({ x: u * imageWidth, y: (1 - v) * imageHeight });
            }
          }
          const depth = worldPoints.reduce((sum, point) => sum + point.x - point.z, 0) / 3;
          triangles.push({
            image,
            sourcePoints: image ? sourcePoints : null,
            points: screenPoints,
            depth,
            opacity,
            color: materialColor,
            order: stableOrder++,
          });
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child, inheritedVisible && node.visible !== false);
    }
  };

  if (typeof modelRoot.updateMatrixWorld === 'function') modelRoot.updateMatrixWorld(true);
  visit(modelRoot);
  if (failed || !triangles.length) return null;
  triangles.sort((a, b) => a.depth - b.depth || a.order - b.order);
  return triangles;
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
