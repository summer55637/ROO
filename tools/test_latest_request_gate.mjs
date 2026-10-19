import assert from 'node:assert/strict';
import { createLatestRequestGate } from './latest_request_gate.mjs';

const gate = createLatestRequestGate();
const first = gate.begin();
assert.equal(gate.isCurrent(first), true, '目前請求仍有效');

const second = gate.begin();
assert.equal(gate.isCurrent(first), false, '新請求會讓舊請求失效');
assert.equal(gate.isCurrent(second), true, '最新請求維持有效');

const third = gate.begin();
gate.begin();
assert.equal(gate.isCurrent(third), false, '後續載入同樣會淘汰先前請求');
assert.equal(gate.isCurrent(-1), false, '非法請求 token 不可被接受');

console.log('✅ 最新請求閘門：4 項全過');
