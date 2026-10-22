import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  RAGASSETS_BASE_URL,
  analyzeRswPlacementBounds,
  buildGndLightmapAtlasData,
  buildGndMeshData,
  computeGndLightDirection,
  computeGndLightMultiplier,
  transformGndNormalToRoSpace,
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
  mapGndDiffuseUvToSourcePixel,
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

function auditGndVertexColors(meshData) {
  const allColors = [];
  const byPosition = new Map();
  let quadCount = 0;

  for (const bucket of meshData.buckets) {
    const quadTotal = Array.isArray(bucket.surfaceIndices) ? bucket.surfaceIndices.length : 0;
    for (let quad = 0; quad < quadTotal; quad++) {
      const surfaceIndex = bucket.surfaceIndices[quad];
      const firstVertex = quad * 4;
      quadCount++;
      for (let corner = 0; corner < 4; corner++) {
        const vertex = firstVertex + corner;
        const positionAt = vertex * 3;
        const position = bucket.positions.slice(positionAt, positionAt + 3);
        const color = bucket.colors.slice(positionAt, positionAt + 3);
        if (position.length !== 3 || color.length !== 3
          || !position.every(Number.isFinite) || !color.every(Number.isFinite)) continue;

        const sample = { position, color, surfaceIndex };
        allColors.push(sample);
        // Compare equal-height vertices at the same X/Z location; different decks
        // and bridge levels are deliberately kept separate.
        const positionKey = position.map(value => Math.round(value * 1000)).join(':');
        if (!byPosition.has(positionKey)) byPosition.set(positionKey, []);
        byPosition.get(positionKey).push(sample);
      }
    }
  }

  let nonWhiteCorners = 0;
  const colorKeys = new Set();
  const sums = [0, 0, 0];
  const minima = [1, 1, 1];
  const maxima = [0, 0, 0];
  for (const sample of allColors) {
    const [r, g, b] = sample.color;
    if (Math.max(Math.abs(1 - r), Math.abs(1 - g), Math.abs(1 - b)) > 1e-8) {
      nonWhiteCorners++;
    }
    colorKeys.add(sample.color.map(value => Math.round(value * 255)).join(','));
    for (let channel = 0; channel < 3; channel++) {
      sums[channel] += sample.color[channel];
      minima[channel] = Math.min(minima[channel], sample.color[channel]);
      maxima[channel] = Math.max(maxima[channel], sample.color[channel]);
    }
  }

  let sharedCornerGroups = 0;
  let sharedCornerComparisons = 0;
  let mismatchPairs = 0;
  let maximumMismatch = 0;
  let worstExample = null;
  const mismatchThreshold = 1e-8;
  for (const samples of byPosition.values()) {
    if (samples.length < 2) continue;
    sharedCornerGroups++;
    for (let a = 0; a < samples.length; a++) {
      for (let b = a + 1; b < samples.length; b++) {
        sharedCornerComparisons++;
        const difference = Math.max(...samples[a].color.map(
          (value, channel) => Math.abs(value - samples[b].color[channel])
        ));
        if (difference > mismatchThreshold) {
          mismatchPairs++;
          if (difference > maximumMismatch) {
            maximumMismatch = difference;
            worstExample = {
              position: samples[a].position.map(value => Number(value.toFixed(3))),
              firstSurface: samples[a].surfaceIndex,
              firstRgb: samples[a].color.map(value => Math.round(value * 255)),
              secondSurface: samples[b].surfaceIndex,
              secondRgb: samples[b].color.map(value => Math.round(value * 255)),
            };
          }
        }
      }
    }
  }

  const toBytes = values => values.map(value => Math.round(value * 255));
  return {
    quadCount,
    cornerSamples: allColors.length,
    nonWhiteCorners,
    nonWhitePercent: allColors.length ? nonWhiteCorners * 100 / allColors.length : 0,
    uniqueColors: colorKeys.size,
    meanRgb: allColors.length ? toBytes(sums.map(value => value / allColors.length)) : [0, 0, 0],
    minRgb: toBytes(minima),
    maxRgb: toBytes(maxima),
    sharedCornerGroups,
    sharedCornerComparisons,
    mismatchPairs,
    mismatchPercent: sharedCornerComparisons ? mismatchPairs * 100 / sharedCornerComparisons : 0,
    maximumMismatchBytes: Math.round(maximumMismatch * 255),
    worstExample,
  };
}

function auditGndLightmapPipeline(gnd, atlas, meshData, posterizationLevel = 16) {
  const columns = atlas.columns;
  const cellWidth = atlas.cellWidth;
  const cellHeight = atlas.cellHeight;
  const gutter = atlas.gutter;
  let rawRgbBytes = 0;
  let nonZeroRgbBytes = 0;
  let rawRgbPixels = 0;
  let nonZeroRgbPixels = 0;
  let rawMinimum = 255;
  let rawMaximum = 0;
  let rawAoMinimum = 255;
  let rawAoMaximum = 0;
  let atlasRgbMismatches = 0;
  let atlasAoMismatches = 0;
  let meshLightmapCorners = 0;
  let meshLightmapUvMismatches = 0;
  let meshLightmapEnabledMismatches = 0;
  const meshLightmapUvMismatchExamples = [];
  let zeroRgbSlices = 0;
  let nonZeroRgbSlices = 0;
  const valueBuckets = Array(16).fill(0);
  const nonZeroExamples = [];

  for (let sliceIndex = 0; sliceIndex < gnd.lightmapSlices.length; sliceIndex++) {
    const slice = gnd.lightmapSlices[sliceIndex];
    const channels = slice.channels || 4;
    const expectedBytes = slice.width * slice.height * channels;
    if (!slice.width || !slice.height || !slice.colorPixels
      || slice.colorPixels.length !== expectedBytes) {
      throw new Error('GND lightmap slice ' + sliceIndex + ' RGB 像素長度不符。');
    }
    const pixelCount = slice.width * slice.height;
    let sliceNonZeroPixels = 0;
    const column = sliceIndex % columns;
    const row = Math.floor(sliceIndex / columns);
    const baseX = column * cellWidth + gutter;
    const baseY = row * cellHeight + gutter;
    for (let y = 0; y < slice.height; y++) {
      for (let x = 0; x < slice.width; x++) {
        const pixelIndex = y * slice.width + x;
        const sourceAt = pixelIndex * channels;
        const rgb = [
          slice.colorPixels[sourceAt],
          slice.colorPixels[sourceAt + 1],
          slice.colorPixels[sourceAt + 2],
        ];
        const ao = slice.shadowPixels
          ? slice.shadowPixels[pixelIndex]
          : channels === 4 ? slice.colorPixels[sourceAt + 3] : 255;
        rawRgbPixels++;
        rawAoMinimum = Math.min(rawAoMinimum, ao);
        rawAoMaximum = Math.max(rawAoMaximum, ao);
        if (rgb.some(value => value !== 0)) {
          nonZeroRgbPixels++;
          sliceNonZeroPixels++;
          if (nonZeroExamples.length < 12) {
            nonZeroExamples.push({ slice: sliceIndex, xy: [x, y], rgb });
          }
        }
        for (const value of rgb) {
          rawRgbBytes++;
          if (value !== 0) nonZeroRgbBytes++;
          rawMinimum = Math.min(rawMinimum, value);
          rawMaximum = Math.max(rawMaximum, value);
          valueBuckets[Math.min(15, Math.floor(value / 16))]++;
        }
        const atlasPixel = ((baseY + y) * atlas.width + baseX + x) * 4;
        const expectedRgb = rgb.map(value => Math.floor(value / posterizationLevel) * posterizationLevel);
        if (expectedRgb.some((value, channel) => atlas.lightMapPixels[atlasPixel + channel] !== value)) {
          atlasRgbMismatches++;
        }
        if (atlas.aoMapPixels[atlasPixel] !== ao
          || atlas.aoMapPixels[atlasPixel + 1] !== ao
          || atlas.aoMapPixels[atlasPixel + 2] !== ao) {
          atlasAoMismatches++;
        }
      }
    }
    if (sliceNonZeroPixels === 0) zeroRgbSlices++;
    else nonZeroRgbSlices++;
    if (pixelCount === 0) throw new Error('GND lightmap slice pixel count is zero.');
  }

  for (const bucket of meshData.buckets) {
    const surfaces = Array.isArray(bucket.surfaceIndices) ? bucket.surfaceIndices : [];
    for (let quad = 0; quad < surfaces.length; quad++) {
      const surfaceIndex = surfaces[quad];
      const surface = gnd.surfaces[surfaceIndex];
      const index = surface && surface.lightmapIndex;
      const valid = Number.isInteger(index) && index >= 0 && index < atlas.uvsBySlice.length;
      const expectedUvs = valid ? atlas.uvsBySlice[index] : null;
      for (let corner = 0; corner < 4; corner++) {
        meshLightmapCorners++;
        const vertex = quad * 4 + corner;
        const actualU = bucket.lightmapUvs[vertex * 2];
        const actualV = bucket.lightmapUvs[vertex * 2 + 1];
        let uvMatches = false;
        let sourceUv = null;
        let candidateCorners = [];
        if (valid && surface && Array.isArray(surface.uv) && bucket.sourceUvs) {
          sourceUv = [bucket.sourceUvs[vertex * 2], bucket.sourceUvs[vertex * 2 + 1]];
          candidateCorners = surface.uv.map((uv, index) => ({ uv, index })).filter(item =>
            Array.isArray(item.uv) && Math.abs(item.uv[0] - sourceUv[0]) <= 1e-5
              && Math.abs(item.uv[1] - sourceUv[1]) <= 1e-5
          ).map(item => item.index);
          uvMatches = candidateCorners.some(index => expectedUvs
            && Math.abs(actualU - expectedUvs[index][0]) <= 1e-7
            && Math.abs(actualV - expectedUvs[index][1]) <= 1e-7);
        } else {
          uvMatches = Number.isFinite(actualU) && Number.isFinite(actualV)
            && Math.abs(actualU) <= 1e-7 && Math.abs(actualV) <= 1e-7;
        }
        if (!Number.isFinite(actualU) || !Number.isFinite(actualV) || !uvMatches) {
          meshLightmapUvMismatches++;
          if (meshLightmapUvMismatchExamples.length < 12) {
            meshLightmapUvMismatchExamples.push({
              surfaceIndex,
              lightmapIndex: valid ? index : null,
              quadCorner: corner,
              sourceUv,
              candidateCorners,
              actualUv: [actualU, actualV],
              expectedUvCandidates: candidateCorners.map(index => expectedUvs && expectedUvs[index]),
            });
          }
        }
        const enabled = bucket.lightmapEnabled[vertex];
        if (enabled !== (valid ? 1 : 0)) meshLightmapEnabledMismatches++;
      }
    }
  }

  return {
    layout: gnd.lightmapLayout,
    sliceCount: gnd.lightmapSlices.length,
    totalRgbPixels: rawRgbPixels,
    rgbNonZeroPixels: nonZeroRgbPixels,
    rgbNonZeroPixelPercent: rawRgbPixels ? nonZeroRgbPixels * 100 / rawRgbPixels : 0,
    rgbZeroSlices: zeroRgbSlices,
    rgbNonZeroSlices: nonZeroRgbSlices,
    rgbNonZeroBytes: nonZeroRgbBytes,
    rgbBytes: rawRgbBytes,
    rgbNonZeroBytePercent: rawRgbBytes ? nonZeroRgbBytes * 100 / rawRgbBytes : 0,
    rgbMin: rawMinimum,
    rgbMax: rawMaximum,
    rgb16LevelHistogram: valueBuckets,
    aoMin: rawAoMinimum,
    aoMax: rawAoMaximum,
    atlasRgbMismatches,
    atlasAoMismatches,
    meshLightmapCorners,
    meshLightmapUvMismatches,
    meshLightmapEnabledMismatches,
    meshLightmapUvMismatchExamples,
    nonZeroExamples,
  };
}

function auditGndSharedTopEdges(gnd, worldScale = 0.2) {
  const surfaceIsDrawn = surfaceIndex => {
    if (!Number.isInteger(surfaceIndex) || surfaceIndex < 0 || surfaceIndex >= gnd.surfaces.length) {
      return false;
    }
    const surface = gnd.surfaces[surfaceIndex];
    return Boolean(surface && Number.isInteger(surface.textureIndex) && surface.textureIndex !== -1);
  };
  const topIsTextured = cube => {
    if (!cube || !surfaceIsDrawn(cube.topSurface)) return false;
    const surface = gnd.surfaces[cube.topSurface];
    return surface.textureIndex >= 0 && surface.textureIndex < gnd.textures.length;
  };
  const topCornerColor = (tileX, tileY, surfaceIndex, cornerIndex) => {
    const surface = gnd.surfaces[surfaceIndex];
    if (surface && Array.isArray(surface.colors) && surface.colors[cornerIndex]) {
      return surface.colors[cornerIndex];
    }
    const offsets = [[0, 0], [1, 0], [0, 1], [1, 1]][cornerIndex];
    const anchor = offsets && gnd.cubes[tileX + offsets[0] + (tileY + offsets[1]) * gnd.width];
    const anchorSurface = anchor && gnd.surfaces[anchor.topSurface];
    return anchorSurface && anchorSurface.color || [1, 1, 1, 1];
  };
  const lightmapCorner = (surface, cornerIndex) => {
    const slice = surface && Number.isInteger(surface.lightmapIndex)
      ? gnd.lightmapSlices[surface.lightmapIndex] : null;
    if (!slice || !slice.colorPixels || !slice.width || !slice.height) return null;
    const x = cornerIndex === 1 || cornerIndex === 3
      ? Math.max(0, slice.width - (slice.width >= 4 ? 2 : 1)) : Math.min(1, slice.width - 1);
    const y = cornerIndex === 2 || cornerIndex === 3
      ? Math.max(0, slice.height - (slice.height >= 4 ? 2 : 1)) : Math.min(1, slice.height - 1);
    const pixel = y * slice.width + x;
    const channels = slice.channels || 4;
    const at = pixel * channels;
    const rgb = [...slice.colorPixels.slice(at, at + 3)];
    const ao = slice.shadowPixels ? slice.shadowPixels[pixel]
      : channels === 4 ? slice.colorPixels[at + 3] : 255;
    return { pixel: [x, y], rgb, ao };
  };
  const regionCounts = {};
  const regionExamples = {};
  const result = {
    adjacentTexturedTopEdges: 0,
    continuousEdges: 0,
    heightStepEdges: 0,
    coveredHeightSteps: 0,
    uncoveredHeightSteps: 0,
    microscopicUncoveredSteps: 0,
    maximumHeightDelta: 0,
    uncoveredByAxis: { east: 0, north: 0 },
    uncoveredByTexture: { sameTextureIndex: 0, differentTextureIndex: 0 },
    uncoveredTexturePairs: {},
    uncoveredSameTextureExamples: [],
    uncoveredByRegion: regionCounts,
    examples: [],
    examplesByRegion: regionExamples,
  };
  const epsilon = 1e-5;
  const microscopicWorldDelta = 0.02;
  const addEdge = (axis, x, y, cube, neighbor, heightsA, heightsB, wallSurfaceIndex) => {
    if (!topIsTextured(cube) || !topIsTextured(neighbor)) return;
    if (![...heightsA, ...heightsB].every(Number.isFinite)) return;
    result.adjacentTexturedTopEdges++;
    const endpointDeltas = heightsA.map((value, index) =>
      Math.abs(value - heightsB[index]) * worldScale);
    const delta = Math.max(...endpointDeltas);
    result.maximumHeightDelta = Math.max(result.maximumHeightDelta, delta);
    if (delta <= epsilon) {
      result.continuousEdges++;
      return;
    }
    result.heightStepEdges++;
    if (surfaceIsDrawn(wallSurfaceIndex)) {
      result.coveredHeightSteps++;
      return;
    }
    result.uncoveredHeightSteps++;
    result.uncoveredByAxis[axis]++;
    if (delta <= microscopicWorldDelta) result.microscopicUncoveredSteps++;
    const binX = Math.min(3, Math.floor(x * 4 / gnd.width));
    const binY = Math.min(3, Math.floor(y * 4 / gnd.height));
    const region = 'x' + binX + '-y' + binY;
    regionCounts[region] = (regionCounts[region] || 0) + 1;
    const surface = gnd.surfaces[cube.topSurface];
    const neighborSurface = gnd.surfaces[neighbor.topSurface];
    const sameTextureIndex = surface && neighborSurface
      && surface.textureIndex === neighborSurface.textureIndex;
    result.uncoveredByTexture[sameTextureIndex ? 'sameTextureIndex' : 'differentTextureIndex']++;
    const textureName = item => item && item.textureIndex >= 0
      ? (gnd.textures[item.textureIndex] || '(材質名稱缺失)') : '(無材質)';
    const texturePair = [textureName(surface), textureName(neighborSurface)].sort().join(' <> ');
    result.uncoveredTexturePairs[texturePair] = (result.uncoveredTexturePairs[texturePair] || 0) + 1;
    const wall = Number.isInteger(wallSurfaceIndex)
      && wallSurfaceIndex >= 0 && wallSurfaceIndex < gnd.surfaces.length
      ? gnd.surfaces[wallSurfaceIndex] : null;
    const cornerPairs = axis === 'east' ? [[1, 0], [3, 2]] : [[2, 0], [3, 1]];
    const otherX = axis === 'east' ? x + 1 : x;
    const otherY = axis === 'north' ? y + 1 : y;
    const endpoints = cornerPairs.map(([cornerA, cornerB], endpointIndex) => {
      const uvA = surface && surface.uv && surface.uv[cornerA] || null;
      const uvB = neighborSurface && neighborSurface.uv && neighborSurface.uv[cornerB] || null;
      const colorA = topCornerColor(x, y, cube.topSurface, cornerA);
      const colorB = topCornerColor(otherX, otherY, neighbor.topSurface, cornerB);
      const lightmapA = lightmapCorner(surface, cornerA);
      const lightmapB = lightmapCorner(neighborSurface, cornerB);
      return {
        endpointIndex,
        cornerA,
        cornerB,
        heightA: heightsA[endpointIndex],
        heightB: heightsB[endpointIndex],
        uvA,
        uvB,
        uvDelta: uvA && uvB
          ? [Number(Math.abs(uvA[0] - uvB[0]).toFixed(6)),
            Number(Math.abs(uvA[1] - uvB[1]).toFixed(6))]
          : null,
        renderedColorA: colorA,
        renderedColorB: colorB,
        renderedColorDelta: colorA && colorB
          ? Number(Math.max(...colorA.slice(0, 3).map((value, channel) =>
            Math.abs(value - colorB[channel]))).toFixed(6))
          : null,
        lightmapA,
        lightmapB,
        lightmapRgbDelta: lightmapA && lightmapB
          ? lightmapA.rgb.map((value, channel) => Math.abs(value - lightmapB.rgb[channel]))
          : null,
        aoDelta: lightmapA && lightmapB ? Math.abs(lightmapA.ao - lightmapB.ao) : null,
      };
    });
    const sample = {
      axis,
      grid: [x, y],
      topSurfaces: [cube.topSurface, neighbor.topSurface],
      topTextures: [
        surface && gnd.textures[surface.textureIndex],
        neighborSurface && gnd.textures[neighborSurface.textureIndex],
      ],
      topSurfaceData: [surface, neighborSurface].map(item => item ? {
        textureIndex: item.textureIndex,
        textureName: gnd.textures[item.textureIndex] || null,
        lightmapIndex: item.lightmapIndex,
        uv: item.uv,
        color: item.color,
        colors: item.colors,
      } : null),
      edgeEndpoints: endpoints,
      endpointHeights: [heightsA, heightsB],
      endpointHeightDeltaWorld: endpointDeltas.map(value => Number(value.toFixed(5))),
      maxHeightDeltaWorld: Number(delta.toFixed(5)),
      wallSurface: wallSurfaceIndex,
      wallTexture: wall ? (Number.isInteger(wall.textureIndex) ? gnd.textures[wall.textureIndex] || null : null) : null,
    };
    if (result.examples.length < 8) result.examples.push(sample);
    if (sameTextureIndex && result.uncoveredSameTextureExamples.length < 20) {
      result.uncoveredSameTextureExamples.push(sample);
    }
    if (!regionExamples[region]) regionExamples[region] = [];
    if (regionExamples[region].length < 2) regionExamples[region].push(sample);
  };

  for (let y = 0; y < gnd.height; y++) {
    for (let x = 0; x < gnd.width; x++) {
      const index = y * gnd.width + x;
      const cube = gnd.cubes[index];
      if (!cube || !topIsTextured(cube)) continue;
      if (x + 1 < gnd.width) {
        const east = gnd.cubes[index + 1];
        if (east) {
          addEdge('east', x, y, cube, east,
            [cube.hSE, cube.hNE], [east.hSW, east.hNW], cube.eastSurface);
        }
      }
      if (y + 1 < gnd.height) {
        const north = gnd.cubes[index + gnd.width];
        if (north) {
          addEdge('north', x, y, cube, north,
            [cube.hNW, cube.hNE], [north.hSW, north.hSE], cube.northSurface);
        }
      }
    }
  }
  return result;
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

  if (mapId === 'tra_fild') {
    // Preserve a binary-level trace for every visible streak probe. This compares
    // the parser against the raw GND record and records the exact neighboring cubes.
    const traceDir = 'artifacts/gnd-source-textures';
    mkdirSync(traceDir, { recursive: true });
    const raw = new DataView(gndBytes);
    const textureCount = raw.getInt32(18, true);
    const texturePathLength = raw.getInt32(22, true);
    const lightmapHeaderOffset = 26 + textureCount * texturePathLength;
    let surfaceCountOffset;
    if (gnd.lightmapLayout === 'standard-split') {
      surfaceCountOffset = lightmapHeaderOffset + 4 + gnd.lightmapCount * 268;
    } else {
      const width = raw.getInt32(lightmapHeaderOffset + 4, true);
      const height = raw.getInt32(lightmapHeaderOffset + 8, true);
      const dataBytes = gnd.lightmapCount * width * height * 4;
      surfaceCountOffset = lightmapHeaderOffset + 16 + dataBytes;
    }
    const rawSurfaceCount = raw.getInt32(surfaceCountOffset, true);
    const surfaceStart = surfaceCountOffset + 4;
    const surfaceStride = gnd.surfaceRecordBytes;
    const cubeStart = surfaceStart + rawSurfaceCount * surfaceStride;
    assert.equal(rawSurfaceCount, gnd.surfaces.length, 'tra_fild raw GND surface count matches parser');
    assert.ok(cubeStart + gnd.width * gnd.height * 28 <= gndBytes.byteLength,
      'tra_fild raw GND surface/cube sections fit within the file');

    const observedStreakHits = [
      { x: 37, y: 93, surfaceIndex: 9935 },
      { x: 38, y: 92, surfaceIndex: 9829 },
      { x: 38, y: 91, surfaceIndex: 9724 },
      { x: 42, y: 93, surfaceIndex: 9945 },
      { x: 43, y: 92, surfaceIndex: 9834 },
      { x: 43, y: 91, surfaceIndex: 9729 },
      { x: 47, y: 93, surfaceIndex: 9955 },
      { x: 47, y: 92, surfaceIndex: 9838 },
      { x: 48, y: 91, surfaceIndex: 9734 },
      { x: 51, y: 93, surfaceIndex: 9963 },
      { x: 52, y: 92, surfaceIndex: 9843 },
      { x: 55, y: 94, surfaceIndex: 10113 },
      { x: 56, y: 93, surfaceIndex: 9973 },
      { x: 56, y: 92, surfaceIndex: 9847 },
      { x: 60, y: 94, surfaceIndex: 10123 },
      { x: 60, y: 93, surfaceIndex: 9981 },
      { x: 60, y: 92, surfaceIndex: 9851 },
      { x: 63, y: 94, surfaceIndex: 10129 },
      { x: 64, y: 93, surfaceIndex: 9989 },
      { x: 64, y: 92, surfaceIndex: 9855 },
      { x: 66, y: 94, surfaceIndex: 10135 },
      { x: 66, y: 93, surfaceIndex: 9993 },
      { x: 67, y: 92, surfaceIndex: 9858 },
    ];
    const rawBytesHex = (start, length) => Buffer.from(gndBytes, start, length).toString('hex');
    const uvRawForSurface = surfaceIndex => {
      const at = surfaceStart + surfaceIndex * surfaceStride;
      const rawUv = Array.from({ length: 8 }, (_, i) => raw.getFloat32(at + i * 4, true));
      return {
        uv: [[rawUv[0], rawUv[4]], [rawUv[1], rawUv[5]],
          [rawUv[2], rawUv[6]], [rawUv[3], rawUv[7]]],
        rawU: rawUv.slice(0, 4),
        rawV: rawUv.slice(4, 8),
      };
    };
    const auditedSurfaces = new Map();
    const addSurface = surfaceIndex => {
      if (!Number.isInteger(surfaceIndex) || surfaceIndex < 0 || surfaceIndex >= gnd.surfaces.length) return;
      if (auditedSurfaces.has(surfaceIndex)) return;
      const surface = gnd.surfaces[surfaceIndex];
      const at = surfaceStart + surfaceIndex * surfaceStride;
      const coords = uvRawForSurface(surfaceIndex);
      const textureIndex = gnd.surfaceRecordBytes === 56
        ? raw.getInt32(at + 32, true) : raw.getInt16(at + 32, true);
      const lightmapIndex = gnd.surfaceRecordBytes === 56
        ? raw.getInt32(at + 36, true) : raw.getInt16(at + 34, true);
      const cornerCount = gnd.surfaceRecordBytes === 56 ? 4 : 1;
      const rawBgra = Array.from({ length: cornerCount }, (_, corner) => {
        const colorAt = at + (cornerCount === 4 ? 40 + corner * 4 : 36);
        return Array.from(Buffer.from(gndBytes, colorAt, 4));
      });
      const decodedRgba = rawBgra.map(([b, g, r, a]) =>
        [r / 255, g / 255, b / 255, a / 255]);
      assert.deepEqual(coords.uv, surface.uv, 'tra_fild surface #' + surfaceIndex + ' raw UV order matches parser');
      assert.equal(textureIndex, surface.textureIndex,
        'tra_fild surface #' + surfaceIndex + ' raw texture ID matches parser');
      assert.equal(lightmapIndex, surface.lightmapIndex,
        'tra_fild surface #' + surfaceIndex + ' raw lightmap ID matches parser');
      assert.deepEqual(decodedRgba[0], surface.color,
        'tra_fild surface #' + surfaceIndex + ' raw BGRA tint decodes to parsed RGBA');
      auditedSurfaces.set(surfaceIndex, {
        surfaceIndex,
        byteOffset: at,
        byteLength: surfaceStride,
        rawHex: rawBytesHex(at, surfaceStride),
        rawU: coords.rawU,
        rawV: coords.rawV,
        uv: surface.uv,
        textureIndex,
        texturePath: textureIndex >= 0 ? gnd.textures[textureIndex] : null,
        lightmapIndex,
        rawBgraTint: rawBgra,
        parsedRgbaTint: decodedRgba,
      });
    };
    const cubeRecord = (x, y) => {
      if (x < 0 || y < 0 || x >= gnd.width || y >= gnd.height) return null;
      const index = y * gnd.width + x;
      const at = cubeStart + index * 28;
      const parsed = gnd.cubes[index];
      const heights = [0, 1, 2, 3].map(i => raw.getFloat32(at + i * 4, true));
      const ids = [0, 1, 2].map(i => raw.getInt32(at + 16 + i * 4, true));
      assert.deepEqual(heights, [parsed.hSW, parsed.hSE, parsed.hNW, parsed.hNE],
        'tra_fild cube (' + x + ',' + y + ') raw heights match parser');
      assert.deepEqual(ids, [parsed.topSurface, parsed.northSurface, parsed.eastSurface],
        'tra_fild cube (' + x + ',' + y + ') raw surface IDs match parser');
      ids.forEach(addSurface);
      return {
        xy: [x, y],
        cubeIndex: index,
        byteOffset: at,
        rawHex: rawBytesHex(at, 28),
        heights,
        topSurface: ids[0],
        northSurface: ids[1],
        eastSurface: ids[2],
      };
    };
    const surfaceUseSites = new Map();
    for (let cubeIndex = 0; cubeIndex < gnd.cubes.length; cubeIndex++) {
      const cube = gnd.cubes[cubeIndex];
      const x = cubeIndex % gnd.width;
      const y = Math.floor(cubeIndex / gnd.width);
      for (const [side, index] of [
        ['top', cube.topSurface], ['north', cube.northSurface], ['east', cube.eastSurface],
      ]) {
        if (!Number.isInteger(index) || index < 0) continue;
        if (!surfaceUseSites.has(index)) surfaceUseSites.set(index, []);
        surfaceUseSites.get(index).push({ x, y, side });
      }
    }
    // Surface IDs are reusable blueprints. Include their actual use sites rather
    // than assuming the inspector's representative cube is always the ray-hit cube.
    observedStreakHits.forEach(hit => addSurface(hit.surfaceIndex));
    const samples = observedStreakHits.map(hit => {
      const cube = cubeRecord(hit.x, hit.y);
      assert.ok(cube, 'tra_fild streak probe coordinate is within the source GND');
      const neighbours = {
        west: cubeRecord(hit.x - 1, hit.y),
        east: cubeRecord(hit.x + 1, hit.y),
        south: cubeRecord(hit.x, hit.y - 1),
        north: cubeRecord(hit.x, hit.y + 1),
      };
      return {
        reportedRepresentativeCube: [hit.x, hit.y],
        cursorSurfaceIndex: hit.surfaceIndex,
        representativeCubeTopMatchesCursorSurface: cube.topSurface === hit.surfaceIndex,
        cursorSurfaceUseSites: surfaceUseSites.get(hit.surfaceIndex) || [],
        cube,
        neighbours,
      };
    });
    // Exact surface ID visible in the pale tra_fild diffuse-streak screenshot.
    // Trace every raw cube using this reusable surface blueprint and its neighbors.
    const screenshotSurfaceIndex = 9967;
    addSurface(screenshotSurfaceIndex);
    const screenshotSurface = gnd.surfaces[screenshotSurfaceIndex];
    assert.ok(screenshotSurface, 'tra_fild screenshot surface #9967 exists in the raw GND');
    assert.equal(gnd.textures[screenshotSurface.textureIndex], '필드바닥/prt_도시01.bmp',
      'tra_fild screenshot surface #9967 must use the inspected prt_도시01 texture');
    const screenshotUvBounds = {
      minU: Math.min(...screenshotSurface.uv.map(uv => uv[0])),
      maxU: Math.max(...screenshotSurface.uv.map(uv => uv[0])),
      minV: Math.min(...screenshotSurface.uv.map(uv => uv[1])),
      maxV: Math.max(...screenshotSurface.uv.map(uv => uv[1])),
    };
    assert.deepEqual(screenshotUvBounds, { minU: 0.75, maxU: 1, minV: 0, maxV: 0.25 },
      'tra_fild screenshot surface #9967 UV bounds must match the GPU inspector');
    const screenshotSurfaceUses = surfaceUseSites.get(screenshotSurfaceIndex) || [];
    const screenshotSurfaceTraces = screenshotSurfaceUses.map(useSite => {
      const cube = cubeRecord(useSite.x, useSite.y);
      const neighbours = {
        west: cubeRecord(useSite.x - 1, useSite.y),
        east: cubeRecord(useSite.x + 1, useSite.y),
        south: cubeRecord(useSite.x, useSite.y - 1),
        north: cubeRecord(useSite.x, useSite.y + 1),
      };
      return { useSite, cube, neighbours };
    });
    writeFileSync(traceDir + '/tra-fild-raw-gnd-surface-audit.json', JSON.stringify({
      mapId,
      gndVersion: gnd.version,
      gndSize: [gnd.width, gnd.height],
      layout: gnd.lightmapLayout,
      surfaceRecordBytes: surfaceStride,
      rawFileBytes: gndBytes.byteLength,
      offsets: {
        textureTable: 26,
        lightmapHeader: lightmapHeaderOffset,
        surfaceCount: surfaceCountOffset,
        surfaceStart,
        cubeStart,
      },
      textureTable: gnd.textures.map((path, index) => ({ index, path })),
      probes: samples,
      screenshotSurfaceIndex,
      screenshotSurface: auditedSurfaces.get(screenshotSurfaceIndex),
      screenshotSurfaceUseSites: screenshotSurfaceUses,
      screenshotSurfaceTraces,
      uniqueReferencedSurfaces: [...auditedSurfaces.values()].sort((a, b) => a.surfaceIndex - b.surfaceIndex),
      checks: {
        rawSurfaceCountMatchesParser: rawSurfaceCount === gnd.surfaces.length,
        rawCubeCount: gnd.width * gnd.height,
        allCursorSurfaceIdsHaveRawRecords: samples.every(sample => auditedSurfaces.has(sample.cursorSurfaceIndex)),
        reportedCubeMatchesCursorSurfaceCount: samples.filter(sample => sample.representativeCubeTopMatchesCursorSurface).length,
        screenshotSurfaceRawRecordMatchesInspector: screenshotSurface.textureIndex >= 0
          && screenshotSurfaceTraces.length > 0,
        screenshotSurfaceUVMatchesInspector: screenshotUvBounds.minU === 0.75
          && screenshotUvBounds.maxU === 1 && screenshotUvBounds.minV === 0
          && screenshotUvBounds.maxV === 0.25,
        rawUvTextureLightmapAndBgraMatchParser: true,
      },
    }, null, 2) + '\n');
    console.log('tra_fild raw GND surface/cube audit: ' + JSON.stringify({
      gndVersion: gnd.version,
      size: [gnd.width, gnd.height],
      stride: surfaceStride,
      samples: samples.length,
      uniqueSurfaces: auditedSurfaces.size,
      textureIds: [...new Set([...auditedSurfaces.values()].map(s => s.textureIndex))],
      surfaceOffsets: [surfaceStart, cubeStart],
    }));
  }
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
  const lightmapAtlas = buildGndLightmapAtlasData(gnd, 16);
  const terrainMeshData = buildGndMeshData(gnd, 0.2, lightmapAtlas);
  const vertexColorAudit = auditGndVertexColors(terrainMeshData);
  const lightmapPipelineAudit = auditGndLightmapPipeline(gnd, lightmapAtlas, terrainMeshData, 16);
  const sharedTopEdgeAudit = auditGndSharedTopEdges(gnd, 0.2);
  assert.equal(lightmapPipelineAudit.atlasRgbMismatches, 0,
    mapId + ' RGB lightmap atlas must exactly preserve source pixels after RO 16-level posterization');
  assert.equal(lightmapPipelineAudit.atlasAoMismatches, 0,
    mapId + ' AO atlas must exactly preserve source shadow pixels');
  assert.equal(lightmapPipelineAudit.meshLightmapUvMismatches, 0,
    mapId + ' every GND surface corner must use the referenced lightmap slice UV');
  assert.equal(lightmapPipelineAudit.meshLightmapEnabledMismatches, 0,
    mapId + ' every GND mesh corner must have the right lightmap enabled flag');
  assert.ok(vertexColorAudit.cornerSamples > 0, mapId + ' rendered top surfaces have vertex-color samples');
  assert.equal(vertexColorAudit.mismatchPairs, 0,
    mapId + ' every shared 3D vertex must use the same ground-grid tint');
  assert.equal(lightmapAtlas.sourceGutter, 1,
    mapId + ' atlas excludes the source lightmap/AO border ring');
  assert.ok(lightmapAtlas, mapId + ' lightmap atlas was built');
  assert.equal(lightmapAtlas.uvsBySlice.length, gnd.lightmapCount, mapId + ' lightmap atlas UV count');
  assert.ok(lightmapAtlas.width <= 4096 && lightmapAtlas.height <= 4096, mapId + ' atlas fits common GPU limits');
  const rsw = parseRswBuffer(rswBytes);
  mkdirSync('artifacts/gnd-source-textures', { recursive: true });
  const rswLightmapContext = {
    mapId,
    gndLightmapLayout: lightmapPipelineAudit.layout,
    rawRgbNonZeroPixelPercent: Number(lightmapPipelineAudit.rgbNonZeroPixelPercent.toFixed(4)),
    rawRgbNonZeroSlices: lightmapPipelineAudit.rgbNonZeroSlices,
    rawRgbZeroSlices: lightmapPipelineAudit.rgbZeroSlices,
    rawRgbMin: lightmapPipelineAudit.rgbMin,
    rawRgbMax: lightmapPipelineAudit.rgbMax,
    rswVersion: rsw.version,
    directionalLight: rsw.light,
    pointLightCount: rsw.lights.length,
    pointLights: rsw.lights.slice(0, 8),
  };
  writeFileSync(
    'artifacts/gnd-source-textures/' + mapId + '-rsw-lightmap-context.json',
    JSON.stringify(rswLightmapContext, null, 2) + '\n'
  );
  console.log(mapId + ' RSW/lightmap source context: ' + JSON.stringify(rswLightmapContext));
  assert.ok(rsw.models.length > 0, mapId + ' RSW has map model instances');
  assert.ok(rsw.light.ambient.every(Number.isFinite), mapId + ' RSW ambient light is finite');
  assert.ok(rsw.light.diffuse.every(Number.isFinite), mapId + ' RSW diffuse light is finite');
  assert.ok(rsw.lights.every(light => [...light.position, ...light.color, light.range].every(Number.isFinite)),
    mapId + ' RSW point-light data is finite');

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
  const usedTexturePixels = new Map();
  assert.ok(usedTextures.length > 0, mapId + ' at least one used ground texture resolves');

  // Capture every used Prontera diffuse atlas to identify whether the visible
  // white triangle pattern is encoded in a different texture than city01/city02.
  if (mapId === 'prontera') {
    const allTextureArtifactDir = 'artifacts/gnd-source-textures';
    mkdirSync(allTextureArtifactDir, { recursive: true });
    const capturedTextures = [];
    for (let textureIndex = 0; textureIndex < usedTextures.length; textureIndex++) {
      const textureName = usedTextures[textureIndex];
      const textureUrl = urls.textures[textureName];
      if (!textureUrl) continue;
      const response = await fetchResponse(textureUrl, 'prontera source texture ' + textureName);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length > 8
        && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'Prontera used texture is a valid PNG: ' + textureName);
      const filename = 'prontera-used-texture-' + String(textureIndex).padStart(2, '0') + '.png';
      writeFileSync(allTextureArtifactDir + '/' + filename, bytes);
      usedTexturePixels.set(textureName, decodePngPixels(bytes));
      capturedTextures.push({ index: textureIndex, name: textureName, url: textureUrl, filename });
    }
    writeFileSync(
      allTextureArtifactDir + '/prontera-used-texture-manifest.json',
      JSON.stringify(capturedTextures, null, 2) + '\n'
    );
  }


  // Preserve the exact atlas named by the lingering tra_fild diffuse-only stripe.
  // Browser inspection identified surface 5425 using pron-dun-02.bmp / UV [0.25, 0.5] × [0, 0.25].
  // Save the untouched source plus all used UV regions so the feature can be classified as
  // source texture content or a renderer/UV mismatch before changing the game shader.
  if (mapId === 'tra_fild') {
    const targetTextureIndex = gnd.textures.findIndex(name =>
      normalizeTextureName(name).endsWith('pron-dun-02.bmp'));
    assert.ok(targetTextureIndex >= 0, 'tra_fild has the pron-dun-02.bmp diffuse atlas');
    const targetTextureName = normalizeTextureName(gnd.textures[targetTextureIndex]);
    const targetTextureUrl = urls.textures[targetTextureName];
    assert.ok(targetTextureUrl, 'tra_fild pron-dun-02 diffuse URL resolves');
    const targetResponse = await fetchResponse(targetTextureUrl, 'tra_fild pron-dun-02 diagnostic texture');
    const targetBytes = Buffer.from(await targetResponse.arrayBuffer());
    assert.ok(targetBytes.length > 8
      && targetBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'tra_fild pron-dun-02 source texture is a valid PNG');
    const targetImage = decodePngPixels(targetBytes);
    const sourceArtifactDir = 'artifacts/gnd-source-textures';
    mkdirSync(sourceArtifactDir, { recursive: true });
    writeFileSync(sourceArtifactDir + '/tra-fild-pron-dun-02-source.png', targetBytes);

    const boundsForSurface = surface => ({
      minU: Math.min(...surface.uv.map(uv => uv[0])),
      maxU: Math.max(...surface.uv.map(uv => uv[0])),
      minV: Math.min(...surface.uv.map(uv => uv[1])),
      maxV: Math.max(...surface.uv.map(uv => uv[1])),
    });
    const usedRegions = new Map();
    for (let cubeIndex = 0; cubeIndex < gnd.cubes.length; cubeIndex++) {
      const surfaceIndex = gnd.cubes[cubeIndex].topSurface;
      if (surfaceIndex < 0 || surfaceIndex >= gnd.surfaces.length) continue;
      const surface = gnd.surfaces[surfaceIndex];
      if (!surface || surface.textureIndex !== targetTextureIndex
        || !Array.isArray(surface.uv) || surface.uv.length !== 4) continue;
      const bounds = boundsForSurface(surface);
      const key = [bounds.minU, bounds.maxU, bounds.minV, bounds.maxV]
        .map(value => value.toFixed(5)).join(':');
      if (!usedRegions.has(key)) {
        usedRegions.set(key, {
          uvBounds: bounds,
          sourcePixelBounds: {
            x0: Math.round(bounds.minU * targetImage.width),
            x1: Math.round(bounds.maxU * targetImage.width),
            y0: Math.round((1 - bounds.maxV) * targetImage.height),
            y1: Math.round((1 - bounds.minV) * targetImage.height),
          },
          surfaceCount: 0,
          examples: [],
        });
      }
      const region = usedRegions.get(key);
      region.surfaceCount++;
      if (region.examples.length < 8) {
        region.examples.push({
          cube: [cubeIndex % gnd.width, Math.floor(cubeIndex / gnd.width)],
          surfaceIndex,
          surfaceUvs: surface.uv,
        });
      }
    }
    const suspectRegion = [...usedRegions.entries()].find(([, region]) =>
      Math.abs(region.uvBounds.minU - 0.25) < 1e-5
      && Math.abs(region.uvBounds.maxU - 0.5) < 1e-5
      && Math.abs(region.uvBounds.minV - 0) < 1e-5
      && Math.abs(region.uvBounds.maxV - 0.25) < 1e-5);
    assert.ok(suspectRegion, 'tra_fild pron-dun-02 contains the inspected UV region');
    const regionAudit = {
      mapId,
      textureName: gnd.textures[targetTextureIndex],
      textureUrl: targetTextureUrl,
      imageSize: [targetImage.width, targetImage.height],
      browserInspectorReference: {
        surfaceIndex: 5425,
        uvBounds: { minU: 0.25, maxU: 0.5, minV: 0, maxV: 0.25 },
      },
      capturedRegion: suspectRegion[1],
      usedUvRegions: [...usedRegions.values()],
      sourcePixelStats: (() => {
        const { x0, x1, y0, y1 } = suspectRegion[1].sourcePixelBounds;
        let brightPixels = 0;
        let darkPixels = 0;
        let lumaSum = 0;
        let pixelCount = 0;
        const brightCountByRow = [];
        for (let y = y0; y < y1; y++) {
          let brightInRow = 0;
          for (let x = x0; x < x1; x++) {
            const rgba = targetImage.pixelAt(x, y);
            const luma = 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];
            if (luma >= 220) { brightPixels++; brightInRow++; }
            if (luma <= 40) darkPixels++;
            lumaSum += luma;
            pixelCount++;
          }
          brightCountByRow.push(brightInRow);
        }
        return {
          pixelCount,
          meanLuma: Number((lumaSum / Math.max(1, pixelCount)).toFixed(3)),
          brightPixels,
          darkPixels,
          brightCountByRow,
        };
      })(),
    };
    writeFileSync(
      sourceArtifactDir + '/tra-fild-pron-dun-02-source-uv-audit.json',
      JSON.stringify(regionAudit, null, 2) + '\n'
    );
    console.log('tra_fild inspected diffuse source/UV evidence: ' + JSON.stringify({
      textureName: regionAudit.textureName,
      textureUrl: regionAudit.textureUrl,
      imageSize: regionAudit.imageSize,
      sourcePixelBounds: regionAudit.capturedRegion.sourcePixelBounds,
      regionSurfaceCount: regionAudit.capturedRegion.surfaceCount,
      sourcePixelStats: regionAudit.sourcePixelStats,
    }));
  }


  // Audit the exact original diffuse atlas used by the lingering tra_fild white streak.
  // The raw GND audit already confirms surface #9967's ID and UVs; this captures the
  // matching public source texture so source-painted pixels can be separated from GPU sampling.
  if (mapId === 'tra_fild') {
    const targetSurfaceIndex = 9967;
    const targetSurface = gnd.surfaces[targetSurfaceIndex];
    assert.ok(targetSurface, 'tra_fild white-streak surface #9967 exists');
    const targetTextureIndex = gnd.textures.findIndex(name =>
      normalizeTextureName(name).endsWith('prt_도시01.bmp'));
    assert.ok(targetTextureIndex >= 0, 'tra_fild contains the prt_도시01 diffuse atlas');
    assert.equal(targetSurface.textureIndex, targetTextureIndex,
      'tra_fild white-streak surface #9967 references the prt_도시01 diffuse atlas');
    const uvBounds = {
      minU: Math.min(...targetSurface.uv.map(uv => uv[0])),
      maxU: Math.max(...targetSurface.uv.map(uv => uv[0])),
      minV: Math.min(...targetSurface.uv.map(uv => uv[1])),
      maxV: Math.max(...targetSurface.uv.map(uv => uv[1])),
    };
    assert.deepEqual(uvBounds, { minU: 0.75, maxU: 1, minV: 0, maxV: 0.25 },
      'tra_fild white-streak surface #9967 UV bounds remain source-data exact');
    const useSites = [];
    for (let cubeIndex = 0; cubeIndex < gnd.cubes.length; cubeIndex++) {
      if (gnd.cubes[cubeIndex].topSurface === targetSurfaceIndex) {
        useSites.push({ x: cubeIndex % gnd.width, y: Math.floor(cubeIndex / gnd.width) });
      }
    }
    assert.deepEqual(useSites, [{ x: 53, y: 93 }],
      'tra_fild white-streak surface #9967 is used by the expected top cube');
    const targetTextureName = normalizeTextureName(gnd.textures[targetTextureIndex]);
    const targetTextureUrl = urls.textures[targetTextureName];
    assert.ok(targetTextureUrl, 'tra_fild prt_도시01 texture URL resolves from the live manifest');
    const textureResponse = await fetchResponse(targetTextureUrl, 'tra_fild prt_도시01 exact source texture');
    const textureBytes = Buffer.from(await textureResponse.arrayBuffer());
    assert.ok(textureBytes.length > 8
      && textureBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'tra_fild prt_도시01 source texture is a valid PNG');
    const image = decodePngPixels(textureBytes);
    const sourcePixelBounds = {
      x0: Math.round(uvBounds.minU * image.width),
      x1: Math.round(uvBounds.maxU * image.width),
      y0: Math.round((1 - uvBounds.maxV) * image.height),
      y1: Math.round((1 - uvBounds.minV) * image.height),
    };
    assert.ok(sourcePixelBounds.x0 >= 0 && sourcePixelBounds.x1 <= image.width
      && sourcePixelBounds.y0 >= 0 && sourcePixelBounds.y1 <= image.height
      && sourcePixelBounds.x1 > sourcePixelBounds.x0
      && sourcePixelBounds.y1 > sourcePixelBounds.y0,
    'tra_fild source UV maps to an in-bounds image rectangle');
    const luma = pixel => 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
    const brightThreshold = 220;
    const darkThreshold = 40;
    const sourceRegionStats = (() => {
      let brightPixels = 0;
      let darkPixels = 0;
      let lumaSum = 0;
      const brightCountByRow = [];
      for (let y = sourcePixelBounds.y0; y < sourcePixelBounds.y1; y++) {
        let brightInRow = 0;
        for (let x = sourcePixelBounds.x0; x < sourcePixelBounds.x1; x++) {
          const pixel = image.pixelAt(x, y);
          const value = luma(pixel);
          if (value >= brightThreshold) { brightPixels++; brightInRow++; }
          if (value <= darkThreshold) darkPixels++;
          lumaSum += value;
        }
        brightCountByRow.push({ y, brightPixels: brightInRow });
      }
      const pixelCount = (sourcePixelBounds.x1 - sourcePixelBounds.x0)
        * (sourcePixelBounds.y1 - sourcePixelBounds.y0);
      return {
        pixelCount,
        meanLuma: Number((lumaSum / pixelCount).toFixed(3)),
        brightThreshold,
        darkThreshold,
        brightPixels,
        darkPixels,
        brightCountByRow,
        bottomEdge: Array.from({ length: sourcePixelBounds.x1 - sourcePixelBounds.x0 }, (_, i) => {
          const x = sourcePixelBounds.x0 + i;
          const pixel = image.pixelAt(x, sourcePixelBounds.y1 - 1);
          return { x, rgba: pixel, luma: Number(luma(pixel).toFixed(2)) };
        }),
      };
    })();
    const inspectorUv = [0.9210, 0.0012];
    const inspectorSample = mapGndDiffuseUvToSourcePixel(
      inspectorUv, uvBounds, image.width, image.height
    );
    const probeX = inspectorSample.nearestPixel[0];
    const probeY = inspectorSample.nearestPixel[1];
    const probeNeighborhood = [];
    for (let y = Math.max(0, probeY - 2); y <= Math.min(image.height - 1, probeY + 2); y++) {
      for (let x = Math.max(0, probeX - 2); x <= Math.min(image.width - 1, probeX + 2); x++) {
        probeNeighborhood.push({ x, y, rgba: image.pixelAt(x, y) });
      }
    }
    const sourceArtifactDir = 'artifacts/gnd-source-textures';
    mkdirSync(sourceArtifactDir, { recursive: true });
    writeFileSync(sourceArtifactDir + '/tra-fild-prt-city-01-source.png', textureBytes);
    const audit = {
      mapId,
      gndVersion: gnd.version,
      gndSize: [gnd.width, gnd.height],
      surfaceIndex: targetSurfaceIndex,
      cubeUseSites: useSites,
      textureIndex: targetTextureIndex,
      textureName: gnd.textures[targetTextureIndex],
      textureUrl: targetTextureUrl,
      imageSize: [image.width, image.height],
      uv: targetSurface.uv,
      uvBounds,
      sourcePixelBounds,
      inspectorUv,
      inspectorSample,
      inspectorNearestPixel: { x: probeX, y: probeY, rgba: image.pixelAt(probeX, probeY) },
      probeNeighborhood,
      sourceRegionStats,
    };
    writeFileSync(sourceArtifactDir + '/tra-fild-prt-city-01-surface-9967-audit.json',
      JSON.stringify(audit, null, 2) + '\n');
    console.log('tra_fild exact white-streak diffuse source audit: ' + JSON.stringify({
      surfaceIndex: targetSurfaceIndex,
      cubeUseSites: useSites,
      textureName: audit.textureName,
      imageSize: audit.imageSize,
      sourcePixelBounds,
      inspectorNearestPixel: audit.inspectorNearestPixel,
      sourceRegion: {
        meanLuma: sourceRegionStats.meanLuma,
        brightPixels: sourceRegionStats.brightPixels,
        darkPixels: sourceRegionStats.darkPixels,
      },
    }));
  }

  const topSurfaceIndexes = new Set();
  for (const cube of gnd.cubes) {
    if (cube.topSurface >= 0 && cube.topSurface < gnd.surfaces.length) {
      topSurfaceIndexes.add(cube.topSurface);
    }
  }

  if (mapId === 'prontera') {
    const usedUvRegions = new Map();
    for (let cubeIndex = 0; cubeIndex < gnd.cubes.length; cubeIndex++) {
      const cube = gnd.cubes[cubeIndex];
      const surfaceIndex = cube.topSurface;
      if (!topSurfaceIndexes.has(surfaceIndex)) continue;
      const surface = gnd.surfaces[surfaceIndex];
      if (!surface || !usedTextureIndexes.has(surface.textureIndex)
        || !Array.isArray(surface.uv) || surface.uv.length !== 4) continue;
      const values = surface.uv.flat();
      if (!values.every(Number.isFinite)) continue;
      const bounds = {
        minU: Math.min(...surface.uv.map(uv => uv[0])),
        maxU: Math.max(...surface.uv.map(uv => uv[0])),
        minV: Math.min(...surface.uv.map(uv => uv[1])),
        maxV: Math.max(...surface.uv.map(uv => uv[1])),
      };
      const key = surface.textureIndex + '|' + [
        bounds.minU, bounds.maxU, bounds.minV, bounds.maxV,
      ].map(value => value.toFixed(5)).join(':');
      if (!usedUvRegions.has(key)) {
        usedUvRegions.set(key, {
          textureIndex: surface.textureIndex,
          textureName: normalizeTextureName(gnd.textures[surface.textureIndex] || ''),
          uvBounds: bounds,
          surfaceCount: 0,
          examples: [],
        });
      }
      const record = usedUvRegions.get(key);
      record.surfaceCount++;
      if (record.examples.length < 8) {
        record.examples.push({
          cube: [cubeIndex % gnd.width, Math.floor(cubeIndex / gnd.width)],
          surfaceIndex,
          heights: [cube.hSW, cube.hSE, cube.hNW, cube.hNE],
        });
      }
    }
    const uvRegionReport = [...usedUvRegions.values()].sort((a, b) =>
      a.textureName.localeCompare(b.textureName) || a.uvBounds.minV - b.uvBounds.minV
        || a.uvBounds.minU - b.uvBounds.minU);
    writeFileSync(
      'artifacts/gnd-source-textures/prontera-used-texture-uv-regions.json',
      JSON.stringify(uvRegionReport, null, 2) + '\n'
    );

    const bilinearRgbaAtSourcePosition = (pixels, sourcePosition) => {
      const x = Math.max(0, Math.min(pixels.width - 1, sourcePosition[0]));
      const y = Math.max(0, Math.min(pixels.height - 1, sourcePosition[1]));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(pixels.width - 1, x0 + 1);
      const y1 = Math.min(pixels.height - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const samples = [
        [pixels.pixelAt(x0, y0), (1 - fx) * (1 - fy)],
        [pixels.pixelAt(x1, y0), fx * (1 - fy)],
        [pixels.pixelAt(x0, y1), (1 - fx) * fy],
        [pixels.pixelAt(x1, y1), fx * fy],
      ];
      return [0, 1, 2, 3].map(channel => Number(samples.reduce(
        (sum, [rgba, weight]) => sum + rgba[channel] * weight, 0
      ).toFixed(4)));
    };
    const surfaceUvBounds = surface => ({
      minU: Math.min(...surface.uv.map(uv => uv[0])),
      maxU: Math.max(...surface.uv.map(uv => uv[0])),
      minV: Math.min(...surface.uv.map(uv => uv[1])),
      maxV: Math.max(...surface.uv.map(uv => uv[1])),
    });
    const sourcePixelAtUv = (surface, uv) => {
      if (!surface || !Array.isArray(surface.uv) || !Array.isArray(uv)
        || uv.length < 2 || !uv.every(Number.isFinite)) return null;
      const textureName = normalizeTextureName(gnd.textures[surface.textureIndex] || '');
      const pixels = usedTexturePixels.get(textureName);
      if (!pixels) return null;
      const uvRect = surfaceUvBounds(surface);
      const mapping = mapGndDiffuseUvToSourcePixel(uv, uvRect, pixels.width, pixels.height);
      return {
        xy: mapping.nearestPixel,
        sourcePosition: mapping.sourcePosition.map(value => Number(value.toFixed(5))),
        rgba: bilinearRgbaAtSourcePosition(pixels, mapping.sourcePosition),
        localUv: mapping.localUv.map(value => Number(value.toFixed(6))),
        crop: mapping.crop,
        sampling: 'padded crop UV mapped to the same global source coordinate (LOD0 bilinear)',
      };
    };
    const legacyInsetCropPixelAtUv = (surface, uv) => {
      if (!surface || !Array.isArray(surface.uv) || !Array.isArray(uv)
        || uv.length < 2 || !uv.every(Number.isFinite)) return null;
      const textureName = normalizeTextureName(gnd.textures[surface.textureIndex] || '');
      const pixels = usedTexturePixels.get(textureName);
      if (!pixels) return null;
      const rect = surfaceUvBounds(surface);
      const x0 = Math.max(0, Math.min(pixels.width - 1, Math.round(rect.minU * pixels.width)));
      const x1 = Math.max(x0 + 1, Math.min(pixels.width, Math.round(rect.maxU * pixels.width)));
      const y0 = Math.max(0, Math.min(pixels.height - 1,
        Math.round((1 - rect.maxV) * pixels.height)));
      const y1 = Math.max(y0 + 1, Math.min(pixels.height,
        Math.round((1 - rect.minV) * pixels.height)));
      const cropWidth = x1 - x0;
      const cropHeight = y1 - y0;
      let localU = Math.max(0, Math.min(1,
        (uv[0] - rect.minU) / (rect.maxU - rect.minU)));
      let localV = Math.max(0, Math.min(1,
        (uv[1] - rect.minV) / (rect.maxV - rect.minV)));
      if (cropWidth > 1) localU = 0.5 / cropWidth + localU * (1 - 1 / cropWidth);
      if (cropHeight > 1) localV = 0.5 / cropHeight + localV * (1 - 1 / cropHeight);
      const localX = Math.max(0, Math.min(cropWidth - 1, localU * cropWidth - 0.5));
      const localY = Math.max(0, Math.min(cropHeight - 1, localV * cropHeight - 0.5));
      const sourcePosition = [x0 + localX, y0 + cropHeight - 1 - localY];
      return {
        xy: sourcePosition.map(value => Math.round(value)),
        sourcePosition: sourcePosition.map(value => Number(value.toFixed(5))),
        rgba: bilinearRgbaAtSourcePosition(pixels, sourcePosition),
        crop: { x0, y0, x1, y1, width: cropWidth, height: cropHeight },
        sampling: 'previous unpadded crop + half-texel UV inset',
      };
    };
    const edgeSamples = sharedTopEdgeAudit.uncoveredSameTextureExamples.map(edge => ({
      ...edge,
      edgeEndpoints: edge.edgeEndpoints.map(endpoint => ({
        ...endpoint,
        sourcePixelA: sourcePixelAtUv(edge.topSurfaceData[0], endpoint.uvA),
        sourcePixelB: sourcePixelAtUv(edge.topSurfaceData[1], endpoint.uvB),
        legacyInsetPixelA: legacyInsetCropPixelAtUv(edge.topSurfaceData[0], endpoint.uvA),
        legacyInsetPixelB: legacyInsetCropPixelAtUv(edge.topSurfaceData[1], endpoint.uvB),
      })),
    }));
    const uvEndpointMismatches = edgeSamples.reduce((count, edge) => count
      + edge.edgeEndpoints.filter(endpoint => endpoint.uvDelta
        && (endpoint.uvDelta[0] > 1e-5 || endpoint.uvDelta[1] > 1e-5)).length, 0);
    const tintEndpointMismatches = edgeSamples.reduce((count, edge) => count
      + edge.edgeEndpoints.filter(endpoint => endpoint.renderedColorDelta > 1e-5).length, 0);
    const sourcePixelEndpointMismatches = edgeSamples.reduce((count, edge) => count
      + edge.edgeEndpoints.filter(endpoint => endpoint.sourcePixelA && endpoint.sourcePixelB
        && endpoint.sourcePixelA.rgba.some((value, channel) =>
          Math.abs(value - endpoint.sourcePixelB.rgba[channel]) > 1e-4)).length, 0);
    const sharedUvEndpoints = edgeSamples.flatMap(edge => edge.edgeEndpoints).filter(endpoint =>
      endpoint.uvA && endpoint.uvB
      && Math.abs(endpoint.uvA[0] - endpoint.uvB[0]) <= 1e-5
      && Math.abs(endpoint.uvA[1] - endpoint.uvB[1]) <= 1e-5);
    const sharedUvSourceCoordinateMismatches = sharedUvEndpoints.filter(endpoint =>
      endpoint.sourcePixelA && endpoint.sourcePixelB
      && endpoint.sourcePixelA.sourcePosition.some((value, channel) =>
        Math.abs(value - endpoint.sourcePixelB.sourcePosition[channel]) > 1e-5)).length;
    const sharedUvLod0ColorMismatches = sharedUvEndpoints.filter(endpoint =>
      endpoint.sourcePixelA && endpoint.sourcePixelB
      && endpoint.sourcePixelA.rgba.some((value, channel) =>
        Math.abs(value - endpoint.sourcePixelB.rgba[channel]) > 1e-4)).length;
    const legacyInsetSharedUvColorMismatches = sharedUvEndpoints.filter(endpoint =>
      endpoint.legacyInsetPixelA && endpoint.legacyInsetPixelB
      && endpoint.legacyInsetPixelA.rgba.some((value, channel) =>
        Math.abs(value - endpoint.legacyInsetPixelB.rgba[channel]) > 1e-4)).length;
    const lightmapRgbMismatches = edgeSamples.reduce((count, edge) => count
      + edge.edgeEndpoints.filter(endpoint => endpoint.lightmapRgbDelta
        && endpoint.lightmapRgbDelta.some(value => value !== 0)).length, 0);
    const aoMismatches = edgeSamples.reduce((count, edge) => count
      + edge.edgeEndpoints.filter(endpoint => endpoint.aoDelta !== null && endpoint.aoDelta !== 0).length, 0);
    const maximumLightmapRgbDelta = Math.max(0, ...edgeSamples.flatMap(edge =>
      edge.edgeEndpoints.flatMap(endpoint => endpoint.lightmapRgbDelta || [])));
    const maximumAoDelta = Math.max(0, ...edgeSamples.flatMap(edge =>
      edge.edgeEndpoints.map(endpoint => endpoint.aoDelta || 0)));
    const edgeReport = {
      mapId,
      source: 'live public Prontera GND plus exact diffuse, AO, and RGB lightmap samples',
      candidateCount: edgeSamples.length,
      endpointCount: edgeSamples.reduce((count, edge) => count + edge.edgeEndpoints.length, 0),
      uvEndpointMismatches,
      renderedTintEndpointMismatches: tintEndpointMismatches,
      sourcePixelEndpointMismatches,
      sharedUvEndpointCount: sharedUvEndpoints.length,
      sharedUvSourceCoordinateMismatches,
      sharedUvLod0ColorMismatches,
      legacyInsetSharedUvColorMismatches,
      lightmapRgbMismatches,
      aoMismatches,
      maximumLightmapRgbDelta,
      maximumAoDelta,
      edges: edgeSamples,
    };
    writeFileSync(
      'artifacts/gnd-source-textures/prontera-uncovered-same-texture-edges.json',
      JSON.stringify(edgeReport, null, 2) + '\n'
    );
    console.log('Prontera same-texture edge pixel audit: ' + JSON.stringify({
      candidates: edgeReport.candidateCount,
      endpoints: edgeReport.endpointCount,
      uvEndpointMismatches,
      renderedTintEndpointMismatches: tintEndpointMismatches,
      sourcePixelEndpointMismatches,
      sharedUvEndpointCount: sharedUvEndpoints.length,
      sharedUvSourceCoordinateMismatches,
      sharedUvLod0ColorMismatches,
      legacyInsetSharedUvColorMismatches,
      lightmapRgbMismatches,
      aoMismatches,
      maximumLightmapRgbDelta,
      maximumAoDelta,
      examples: edgeSamples.map(edge => ({
        axis: edge.axis,
        grid: edge.grid,
        surfaces: edge.topSurfaces,
        texture: edge.topTextures[0],
        heightDelta: edge.endpointHeightDeltaWorld,
        uvDelta: edge.edgeEndpoints.map(endpoint => endpoint.uvDelta),
        tintDelta: edge.edgeEndpoints.map(endpoint => endpoint.renderedColorDelta),
        sourceUv: edge.edgeEndpoints.map(endpoint => [endpoint.uvA, endpoint.uvB]),
        sourceRgbaLod0Expected: edge.edgeEndpoints.map(endpoint => [
          endpoint.sourcePixelA && endpoint.sourcePixelA.rgba,
          endpoint.sourcePixelB && endpoint.sourcePixelB.rgba,
        ]),
        sourceSamplePositions: edge.edgeEndpoints.map(endpoint => [
          endpoint.sourcePixelA && endpoint.sourcePixelA.sourcePosition,
          endpoint.sourcePixelB && endpoint.sourcePixelB.sourcePosition,
        ]),
        legacyInsetCropRgba: edge.edgeEndpoints.map(endpoint => [
          endpoint.legacyInsetPixelA && endpoint.legacyInsetPixelA.rgba,
          endpoint.legacyInsetPixelB && endpoint.legacyInsetPixelB.rgba,
        ]),
        lightmaps: edge.topSurfaceData.map(surface => surface.lightmapIndex),
        lightmapRgb: edge.edgeEndpoints.map(endpoint => [
          endpoint.lightmapA && endpoint.lightmapA.rgb,
          endpoint.lightmapB && endpoint.lightmapB.rgb,
        ]),
        ao: edge.edgeEndpoints.map(endpoint => [
          endpoint.lightmapA && endpoint.lightmapA.ao,
          endpoint.lightmapB && endpoint.lightmapB.ao,
        ]),
      })),
    }));
  }

  let sampleCandidate = null;
  for (const index of topSurfaceIndexes) {
    const surface = gnd.surfaces[index];
    if (surface.textureIndex < 0 || surface.textureIndex >= gnd.textures.length
      || surface.lightmapIndex < 0 || surface.lightmapIndex >= gnd.lightmapCount) continue;
    const name = normalizeTextureName(gnd.textures[surface.textureIndex]);
    if (!name || !urls.textures[name] || /backside/i.test(name)) continue;
    const slice = gnd.lightmapSlices[surface.lightmapIndex];
    for (let y = 1; y < slice.height - 1; y++) {
      for (let x = 1; x < slice.width - 1; x++) {
        const pixel = y * slice.width + x;
        const rgb = [...slice.colorPixels.slice(pixel * 3, pixel * 3 + 3)];
        const ao = slice.shadowPixels[pixel];
        const score = rgb.reduce((sum, channel) => sum + channel, 0) + (255 - ao) * 3;
        if (!sampleCandidate || score > sampleCandidate.score) {
          sampleCandidate = {
            surfaceIndex: index,
            textureName: name,
            lightmapIndex: surface.lightmapIndex,
            sampleX: x,
            sampleY: y,
            aoValue: ao,
            rawLightRgb: rgb,
            score,
          };
        }
      }
    }
  }
  assert.ok(sampleCandidate,
    mapId + ' has a top-surface diffuse texture (not BACKSIDE) with valid real AO/RGB lightmap data');
  const sampleSurfaceIndex = sampleCandidate.surfaceIndex;
  const sampleSurface = gnd.surfaces[sampleSurfaceIndex];
  const sampleTextureName = sampleCandidate.textureName;
  const sampleTextureUrl = urls.textures[sampleTextureName];
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
  // Retain the raw atlas and the exact sampled UV rectangle so browser-rendered
  // triangles can be compared with the untouched public source texture.
  const sourceArtifactDir = 'artifacts/gnd-source-textures';
  mkdirSync(sourceArtifactDir, { recursive: true });
  writeFileSync(sourceArtifactDir + '/' + mapId + '-source.png', Buffer.from(pngBytes));
  const sourceUvBounds = {
    minU: Math.min(...sampleSurface.uv.map(uv => uv[0])),
    maxU: Math.max(...sampleSurface.uv.map(uv => uv[0])),
    minV: Math.min(...sampleSurface.uv.map(uv => uv[1])),
    maxV: Math.max(...sampleSurface.uv.map(uv => uv[1])),
  };
  const sourcePixelBounds = {
    x0: Math.round(sourceUvBounds.minU * diffuse.width),
    x1: Math.round(sourceUvBounds.maxU * diffuse.width),
    y0: Math.round((1 - sourceUvBounds.maxV) * diffuse.height),
    y1: Math.round((1 - sourceUvBounds.minV) * diffuse.height),
  };
  writeFileSync(
    sourceArtifactDir + '/' + mapId + '-source-uv.txt',
    JSON.stringify({
      mapId,
      textureName: sampleTextureName,
      textureUrl: sampleTextureUrl,
      surfaceIndex: sampleSurfaceIndex,
      imageSize: [diffuse.width, diffuse.height],
      sourceUvBounds,
      sourcePixelBounds,
      surfaceUvs: sampleSurface.uv,
    }, null, 2) + '\n'
  );

  // The Prontera screenshot's suspicious white triangles came from this exact
  // atlas/material region. Save that source tile separately instead of guessing
  // whether the shape is baked into the bitmap or introduced by texture mapping.
  if (mapId === 'prontera') {
    const targetTextureIndex = gnd.textures.findIndex(name =>
      normalizeTextureName(name).endsWith('prt_도시01.bmp'));
    assert.ok(targetTextureIndex >= 0, 'Prontera has the prt_도시01.bmp diagnostic texture');
    const boundsForSurface = surface => ({
      minU: Math.min(...surface.uv.map(uv => uv[0])),
      maxU: Math.max(...surface.uv.map(uv => uv[0])),
      minV: Math.min(...surface.uv.map(uv => uv[1])),
      maxV: Math.max(...surface.uv.map(uv => uv[1])),
    });
    const targetSurfaceIndex = gnd.surfaces.findIndex(surface => {
      if (surface.textureIndex !== targetTextureIndex) return false;
      const bounds = boundsForSurface(surface);
      return Math.abs(bounds.minU - 0.5) < 1e-5
        && Math.abs(bounds.maxU - 0.75) < 1e-5
        && Math.abs(bounds.minV - 0.5) < 1e-5
        && Math.abs(bounds.maxV - 0.75) < 1e-5;
    });
    assert.ok(targetSurfaceIndex >= 0, 'Prontera prt_도시01 has the UV region shown by the browser inspector');
    const targetTextureName = normalizeTextureName(gnd.textures[targetTextureIndex]);
    const targetTextureUrl = urls.textures[targetTextureName];
    assert.ok(targetTextureUrl, 'Prontera diagnostic diffuse URL resolves');
    const targetTextureResponse = await fetchResponse(targetTextureUrl, 'prontera prt_도시01 diagnostic texture');
    const targetTextureBytes = Buffer.from(await targetTextureResponse.arrayBuffer());
    writeFileSync(sourceArtifactDir + '/prontera-prt-city-01-source.png', targetTextureBytes);
    const targetSurface = gnd.surfaces[targetSurfaceIndex];
    writeFileSync(
      sourceArtifactDir + '/prontera-prt-city-01-source-uv.json',
      JSON.stringify({
        mapId,
        textureName: gnd.textures[targetTextureIndex],
        textureUrl: targetTextureUrl,
        surfaceIndex: targetSurfaceIndex,
        imageSize: [diffuse.width, diffuse.height],
        uvBounds: boundsForSurface(targetSurface),
        sourcePixelBounds: {
          x0: Math.round(0.5 * diffuse.width),
          x1: Math.round(0.75 * diffuse.width),
          y0: Math.round((1 - 0.75) * diffuse.height),
          y1: Math.round((1 - 0.5) * diffuse.height),
        },
        surfaceUvs: targetSurface.uv,
      }, null, 2) + '\n'
    );

    const neighboringTextureIndex = gnd.textures.findIndex(name =>
      normalizeTextureName(name).endsWith('prt_도시02.bmp'));
    assert.ok(neighboringTextureIndex >= 0, 'Prontera has the neighboring prt_도시02.bmp texture');
    const neighboringTextureName = normalizeTextureName(gnd.textures[neighboringTextureIndex]);
    const neighboringTextureUrl = urls.textures[neighboringTextureName];
    assert.ok(neighboringTextureUrl, 'Prontera prt_도시02 diffuse URL resolves');
    const neighboringResponse = await fetchResponse(neighboringTextureUrl, 'prontera prt_도시02 diagnostic texture');
    const neighboringBytes = Buffer.from(await neighboringResponse.arrayBuffer());
    const neighboringImage = decodePngPixels(neighboringBytes);
    writeFileSync(sourceArtifactDir + '/prontera-prt-city-02-source.png', neighboringBytes);
    const neighboringUvRegions = new Map();
    for (let surfaceIndex = 0; surfaceIndex < gnd.surfaces.length; surfaceIndex++) {
      const surface = gnd.surfaces[surfaceIndex];
      if (surface.textureIndex !== neighboringTextureIndex) continue;
      const bounds = boundsForSurface(surface);
      const key = [bounds.minU, bounds.maxU, bounds.minV, bounds.maxV]
        .map(value => value.toFixed(5)).join(':');
      if (!neighboringUvRegions.has(key)) {
        neighboringUvRegions.set(key, {
          surfaceIndex,
          uvBounds: bounds,
          surfaceUvs: surface.uv,
        });
      }
    }
    writeFileSync(
      sourceArtifactDir + '/prontera-prt-city-02-source-uv.json',
      JSON.stringify({
        mapId,
        textureName: gnd.textures[neighboringTextureIndex],
        textureUrl: neighboringTextureUrl,
        imageSize: [neighboringImage.width, neighboringImage.height],
        usedUvRegions: [...neighboringUvRegions.values()],
      }, null, 2) + '\n'
    );
  }
  const diffuseX = Math.min(diffuse.width - 1, Math.floor(wrapUv(diffuseUv[0]) * diffuse.width));
  // TextureLoader flips source images into Three.js UV space; V=0 is the PNG bottom row.
  const diffuseY = diffuse.height - 1
    - Math.min(diffuse.height - 1, Math.floor(wrapUv(diffuseUv[1]) * diffuse.height));
  const diffuseRgba = diffuse.pixelAt(diffuseX, diffuseY);

  const sampleSlice = gnd.lightmapSlices[sampleCandidate.lightmapIndex];
  const sampleX = sampleCandidate.sampleX;
  const sampleY = sampleCandidate.sampleY;
  const samplePixelIndex = sampleY * sampleSlice.width + sampleX;
  const aoValue = sampleCandidate.aoValue;
  const rawLightRgb = sampleCandidate.rawLightRgb;
  const posterizedLightRgb = rawLightRgb.map(value => Math.floor(value / 16) * 16);
  const atlasColumn = sampleCandidate.lightmapIndex % lightmapAtlas.columns;
  const atlasRow = Math.floor(sampleCandidate.lightmapIndex / lightmapAtlas.columns);
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
  const sampleLightmapUvs = lightmapAtlas.uvsBySlice[sampleCandidate.lightmapIndex];
  const expectedUvSpan = (sampleSlice.width - 2) / lightmapAtlas.width;
  assert.ok(Math.abs(sampleLightmapUvs[1][0] - sampleLightmapUvs[0][0] - expectedUvSpan) < 1e-12,
    mapId + ' real lightmap UV spans six visible texels between inner borders');

  const sampleCube = gnd.cubes.find(cube => cube.topSurface === sampleSurfaceIndex);
  assert.ok(sampleCube, mapId + ' sample ground surface has a source cube for normal analysis');
  const sw = [0, -sampleCube.hSW * 0.2, 0];
  const se = [2, -sampleCube.hSE * 0.2, 0];
  const nw = [0, -sampleCube.hNW * 0.2, -2];
  const edgeA = se.map((value, index) => value - sw[index]);
  const edgeB = nw.map((value, index) => value - sw[index]);
  let sampleWorldNormal = [
    edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
    edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
    edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
  ];
  if (sampleWorldNormal[1] < 0) sampleWorldNormal = sampleWorldNormal.map(value => -value);
  const sampleNormal = transformGndNormalToRoSpace(sampleWorldNormal);
  const rswDirection = computeGndLightDirection(rsw.light.longitude, rsw.light.latitude);
  const rswMultiplier = computeGndLightMultiplier(
    sampleNormal, rswDirection, rsw.light.ambient, rsw.light.diffuse
  );
  const surfaceColors = Array.isArray(sampleSurface.colors) && sampleSurface.colors.length
    ? sampleSurface.colors : [sampleSurface.color || [1, 1, 1, 1]];
  const vertexColor = [0, 1, 2].map(channel => surfaceColors.reduce(
    (sum, color) => sum + (Number.isFinite(color[channel]) ? color[channel] : 1), 0
  ) / surfaceColors.length);

  mkdirSync('artifacts/gnd-source-textures', { recursive: true });
  writeFileSync(
    'artifacts/gnd-source-textures/' + mapId + '-lightmap-pipeline-audit.json',
    JSON.stringify(lightmapPipelineAudit, null, 2) + '\n'
  );
  console.log(mapId + ' GND raw RGB/AO and GPU UV pipeline audit: ' + JSON.stringify(lightmapPipelineAudit));

  console.log(
    mapId + ' GND vertex-color audit: rendered quads=' + vertexColorAudit.quadCount
      + ', corners=' + vertexColorAudit.cornerSamples
      + ', non-white=' + vertexColorAudit.nonWhiteCorners + ' ('
      + vertexColorAudit.nonWhitePercent.toFixed(2) + '%)'
      + ', unique RGB colors=' + vertexColorAudit.uniqueColors
      + ', mean/min/max RGB=' + JSON.stringify([
        vertexColorAudit.meanRgb, vertexColorAudit.minRgb, vertexColorAudit.maxRgb,
      ])
      + ', shared corner groups=' + vertexColorAudit.sharedCornerGroups
      + ', same-position color comparisons=' + vertexColorAudit.sharedCornerComparisons
      + ', mismatched pairs=' + vertexColorAudit.mismatchPairs + ' ('
      + vertexColorAudit.mismatchPercent.toFixed(2) + '%)'
      + ', largest mismatch=' + vertexColorAudit.maximumMismatchBytes + '/255'
      + (vertexColorAudit.worstExample
        ? ', example=' + JSON.stringify(vertexColorAudit.worstExample) : '')
  );

  console.log(
    mapId + ' GND shared top-edge geometry audit: adjacent textured edges='
      + sharedTopEdgeAudit.adjacentTexturedTopEdges
      + ', continuous=' + sharedTopEdgeAudit.continuousEdges
      + ', height steps=' + sharedTopEdgeAudit.heightStepEdges
      + ', height steps covered by a wall surface=' + sharedTopEdgeAudit.coveredHeightSteps
      + ', uncovered height steps=' + sharedTopEdgeAudit.uncoveredHeightSteps
      + ', microscopic uncovered steps (<=0.02 world units)='
      + sharedTopEdgeAudit.microscopicUncoveredSteps
      + ', uncovered by axis=' + JSON.stringify(sharedTopEdgeAudit.uncoveredByAxis)
      + ', uncovered where adjacent surfaces use same/different texture index='
      + JSON.stringify(sharedTopEdgeAudit.uncoveredByTexture)
      + ', uncovered by map quadrant=' + JSON.stringify(sharedTopEdgeAudit.uncoveredByRegion)
      + ', frequent uncovered texture pairs=' + JSON.stringify(Object.entries(sharedTopEdgeAudit.uncoveredTexturePairs)
        .sort((a, b) => b[1] - a[1]).slice(0, 10))
      + ', same-texture uncovered examples=' + JSON.stringify(sharedTopEdgeAudit.uncoveredSameTextureExamples)
      + ', maximum adjacent edge height delta=' + sharedTopEdgeAudit.maximumHeightDelta.toFixed(5)
      + ', first uncovered examples=' + JSON.stringify(sharedTopEdgeAudit.examples)
      + ', examples by map quadrant=' + JSON.stringify(sharedTopEdgeAudit.examplesByRegion)
  );

  console.log(
    mapId + ' GND pixel trace: diffuse=' + gnd.textures[sampleSurface.textureIndex]
      + ' PNG ' + diffuse.width + '×' + diffuse.height
      + ' UV center ' + JSON.stringify(diffuseUv)
      + ' source RGBA ' + JSON.stringify(diffuseRgba)
      + '; top surface #' + sampleSurfaceIndex + ' lightmap slice ' + sampleCandidate.lightmapIndex
      + ' sample texel (' + sampleX + ',' + sampleY + ') AO=' + aoValue
      + ' RGB raw=' + JSON.stringify(rawLightRgb)
      + ' RGB RO-level16=' + JSON.stringify(posterizedLightRgb)
      + ' atlas UV=' + JSON.stringify(sampleLightmapUvs)
      + ' vertex tint=' + JSON.stringify(vertexColor)
      + ' source-space normal=' + JSON.stringify(sampleNormal)
      + ' RSW angles=' + JSON.stringify([rsw.light.longitude, rsw.light.latitude])
      + ' RSW ambient=' + JSON.stringify(rsw.light.ambient)
      + ' RSW diffuse=' + JSON.stringify(rsw.light.diffuse)
      + ' RSW direction=' + JSON.stringify(rswDirection)
      + ' RSW direction multiplier=' + JSON.stringify(rswMultiplier)
      + ' (official shader: diffuse×RSW multiplier×vertexColor×AO + RGB lightmap)'
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
