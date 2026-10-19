import assert from 'node:assert/strict';
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
} from './ro_map_assets.mjs';

async function fetchResponse(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(label + ' HTTP ' + response.status + ': ' + url);
  return response;
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
  assert.ok(['standard-split', 'legacy-rgba'].includes(gnd.lightmapLayout), mapId + ' recognized GND lightmap layout');
  assert.equal(gnd.lightmapSlices.length, gnd.lightmapCount, mapId + ' lightmap slice count');
  const lightmapAtlas = buildGndLightmapAtlasData(gnd);
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
    console.log(
      mapId + ': ' + gnd.water.planes.length + ' declared GND water planes, '
        + waterMeshes.planes.length + ' with GAT water tiles, ' + waterMeshes.waterTileCount + ' tiles; '
        + 'GND water types ' + JSON.stringify(waterTypeCounts) + '; manifest type ' + urls.waterType
        + ' (' + urls.waterFrames.length + ' frames), type-specific matched planes '
        + typedPlaneCount + '/' + gnd.water.planes.length
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

  const sampleTextureUrl = urls.textures[usedTextures[0]];
  const textureResponse = await fetchResponse(sampleTextureUrl, mapId + ' sample texture');
  const pngBytes = new Uint8Array(await textureResponse.arrayBuffer());
  assert.ok(pngBytes.length > 8, mapId + ' sample texture has a PNG payload');
  assert.deepEqual([...pngBytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10],
    mapId + ' sample texture PNG signature');

  console.log(
    mapId + ': GND ' + gnd.version + ' ' + gnd.width + '×' + gnd.height
      + ', GAT ' + gatWidth + '×' + gatHeight
      + ', surfaces ' + gnd.surfaces.length
      + ', lightmaps ' + gnd.lightmapCount + ' (' + gnd.lightmapLayout + ')'
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
