import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import {
  RAGASSETS_BASE_URL,
  analyzeRswPlacementBounds,
  buildGndLightmapAtlasData,
  buildGndWaterMeshDataByPlane,
  buildRsmNodeTransformData,
  buildRsm2NodeTransformData,
  buildRsmNodeMeshData,
  buildRsm2NodeMeshData,
  compareGndGatHeights,
  normalizeModelName,
  normalizeTextureName,
  parseGndBuffer,
  parseRsmBuffer,
  transformRsmVertex,
  transformRsm2Vertex,
  parseRswBuffer,
  resolveRagassetsMapUrls,
  resolveWaterFramesForType,
} from './ro_map_assets.mjs';

async function fetchResponse(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(label + ' HTTP ' + response.status + ': ' + url);
  return response;
}


 // Decode public 8-bit PNG diffuse textures for real source-pixel sampling.
function decodePngPixels(input) {
  const png = Buffer.from(input);
  if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Diffuse texture is not a valid PNG.');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const imageData = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const size = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + size;
    if (end + 4 > png.length) throw new Error('Diffuse PNG chunk is truncated: ' + type);
    const chunk = png.subarray(start, end);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(chunk);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(chunk);
    } else if (type === 'IDAT') {
      imageData.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }
  const sourceChannels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !sourceChannels
    || (colorType === 3 && (!palette || palette.length % 3 !== 0))) {
    throw new Error('Unsupported diffuse PNG format: ' + width + '×' + height
      + ', bit depth ' + bitDepth + ', color type ' + colorType + ', interlace ' + interlace);
  }
  const stride = width * sourceChannels;
  const inflated = inflateSync(Buffer.concat(imageData));
  if (inflated.length !== height * (stride + 1)) {
    throw new Error('Diffuse PNG scanline data length is invalid.');
  }
  const pixels = Buffer.alloc(height * stride);
  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }
  for (let y = 0; y < height; y++) {
    const sourceRow = y * (stride + 1);
    const destinationRow = y * stride;
    const filter = inflated[sourceRow];
    for (let i = 0; i < stride; i++) {
      const raw = inflated[sourceRow + 1 + i];
      const left = i >= sourceChannels ? pixels[destinationRow + i - sourceChannels] : 0;
      const up = y > 0 ? pixels[destinationRow - stride + i] : 0;
      const upperLeft = y > 0 && i >= sourceChannels
        ? pixels[destinationRow - stride + i - sourceChannels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      else if (filter !== 0) throw new Error('Unsupported diffuse PNG filter: ' + filter);
      pixels[destinationRow + i] = (raw + predictor) & 255;
    }
  }
  return {
    width,
    height,
    pixelAt(x, y) {
      const ix = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const iy = Math.max(0, Math.min(height - 1, Math.floor(y)));
      const at = (iy * width + ix) * sourceChannels;
      if (colorType === 6) return [...pixels.subarray(at, at + 4)];
      if (colorType === 2) return [...pixels.subarray(at, at + 3), 255];
      if (colorType === 0) return [pixels[at], pixels[at], pixels[at], 255];
      if (colorType === 4) return [pixels[at], pixels[at], pixels[at], pixels[at + 1]];
      const colorIndex = pixels[at];
      const paletteAt = colorIndex * 3;
      return [
        palette[paletteAt], palette[paletteAt + 1], palette[paletteAt + 2],
        transparency && colorIndex < transparency.length ? transparency[colorIndex] : 255,
      ];
    },
  };
}

function wrapUv(value) {
  return value - Math.floor(value);
}

async function validateMap(mapId) {
  const manifestUrl = RAGASSETS_BASE_URL + '/maps/' + mapId + '/manifest.json';
  const manifestResponse = await fetchResponse(manifestUrl, mapId + ' manifest');
  const manifest = await manifestResponse.json();
  const urls = resolveRagassetsMapUrls(mapId, manifest);

  const [gndResponse, gatResponse, rswResponse] = await Promise.all([
    fetchResponse(urls.gnd, mapId + ' GND'),
    fetchResponse(urls.gat, mapId + ' GAT'),
    fetchResponse(urls.rsw, mapId + ' RSW'),
  ]);
  const [gndBytes, gatBytes, rswBytes] = await Promise.all([
    gndResponse.arrayBuffer(),
    gatResponse.arrayBuffer(),
    rswResponse.arrayBuffer(),
  ]);

  const gnd = parseGndBuffer(gndBytes);
  assert.ok(['standard-split', 'legacy-split'].includes(gnd.lightmapLayout),
    mapId + ' recognized GND lightmap layout');
  assert.equal(gnd.lightmapSlices.length, gnd.lightmapCount, mapId + ' lightmap slice count');
  assert.ok(gnd.lightmapSlices.every(slice => slice.width === 8 && slice.height === 8),
    mapId + ' real RO lightmap slices are 8×8');
  assert.ok(gnd.lightmapSlices.every(slice => slice.channels === 3
    && slice.shadowPixels && slice.shadowPixels.length === 64
    && slice.colorPixels.length === 8 * 8 * 3),
  mapId + (gnd.lightmapLayout === 'standard-split'
    ? ' standard layout stores separate RGB lightmap and grayscale AO'
    : ' global-dimension layout stores 64 AO bytes followed by 192 RGB lightmap bytes'));
  const lightmapAtlas = buildGndLightmapAtlasData(gnd);
  assert.equal(lightmapAtlas.sourceGutter, 1,
    mapId + ' atlas excludes the source lightmap/AO border ring');
  assert.ok(lightmapAtlas, mapId + ' lightmap atlas was built');
  assert.equal(lightmapAtlas.uvsBySlice.length, gnd.lightmapCount, mapId + ' lightmap atlas UV count');
  assert.ok(lightmapAtlas.width <= 4096 && lightmapAtlas.height <= 4096, mapId + ' atlas fits common GPU limits');
  const rsw = parseRswBuffer(rswBytes);
  assert.ok(rsw.models.length > 0, mapId + ' RSW has map model instances');
  assert.ok(rsw.light.ambient.every(Number.isFinite), mapId + ' RSW ambient light is finite');
  assert.ok(rsw.light.diffuse.every(Number.isFinite), mapId + ' RSW diffuse light is finite');

  const candidates = [...new Set(rsw.models
    .map(model => normalizeModelName(model.modelName))
    .filter(name => urls.models[name]))];
  const stride = Math.max(1, Math.floor(candidates.length / 12));
  const sampleModels = candidates.filter((name, index) => index % stride === 0).slice(0, 12);
  assert.ok(sampleModels.length > 0, mapId + ' RSW model paths resolve to manifest assets');
  const parsedModels = await Promise.all(sampleModels.map(async name => {
    const response = await fetchResponse(urls.models[name], mapId + ' model ' + name);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assert.ok(bytes.length >= 6, mapId + ' model ' + name + ' has a header');
    assert.deepEqual([...bytes.slice(0, 4)], [71, 82, 83, 77], mapId + ' model ' + name + ' GRSM signature');
    const model = parseRsmBuffer(buffer);
    assert.ok(model.nodes.length > 0, mapId + ' model ' + name + ' has nodes');
    let transformedNodes = 0;
    let transformedVertices = 0;
    let transformedMeshBuckets = 0;
    let transformedMeshVertices = 0;
    if (model.major === 1 || model.major === 2) {
      const nodesByName = new Map();
      for (const node of model.nodes) {
        if (!nodesByName.has(node.name)) nodesByName.set(node.name, []);
        nodesByName.get(node.name).push(node);
      }
      for (const node of model.nodes) {
        const parentCandidates = nodesByName.get(node.parentName) || [];
        const parentNode = parentCandidates.find(candidate => candidate !== node) || null;
        const transform = model.major === 2
          ? buildRsm2NodeTransformData(node, parentNode, 0.2)
          : buildRsmNodeTransformData(node, 0.2);
        assert.ok(
          [...transform.position, ...transform.rotation, ...transform.scale].every(Number.isFinite),
          mapId + ' model ' + name + ' node ' + node.name + ' has finite transforms'
        );
        transformedNodes++;
        const meshData = model.major === 2
          ? buildRsm2NodeMeshData(node, model.shadeType, 0.2)
          : buildRsmNodeMeshData(node, model.shadeType, 0.2);
        for (const bucket of meshData.buckets) {
          assert.equal(bucket.positions.length, bucket.normals.length,
            mapId + ' model ' + name + ' node ' + node.name + ' position/normal lengths');
          assert.ok(bucket.normals.every(Number.isFinite),
            mapId + ' model ' + name + ' node ' + node.name + ' has finite normals');
          assert.ok(bucket.indices.every(index => index >= 0 && index < bucket.positions.length / 3),
            mapId + ' model ' + name + ' node ' + node.name + ' has valid mesh indices');
          transformedMeshBuckets++;
          transformedMeshVertices += bucket.positions.length / 3;
        }
        for (const vertex of node.vertices) {
          const point = model.major === 2
            ? transformRsm2Vertex(node, vertex, 0.2)
            : transformRsmVertex(node, vertex, 0.2);
          assert.ok(
            point.every(Number.isFinite),
            mapId + ' model ' + name + ' node ' + node.name + ' has finite transformed vertices'
          );
          transformedVertices++;
        }
      }
    }
    return {
      version: model.version,
      nodes: model.nodes.length,
      faces: model.nodes.reduce((sum, node) => sum + node.faces.length, 0),
      transformedNodes,
      transformedVertices,
      transformedMeshBuckets,
      transformedMeshVertices,
    };
  }));
  const transformedNodeCount = parsedModels.reduce((sum, model) => sum + model.transformedNodes, 0);
  const transformedVertexCount = parsedModels.reduce((sum, model) => sum + model.transformedVertices, 0);
  const transformedMeshBucketCount = parsedModels.reduce((sum, model) => sum + model.transformedMeshBuckets, 0);
  const transformedMeshVertexCount = parsedModels.reduce((sum, model) => sum + model.transformedMeshVertices, 0);
  if (parsedModels.some(model => model.version.startsWith('1.'))) {
    assert.ok(transformedNodeCount > 0, mapId + ' real RSM1 nodes have transform checks');
    assert.ok(transformedVertexCount > 0, mapId + ' real RSM1 vertices have transform checks');
    assert.ok(transformedMeshBucketCount > 0, mapId + ' real RSM1 mesh buffers are built');
    assert.ok(transformedMeshVertexCount > 0, mapId + ' real RSM1 mesh vertices are built');
  }
  const versionCounts = {};
  for (const model of parsedModels) versionCounts[model.version] = (versionCounts[model.version] || 0) + 1;
  const versionSummary = Object.entries(versionCounts).map(([version, count]) => version + '×' + count).join(', ');
  const gatView = new DataView(gatBytes);
  assert.equal(String.fromCharCode(
    gatView.getUint8(0), gatView.getUint8(1), gatView.getUint8(2), gatView.getUint8(3)
  ), 'GRAT', mapId + ' GAT header');
  assert.equal(gatView.getUint8(4), 1, mapId + ' GAT major version');
  assert.ok([2, 3].includes(gatView.getUint8(5)), mapId + ' GAT minor version');
  const gatWidth = gatView.getUint32(6, true);
  const gatHeight = gatView.getUint32(10, true);
  const gatMinor = gatView.getUint8(5);
  assert.equal(gatBytes.byteLength, 14 + gatWidth * gatHeight * 20, mapId + ' GAT byte length');
  assert.equal(gatWidth, gnd.width * 2, mapId + ' GND/GAT width alignment');
  assert.equal(gatHeight, gnd.height * 2, mapId + ' GND/GAT height alignment');
  const gatHeights = new Float32Array(gatWidth * gatHeight);
  const gatTerrainTypes = new Uint16Array(gatWidth * gatHeight);
  const gatWater = new Uint8Array(gatWidth * gatHeight);
  for (let index = 0; index < gatHeights.length; index++) {
    const at = 14 + index * 20;
    gatHeights[index] = (
      gatView.getFloat32(at, true)
      + gatView.getFloat32(at + 4, true)
      + gatView.getFloat32(at + 8, true)
      + gatView.getFloat32(at + 12, true)
    ) / 4;
    gatTerrainTypes[index] = gatView.getUint16(at + 16, true);
    gatWater[index] = gatMinor === 3 && (gatView.getUint16(at + 18, true) & 0x8000) !== 0 ? 1 : 0;
  }
  const waterMeshes = buildGndWaterMeshDataByPlane({
    version: '1.' + gatMinor,
    width: gatWidth,
    height: gatHeight,
    terrainTypes: gatTerrainTypes,
    water: gatWater,
  }, gnd.water || rsw.water, 0.2);
  assert.equal(
    waterMeshes.planes.reduce((sum, plane) => sum + plane.data.waterTileCount, 0),
    waterMeshes.waterTileCount,
    mapId + ' water plane tile counts add up'
  );
  if (mapId === 'icecastle') {
    assert.equal(gnd.version, '1.9', 'icecastle is expected to exercise GND 1.9 water planes');
    assert.ok(gnd.water && gnd.water.planes.length > 1, 'icecastle has multiple declared water planes');
    assert.ok(waterMeshes.waterTileCount > 0, 'icecastle exposes real GAT water tiles');
    const waterTypeCounts = {};
    for (const plane of gnd.water.planes) {
      const key = String(plane.type);
      waterTypeCounts[key] = (waterTypeCounts[key] || 0) + 1;
    }
    const framesByType = urls.waterFramesByType || {};
    const typedFrameCount = type => (framesByType[String(type)] || []).length;
    const typedPlaneCount = Object.keys(waterTypeCounts)
      .filter(type => typedFrameCount(type) > 0)
      .reduce((sum, type) => sum + waterTypeCounts[type], 0);
    const frameSelections = waterMeshes.planes.map(plane => ({
      type: plane.config.type,
      selection: resolveWaterFramesForType(urls, plane.config.type),
    }));
    const frameBackedPlaneCount = frameSelections.filter(item => item.selection.frames.length > 0).length;
    const exactTypePlaneCount = frameSelections.filter(item => item.selection.exactTypeMatch).length;
    const fallbackPlaneCount = frameSelections.filter(item => item.selection.usedFallback).length;
    const type10Selections = frameSelections.filter(item => Number(item.type) === 10);
    assert.equal(frameBackedPlaneCount, waterMeshes.planes.length,
      'every active icecastle water plane can display an animation frame set');
    assert.equal(exactTypePlaneCount, waterMeshes.planes.length,
      'every active icecastle water plane has an exact-type animation frame set');
    assert.equal(type10Selections.length, waterMeshes.planes.length,
      'every active icecastle plane uses the GND-declared type 10');
    assert.ok(type10Selections.every(item => item.selection.frames.length === 32),
      'every active type-10 plane has the complete 32-frame sequence');
    assert.equal(fallbackPlaneCount, 0, 'bundled type-10 textures avoid the legacy water-type fallback');
    console.log(
      mapId + ': ' + gnd.water.planes.length + ' declared GND water planes, '
        + waterMeshes.planes.length + ' with GAT water tiles, ' + waterMeshes.waterTileCount + ' tiles; '
        + 'GND water types ' + JSON.stringify(waterTypeCounts) + '; manifest type ' + urls.waterType
        + ' (' + urls.waterFrames.length + ' legacy frames), exact-type active planes '
        + exactTypePlaneCount + '/' + waterMeshes.planes.length + '; 32-frame type-10 sequence '
        + type10Selections.length + '/' + waterMeshes.planes.length + ', fallback ' + fallbackPlaneCount
    );
  }
  const heightAlignment = compareGndGatHeights(gnd, {
    width: gatWidth, height: gatHeight, heights: gatHeights,
  }, 0.2);
  assert.ok(heightAlignment.samples > 0, mapId + ' GND/GAT has comparable height samples');
  const placementBounds = analyzeRswPlacementBounds(gnd, rsw, 0.2);
  assert.equal(placementBounds.total, rsw.models.length, mapId + ' RSW placement audit count');
  assert.equal(placementBounds.invalidPositions, 0, mapId + ' RSW placement coordinates are finite');
  assert.ok(gnd.cubes.some(cube => cube.topSurface >= 0), mapId + ' has terrain tops');
  assert.ok(gnd.surfaces.length > 0, mapId + ' has surfaces');

  const usedTextureIndexes = new Set();
  for (const cube of gnd.cubes) {
    if (cube.topSurface < 0) continue;
    const surface = gnd.surfaces[cube.topSurface];
    if (surface && surface.textureIndex >= 0) usedTextureIndexes.add(surface.textureIndex);
  }
  const usedTextures = [...usedTextureIndexes]
    .map(index => normalizeTextureName(gnd.textures[index]))
    .filter(name => name && urls.textures[name]);
  assert.ok(usedTextures.length > 0, mapId + ' at least one used ground texture resolves');

  const referencedSurfaceIndexes = new Set();
  for (const cube of gnd.cubes) {
    for (const index of [cube.topSurface, cube.northSurface, cube.eastSurface]) {
      if (index >= 0 && index < gnd.surfaces.length) referencedSurfaceIndexes.add(index);
    }
  }
  const sampleSurfaceIndex = [...referencedSurfaceIndexes].find(index => {
    const surface = gnd.surfaces[index];
    const name = normalizeTextureName(gnd.textures[surface.textureIndex]);
    return name && urls.textures[name] && surface.lightmapIndex >= 0
      && surface.lightmapIndex < gnd.lightmapCount;
  });
  assert.ok(Number.isInteger(sampleSurfaceIndex), mapId + ' has a referenced surface with diffuse and lightmap');
  const sampleSurface = gnd.surfaces[sampleSurfaceIndex];
  const sampleTextureName = normalizeTextureName(gnd.textures[sampleSurface.textureIndex]);
  const sampleTextureUrl = urls.textures[sampleTextureName];
  assert.ok(sampleTextureUrl, mapId + ' sample surface diffuse texture resolves');
  const textureResponse = await fetchResponse(sampleTextureUrl, mapId + ' sample texture');
  const pngBytes = new Uint8Array(await textureResponse.arrayBuffer());
  assert.ok(pngBytes.length > 8, mapId + ' sample texture has a PNG payload');
  assert.deepEqual([...pngBytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10],
    mapId + ' sample texture PNG signature');

  const diffuse = decodePngPixels(pngBytes);
  const diffuseUv = [
    sampleSurface.uv.reduce((sum, uv) => sum + uv[0], 0) / sampleSurface.uv.length,
    sampleSurface.uv.reduce((sum, uv) => sum + uv[1], 0) / sampleSurface.uv.length,
  ];
  const diffuseX = Math.min(diffuse.width - 1, Math.floor(wrapUv(diffuseUv[0]) * diffuse.width));
  // TextureLoader flips source images into Three.js UV space; V=0 is the PNG bottom row.
  const diffuseY = diffuse.height - 1
    - Math.min(diffuse.height - 1, Math.floor(wrapUv(diffuseUv[1]) * diffuse.height));
  const diffuseRgba = diffuse.pixelAt(diffuseX, diffuseY);

  const sampleSlice = gnd.lightmapSlices[sampleSurface.lightmapIndex];
  const sampleX = Math.min(3, sampleSlice.width - 2);
  const sampleY = Math.min(3, sampleSlice.height - 2);
  const samplePixelIndex = sampleY * sampleSlice.width + sampleX;
  const aoValue = sampleSlice.shadowPixels[samplePixelIndex];
  const rawLightRgb = [...sampleSlice.colorPixels.slice(samplePixelIndex * 3, samplePixelIndex * 3 + 3)];
  const posterizedLightRgb = rawLightRgb.map(value => Math.floor(value / 16) * 16);
  const atlasColumn = sampleSurface.lightmapIndex % lightmapAtlas.columns;
  const atlasRow = Math.floor(sampleSurface.lightmapIndex / lightmapAtlas.columns);
  const atlasX = atlasColumn * (lightmapAtlas.sliceWidth + 8) + 4 + sampleX;
  const atlasY = atlasRow * (lightmapAtlas.sliceHeight + 8) + 4 + sampleY;
  const atlasOffset = (atlasY * lightmapAtlas.width + atlasX) * 4;
  assert.deepEqual(
    [...lightmapAtlas.lightMapPixels.slice(atlasOffset, atlasOffset + 3)],
    posterizedLightRgb,
    mapId + ' real RGB lightmap sample follows the documented RO 16-level posterization'
  );
  assert.deepEqual(
    [...lightmapAtlas.aoMapPixels.slice(atlasOffset, atlasOffset + 3)],
    [aoValue, aoValue, aoValue],
    mapId + ' real AO sample is copied as independent grayscale data'
  );
  const sampleLightmapUvs = lightmapAtlas.uvsBySlice[sampleSurface.lightmapIndex];
  const expectedUvSpan = (sampleSlice.width - 2) / lightmapAtlas.width;
  assert.ok(Math.abs(sampleLightmapUvs[1][0] - sampleLightmapUvs[0][0] - expectedUvSpan) < 1e-12,
    mapId + ' real lightmap UV spans six visible texels between inner borders');

  console.log(
    mapId + ' GND pixel trace: diffuse=' + gnd.textures[sampleSurface.textureIndex]
      + ' PNG ' + diffuse.width + '×' + diffuse.height
      + ' UV center ' + JSON.stringify(diffuseUv)
      + ' source RGBA ' + JSON.stringify(diffuseRgba)
      + '; surface #' + sampleSurfaceIndex + ' lightmap slice ' + sampleSurface.lightmapIndex
      + ' sample texel (' + sampleX + ',' + sampleY + ') AO=' + aoValue
      + ' RGB raw=' + JSON.stringify(rawLightRgb)
      + ' RGB RO-level16=' + JSON.stringify(posterizedLightRgb)
      + ' atlas UV=' + JSON.stringify(sampleLightmapUvs)
      + ' (official shader: diffuse×vertexColor×AO + RGB lightmap)'
  );

  console.log(
    mapId + ': GND ' + gnd.version + ' ' + gnd.width + '×' + gnd.height
      + ', GAT ' + gatWidth + '×' + gatHeight
      + ', surfaces ' + gnd.surfaces.length
      + ', lightmaps ' + gnd.lightmapCount + ' (' + gnd.lightmapLayout
      + ', ' + lightmapAtlas.sliceWidth + '×' + lightmapAtlas.sliceHeight + ' per slice, '
      + 'RGB + separate AO'
      + ', excluded inner border ' + lightmapAtlas.sourceGutter + 'px)'
      + ', atlas ' + lightmapAtlas.width + '×' + lightmapAtlas.height
      + ', RSW ' + rsw.version + ' with ' + rsw.models.length + ' model placements'
      + ', sample RSM versions ' + versionSummary
      + ', sample model faces ' + parsedModels.reduce((sum, model) => sum + model.faces, 0)
      + ', RSM1 transform checks ' + transformedNodeCount + ' nodes/' + transformedVertexCount + ' vertices'
      + ', RSM1 mesh shading checks ' + transformedMeshBucketCount + ' buckets/' + transformedMeshVertexCount + ' vertices'
      + ', height Δ mean/P95/max ' + heightAlignment.meanAbsoluteError.toFixed(3) + '/'
      + heightAlignment.p95AbsoluteError.toFixed(3) + '/' + heightAlignment.maxAbsoluteError.toFixed(3)
      + ' world units (' + heightAlignment.samples + ' samples)'
      + ', RSW placements in map bounds ' + placementBounds.withinBounds + '/' + placementBounds.total
      + ' (within one-tile margin ' + placementBounds.withinOneTileMargin
      + ', max outside ' + placementBounds.maximumOutsideDistance.toFixed(2) + ')'
      + ', mapped used ground textures ' + usedTextures.length
      + ', sample PNG OK'
  );
}

for (const mapId of ['prontera', 'tra_fild', 'icecastle']) {
  await validateMap(mapId);
}

console.log('公開 RO 地圖素材即時驗證通過（3 maps）');
