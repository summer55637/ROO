export const RO_EXPLORER_MONSTER_RESPAWN_MS = 8000;

function validCell(cell) {
  return !!cell && Number.isInteger(cell.x) && Number.isInteger(cell.y);
}

export function scheduleRoExplorerMonsterRespawn(entry, now, delayMs = RO_EXPLORER_MONSTER_RESPAWN_MS) {
  if (!entry || typeof entry !== 'object' || !Number.isFinite(now)
    || !Number.isFinite(delayMs) || delayMs < 0) return false;
  entry.dead = true;
  entry.respawnAt = now + Math.floor(delayMs);
  return true;
}

export function reviveRoExplorerMonster(entry, now) {
  if (!entry || typeof entry !== 'object' || !entry.dead
    || !Number.isFinite(entry.respawnAt) || !Number.isFinite(now) || now < entry.respawnAt) return false;
  const maxHp = Number.isFinite(entry.maxHp) && entry.maxHp > 0
    ? entry.maxHp : Number(entry.monster && entry.monster.hp);
  if (!Number.isFinite(maxHp) || maxHp < 1) return false;
  const baseKey = typeof entry.spawnBaseKey === 'string' && /^[a-z0-9_-]{1,20}$/i.test(entry.spawnBaseKey)
    ? entry.spawnBaseKey : String(entry.spawnKey || 'm0').replace(/-r\d+$/i, '');
  const previousCount = Number.isInteger(entry.respawnCount) && entry.respawnCount >= 0
    ? entry.respawnCount : 0;
  entry.spawnBaseKey = baseKey;
  entry.respawnCount = previousCount + 1;
  entry.spawnKey = baseKey + '-r' + entry.respawnCount;
  entry.maxHp = maxHp;
  entry.currentHp = maxHp;
  entry.dead = false;
  entry.respawnAt = 0;
  entry.statusLabels = [];
  entry.nextStatusTickAt = 0;
  return true;
}

export function findRoExplorerMonsterRespawnCell(gat, playerCell, originCell, occupiedCells = [], maxRadius = 12) {
  if (!gat || !Number.isInteger(gat.width) || gat.width < 1
    || !Number.isInteger(gat.height) || gat.height < 1
    || gat.width * gat.height > 4000000
    || !gat.walkable || gat.walkable.length !== gat.width * gat.height
    || !validCell(originCell)) return null;
  const radiusLimit = Number.isFinite(maxRadius) ? Math.max(0, Math.min(64, Math.floor(maxRadius))) : 12;
  const hasPlayerCell = validCell(playerCell);
  const occupied = Array.isArray(occupiedCells) ? occupiedCells.filter(validCell) : [];
  const cellFree = (x, y) => {
    if (x < 0 || y < 0 || x >= gat.width || y >= gat.height) return false;
    const index = y * gat.width + x;
    if (!gat.walkable[index] || (gat.water && gat.water[index])) return false;
    if (hasPlayerCell && Math.hypot(x - playerCell.x, y - playerCell.y) < 3) return false;
    if (occupied.some(cell => Math.hypot(x - cell.x, y - cell.y) < 2.5)) return false;
    return true;
  };
  for (let radius = 0; radius <= radiusLimit; radius++) {
    for (let y = originCell.y - radius; y <= originCell.y + radius; y++) {
      for (let x = originCell.x - radius; x <= originCell.x + radius; x++) {
        if (Math.max(Math.abs(x - originCell.x), Math.abs(y - originCell.y)) !== radius) continue;
        if (cellFree(x, y)) return { x, y };
      }
    }
  }
  return null;
}
