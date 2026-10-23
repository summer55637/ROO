const MAX_MONSTER_TYPES = 8;
const MAX_MAP_CELLS = 4000000;
function positiveInt(value) { return Number.isInteger(value) && value > 0; }
export function parseRoExplorerMonsterCatalog(serialized, maxTypes = MAX_MONSTER_TYPES) {
  if (typeof serialized !== 'string' || serialized.length > 16000) return [];
  let rows;
  try { rows = JSON.parse(serialized); } catch (error) { return []; }
  if (!Array.isArray(rows) || !positiveInt(maxTypes)) return [];
  const byId = new Map();
  for (const row of rows.slice(0, 64)) {
    if (!row || typeof row.id !== 'string' || !/^[a-z0-9_]{1,64}$/i.test(row.id)
      || !Number.isInteger(row.imageId) || row.imageId < 1 || row.imageId > 100000
      || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 80
      || !Number.isInteger(row.level) || row.level < 1 || row.level > 999
      || !Number.isFinite(row.hp) || row.hp < 1 || row.hp > 1e12
      || !Number.isFinite(row.atk) || row.atk < 0 || row.atk > 1e9
      || !Number.isFinite(row.weight) || row.weight <= 0 || row.weight > 1e9) continue;
    if (byId.has(row.id)) continue;
    byId.set(row.id, {
      id: row.id, imageId: row.imageId, name: row.name.trim(),
      icon: typeof row.icon === 'string' ? row.icon.slice(0, 8) : '',
      level: row.level, hp: row.hp, atk: row.atk, weight: row.weight,
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))
    .slice(0, Math.min(MAX_MONSTER_TYPES, maxTypes));
}
function seededRandom(seedText) {
  let seed = 2166136261;
  const text = String(seedText || 'ro-map');
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  seed >>>= 0;
  if (!seed) seed = 1;
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}
function chooseWeightedMonster(catalog, random) {
  let total = 0;
  for (const monster of catalog) total += monster.weight;
  if (!(total > 0) || !Number.isFinite(total)) return catalog[0] || null;
  let cursor = random() * total;
  for (const monster of catalog) { cursor -= monster.weight; if (cursor < 0) return monster; }
  return catalog[catalog.length - 1] || null;
}
export function buildRoExplorerMonsterSpawns(gat, catalog, playerCell, mapId, options = {}) {
  if (!gat || !positiveInt(gat.width) || !positiveInt(gat.height)
    || gat.width * gat.height > MAX_MAP_CELLS
    || !gat.walkable || gat.walkable.length !== gat.width * gat.height
    || !Array.isArray(catalog) || !catalog.length) return [];
  const countValue = Number(options.maxCount);
  const maxCount = Number.isFinite(countValue) ? Math.max(1, Math.min(12, Math.floor(countValue))) : 8;
  const minDimension = Math.min(gat.width, gat.height);
  const minDistance = Math.min(8, Math.max(1, minDimension * 0.2));
  const minSpacing = Math.min(6, Math.max(1, minDimension * 0.12));
  const radiusValue = Number(options.searchRadius);
  const searchRadius = Number.isFinite(radiusValue)
    ? Math.max(Math.ceil(minDistance), Math.min(64, Math.floor(radiusValue)))
    // Real 200×200 RO maps show only a limited number of GAT cells on a phone.
    // Keep the default spawn cluster close enough to stay discoverable in Canvas 2D;
    // callers may still pass an explicit wider searchRadius for other scenarios.
    : 12;
  const centerX = playerCell && Number.isInteger(playerCell.x)
    ? Math.max(0, Math.min(gat.width - 1, playerCell.x)) : Math.floor(gat.width / 2);
  const centerY = playerCell && Number.isInteger(playerCell.y)
    ? Math.max(0, Math.min(gat.height - 1, playerCell.y)) : Math.floor(gat.height / 2);
  // The small exploration cap is meant to show nearby threats, not scatter all eight
  // monsters across a large map where the player cannot see or click any of them.
  const minX = Math.max(0, centerX - searchRadius);
  const maxX = Math.min(gat.width - 1, centerX + searchRadius);
  const minY = Math.max(0, centerY - searchRadius);
  const maxY = Math.min(gat.height - 1, centerY + searchRadius);
  const perSpawnValue = Number(options.attemptsPerSpawn);
  const perSpawn = Number.isFinite(perSpawnValue) ? Math.max(1, Math.min(500, Math.floor(perSpawnValue))) : 300;
  const random = seededRandom(String(mapId || 'ro-map') + ':' + gat.width + 'x' + gat.height);
  const spawns = [];
  const attempts = Math.min(5000, maxCount * perSpawn);
  for (let attempt = 0; attempt < attempts && spawns.length < maxCount; attempt++) {
    const x = minX + Math.floor(random() * (maxX - minX + 1));
    const y = minY + Math.floor(random() * (maxY - minY + 1));
    const index = y * gat.width + x;
    if (!gat.walkable[index] || (gat.water && gat.water[index])) continue;
    if (playerCell && Number.isInteger(playerCell.x) && Number.isInteger(playerCell.y)
      && Math.hypot(x - playerCell.x, y - playerCell.y) < minDistance) continue;
    if (spawns.some(spawn => Math.hypot(x - spawn.cell.x, y - spawn.cell.y) < minSpacing)) continue;
    const monster = chooseWeightedMonster(catalog, random);
    if (!monster) break;
    spawns.push({ spawnId: String(mapId || 'map') + ':' + spawns.length + ':' + monster.id, monster, cell: { x, y } });
  }
  return spawns;
}
export function roExplorerMonsterAnimationUrl(imageId, baseUrl = 'https://assets.latam-tools.com.br') {
  if (!Number.isInteger(imageId) || imageId < 1 || imageId > 100000) return '';
  try {
    const url = new URL('/image', baseUrl);
    url.searchParams.set('job', String(imageId));
    url.searchParams.set('action', '0');
    return url.href;
  } catch (error) { return ''; }
}
