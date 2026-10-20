import assert from 'node:assert/strict';
import {
  formatRoExplorerGaugeValue,
  formatRoExplorerLevelProgress,
  formatRoExplorerZeny,
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

assert.deepEqual(formatRoExplorerLevelProgress('基礎', 17, 1234, 10000), {
  levelLabel: '基礎 Lv. 17', valueLabel: '1,234 / 10,000', percent: 12, maxed: false,
});
assert.deepEqual(formatRoExplorerLevelProgress('職業', 50, 0, 0), {
  levelLabel: '職業 Lv. 50', valueLabel: 'MAX', percent: 100, maxed: true,
});
assert.equal(formatRoExplorerLevelProgress('基礎', null, null, null).valueLabel, '— / —');
assert.equal(formatRoExplorerZeny(1234567), '鋅幣 1,234,567z');
assert.equal(formatRoExplorerZeny(null), '鋅幣 —');

console.log('原生探索 HUD 測試通過：HP／SP、等級經驗進度、MAX 與鋅幣格式。');
