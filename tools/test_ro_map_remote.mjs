import assert from 'node:assert/strict';
import {
  RAGASSETS_BASE_URL,
  normalizeModelName,
  normalizeTextureName,
  parseGndBuffer,
  parseRsmBuffer,
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
  const rsw = parseRswBuffer(rswBytes);
  assert.ok(rsw.models.length > 0, mapId + ' RSW has map model instances');
  assert.ok(rsw.light.ambient.every(Number.isFinite), mapId + ' RSW ambient light is finite');
  assert.ok(rsw.light.diffuse.every(Number.isFinite), mapId + ' RSW diffuse light is finite');

  const sampleModels = [...new Set(rsw.models
    .map(model => normalizeModelName(model.modelName))
    .filter(name => urls.models[name]))].slice(0, 8);
  assert.ok(sampleModels.length > 0, mapId + ' RSW model paths resolve to manifest assets');
  const parsedModels = await Promise.all(sampleModels.map(async name => {
    const response = await fetchResponse(urls.models[name], mapId + ' model ' + name);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assert.ok(bytes.length >= 6, mapId + ' model ' + name + ' has a header');
    assert.deepEqual([...bytes.slice(0, 4)], [71, 82, 83, 77], mapId + ' model ' + name + ' GRSM signature');
    const model = parseRsmBuffer(buffer);
    assert.ok(model.nodes.length > 0, mapId + ' model ' + name + ' has nodes');
    return {
      version: model.version,
      nodes: model.nodes.length,
      faces: model.nodes.reduce((sum, node) => sum + node.faces.length, 0),
    };
  }));
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
  assert.equal(gatBytes.byteLength, 14 + gatWidth * gatHeight * 20, mapId + ' GAT byte length');
  assert.equal(gatWidth, gnd.width * 2, mapId + ' GND/GAT width alignment');
  assert.equal(gatHeight, gnd.height * 2, mapId + ' GND/GAT height alignment');
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
      + ', RSW ' + rsw.version + ' with ' + rsw.models.length + ' model placements'
      + ', sample RSM versions ' + versionSummary
      + ', sample model faces ' + parsedModels.reduce((sum, model) => sum + model.faces, 0)
      + ', mapped used ground textures ' + usedTextures.length
      + ', sample PNG OK'
  );
}

for (const mapId of ['prontera', 'tra_fild']) {
  await validateMap(mapId);
}

console.log('公開 RO 地圖素材即時驗證通過（2 maps）');
