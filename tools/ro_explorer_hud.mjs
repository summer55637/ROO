export function getRoExplorerGaugePercent(current, maximum) {
  const value = Number(current);
  const max = Math.floor(Number(maximum));
  if (current === null || current === undefined || current === ''
    || !Number.isFinite(value) || !Number.isFinite(max) || max < 1) return 0;
  return Math.round(Math.min(max, Math.max(0, value)) / max * 100);
}

export function formatRoExplorerGaugeValue(current, maximum) {
  const value = Number(current);
  const max = Math.floor(Number(maximum));
  if (current === null || current === undefined || current === ''
    || !Number.isFinite(value) || !Number.isFinite(max) || max < 1) return '— / —';
  const clamped = Math.floor(Math.min(max, Math.max(0, value)));
  return clamped.toLocaleString('en-US') + ' / ' + max.toLocaleString('en-US');
}

export function formatRoExplorerLevelProgress(label, level, current, needed) {
  const kind = String(label || '等級').slice(0, 24);
  const numericLevel = Number(level);
  const hasLevel = level !== null && level !== undefined && level !== ''
    && Number.isFinite(numericLevel) && numericLevel >= 1;
  const levelLabel = hasLevel ? `${kind} Lv. ${Math.floor(numericLevel)}` : `${kind} Lv. —`;
  const unknown = { levelLabel, valueLabel: '— / —', percent: 0, maxed: false };
  if (!hasLevel || needed === null || needed === undefined || needed === '') return unknown;
  const max = Number(needed);
  if (!Number.isFinite(max)) return unknown;
  if (max <= 0) return { levelLabel, valueLabel: 'MAX', percent: 100, maxed: true };
  return {
    levelLabel,
    valueLabel: formatRoExplorerGaugeValue(current, max),
    percent: getRoExplorerGaugePercent(current, max),
    maxed: false,
  };
}

export function formatRoExplorerZeny(value) {
  const amount = Number(value);
  if (value === null || value === undefined || value === ''
    || !Number.isFinite(amount) || amount < 0) return '鋅幣 —';
  return '鋅幣 ' + Math.floor(amount).toLocaleString('en-US') + 'z';
}
