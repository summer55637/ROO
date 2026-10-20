import assert from 'node:assert/strict';
import {
  formatRoExplorerGaugeValue,
  getRoExplorerGaugePercent,
} from './ro_explorer_hud.mjs';

assert.equal(getRoExplorerGaugePercent(50, 100), 50);
assert.equal(getRoExplorerGaugePercent(0, 100), 0);
assert.equal(getRoExplorerGaugePercent(-10, 100), 0);
assert.equal(getRoExplorerGaugePercent(150, 100), 100);
assert.equal(getRoExplorerGaugePercent(75.8, 100), 76);
assert.equal(getRoExplorerGaugePercent(20, 0), 0);
assert.equal(getRoExplorerGaugePercent(NaN, 100), 0);
assert.equal(formatRoExplorerGaugeValue(1234, 10000), '1,234 / 10,000');
assert.equal(formatRoExplorerGaugeValue(-10, 100), '0 / 100');
assert.equal(formatRoExplorerGaugeValue(150, 100), '100 / 100');
assert.equal(formatRoExplorerGaugeValue(null, 100), '— / —');
assert.equal(formatRoExplorerGaugeValue(10, NaN), '— / —');

console.log('原生探索 HP／SP 狀態條測試通過：百分比限制、異常值與格式化。');
