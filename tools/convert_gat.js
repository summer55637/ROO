#!/usr/bin/env node
'use strict';

/* 將作者授權取得的 RO GAT 檔轉成適合 GitHub Pages 的通行格 JSON。
   GAT 1.2/1.3：14-byte header；每格 20 bytes，地形與水域欄位各 2 bytes。
   座標依 GAT 西南角原點排列；地形 1（障礙）和 5（懸崖）不可走。
*/
const fs = require('fs');
const path = require('path');

function encodeWalkability(values) {
  if (!values.length) throw new Error('通行格不得為空。');
  const runs = [];
  let last = values[0] ? 1 : 0;
  let count = 0;
  for (const value of values) {
    const next = value ? 1 : 0;
    if (next === last) {
      count++;
    } else {
      runs.push(count + ':' + last);
      last = next;
      count = 1;
    }
  }
  runs.push(count + ':' + last);
  return runs.join(',');
}

function parseGatBuffer(buffer, mapId, sourceName) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('輸入必須是 Node.js Buffer。');
  if (buffer.length < 14 || buffer.toString('ascii', 0, 4) !== 'GRAT') {
    throw new Error('不是有效的 RO GAT 檔：找不到 GRAT 標頭。');
  }
  const major = buffer.readUInt8(4);
  const minor = buffer.readUInt8(5);
  if (major !== 1 || (minor !== 2 && minor !== 3)) {
    throw new Error('目前只支援 GAT 1.2／1.3；收到 ' + major + '.' + minor + '。');
  }

  const width = buffer.readUInt32LE(6);
  const height = buffer.readUInt32LE(10);
  const cellCount = width * height;
  if (!width || !height || width > 8192 || height > 8192
    || !Number.isSafeInteger(cellCount) || cellCount > 16000000) {
    throw new Error('GAT 地圖尺寸無效或過大。');
  }
  const expectedBytes = 14 + cellCount * 20;
  if (buffer.length !== expectedBytes) {
    throw new Error('GAT 長度不符：預期 ' + expectedBytes + ' bytes，收到 ' + buffer.length + '。');
  }

  const walkable = new Array(cellCount);
  const terrainCounts = {};
  let walkableCount = 0;
  let waterCount = 0;
  for (let i = 0; i < cellCount; i++) {
    const tileOffset = 14 + i * 20;
    const terrainType = buffer.readUInt16LE(tileOffset + 16);
    const waterFlag = buffer.readUInt16LE(tileOffset + 18);
    // 與 rAthena map_gat2cell() 一致；未知旗標採保守阻擋。
    const isWalkable = terrainType === 0 || terrainType === 2
      || terrainType === 3 || terrainType === 4 || terrainType === 6;
    walkable[i] = isWalkable ? 1 : 0;
    terrainCounts[terrainType] = (terrainCounts[terrainType] || 0) + 1;
    if (isWalkable) walkableCount++;
    if (waterFlag !== 0) waterCount++;
  }

  return {
    format: 'roo-walkmap-v1',
    mapId: String(mapId || '').toLowerCase(),
    sourceFile: String(sourceName || ''),
    sourceFormat: major + '.' + minor,
    width,
    height,
    coordinateOrigin: 'south-west',
    cellOrder: 'row-major-south-to-north',
    walkableCount,
    blockedCount: cellCount - walkableCount,
    waterFlagCount: waterCount,
    terrainCounts,
    walkableRle: encodeWalkability(walkable),
  };
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function mapIdFromGatPath(filePath) {
  const mapId = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (!/^[a-z0-9_@-]{1,64}$/.test(mapId)) {
    throw new Error('地圖檔名不是有效的地圖 ID：' + path.basename(filePath));
  }
  return mapId;
}

function writeWalkMap(inputPath, outputPath, mapId) {
  if (!/^[a-z0-9_@-]{1,64}$/i.test(mapId)) throw new Error('地圖 ID 格式無效。');
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);
  const result = parseGatBuffer(fs.readFileSync(resolvedInput), mapId, path.basename(resolvedInput));
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return { result, outputPath: resolvedOutput };
}

function logConverted(mapId, result, outputPath) {
  console.log('已轉換 ' + mapId + '：' + result.width + '×' + result.height
    + ' 格，可走 ' + result.walkableCount + '、阻擋 ' + result.blockedCount + '。');
  console.log('輸出：' + outputPath);
}

function printUsage() {
  console.log('單張：node tools/convert_gat.js --input <map.gat> --out <map.walk.json> [--map <mapId>]');
  console.log('批次：node tools/convert_gat.js --input-dir <GAT資料夾> --out-dir <輸出資料夾>');
}

function main() {
  const input = getArg('--input');
  const output = getArg('--out');
  const inputDir = getArg('--input-dir');
  const outputDir = getArg('--out-dir');

  if (process.argv.includes('--help')) {
    printUsage();
    return;
  }

  const singleMode = !!input && !!output && !inputDir && !outputDir;
  const batchMode = !!inputDir && !!outputDir && !input && !output;
  if (!singleMode && !batchMode) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  if (singleMode) {
    const resolvedInput = path.resolve(input);
    const mapId = getArg('--map') || path.basename(resolvedInput, path.extname(resolvedInput));
    const written = writeWalkMap(resolvedInput, output, mapId.toLowerCase());
    logConverted(written.result.mapId, written.result, written.outputPath);
    return;
  }

  if (getArg('--map')) {
    throw new Error('批次模式會使用每個 .gat 檔名作為地圖 ID，不能指定 --map。');
  }

  const resolvedInputDir = path.resolve(inputDir);
  const resolvedOutputDir = path.resolve(outputDir);
  if (!fs.statSync(resolvedInputDir).isDirectory()) {
    throw new Error('輸入路徑不是資料夾：' + resolvedInputDir);
  }

  const entries = fs.readdirSync(resolvedInputDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.gat$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) throw new Error('輸入資料夾找不到 .gat 檔：' + resolvedInputDir);

  fs.mkdirSync(resolvedOutputDir, { recursive: true });
  const seen = new Set();
  const failures = [];
  let converted = 0;

  for (const entry of entries) {
    const inputPath = path.join(resolvedInputDir, entry.name);
    try {
      const mapId = mapIdFromGatPath(inputPath);
      if (seen.has(mapId)) throw new Error('重複的地圖 ID：' + mapId);
      seen.add(mapId);
      const written = writeWalkMap(inputPath, path.join(resolvedOutputDir, mapId + '.walk.json'), mapId);
      logConverted(mapId, written.result, written.outputPath);
      converted++;
    } catch (error) {
      failures.push(entry.name + '：' + error.message);
    }
  }

  console.log('批次轉換完成：' + converted + ' 成功、' + failures.length + ' 失敗。');
  if (failures.length) {
    throw new Error('以下檔案轉換失敗：\n' + failures.join('\n'));
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('GAT 轉換失敗：' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { encodeWalkability, parseGatBuffer };
