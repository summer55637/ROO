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
