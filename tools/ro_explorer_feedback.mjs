const FEEDBACK_ACTIONS = new Set(['attack', 'skill', 'dot']);

export function buildRoExplorerCombatFeedback(damageValue, action = 'attack') {
  if (damageValue === null || damageValue === undefined || damageValue === '') return null;
  const damage = Number(damageValue);
  if (!Number.isFinite(damage) || damage < 0) return null;

  const wholeDamage = Math.floor(damage);
  if (wholeDamage === 0) return { text: 'MISS', kind: 'miss', durationMs: 720 };

  const kind = FEEDBACK_ACTIONS.has(action) ? action : 'attack';
  return {
    text: wholeDamage.toLocaleString('en-US'),
    kind,
    durationMs: kind === 'skill' ? 1000 : (kind === 'dot' ? 900 : 820),
  };
}
