import assert from 'node:assert/strict';
import { createVisibilityAwareFrameLoop } from './visibility_frame_loop.mjs';

function makeDocument(initiallyHidden = false) {
  const listeners = new Map();
  return {
    hidden: initiallyHidden,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    emit(type) {
      for (const callback of listeners.get(type) || []) callback();
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function makeScheduler() {
  let nextHandle = 1;
  const pending = new Map();
  return {
    pending,
    requestFrame(callback) {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame(handle) {
      pending.delete(handle);
    },
    fire(now) {
      const next = pending.entries().next().value;
      assert.ok(next, '預期有待執行的影格');
      pending.delete(next[0]);
      next[1](now);
    },
  };
}

const documentRef = makeDocument();
const scheduler = makeScheduler();
const timestamps = [];
const stop = createVisibilityAwareFrameLoop(
  documentRef,
  now => timestamps.push(now),
  callback => scheduler.requestFrame(callback),
  handle => scheduler.cancelFrame(handle)
);

assert.equal(scheduler.pending.size, 1);
scheduler.fire(16);
assert.deepEqual(timestamps, [16]);
assert.equal(scheduler.pending.size, 1);

documentRef.hidden = true;
documentRef.emit('visibilitychange');
assert.equal(scheduler.pending.size, 0, '背景分頁應取消待執行影格');
documentRef.hidden = false;
documentRef.emit('visibilitychange');
assert.equal(scheduler.pending.size, 1, '返回前景應重新排程');
scheduler.fire(2000);
assert.deepEqual(timestamps, [16, 2000]);

stop();
stop();
assert.equal(scheduler.pending.size, 0, '停止時不應留下影格');
assert.equal(documentRef.listenerCount('visibilitychange'), 0, '停止時應移除事件監聽');
documentRef.emit('visibilitychange');
assert.equal(scheduler.pending.size, 0, '停止後切換分頁不應重新啟動');

const hiddenDocument = makeDocument(true);
const hiddenScheduler = makeScheduler();
let hiddenCalls = 0;
const stopHidden = createVisibilityAwareFrameLoop(
  hiddenDocument,
  () => hiddenCalls++,
  callback => hiddenScheduler.requestFrame(callback),
  handle => hiddenScheduler.cancelFrame(handle)
);
assert.equal(hiddenScheduler.pending.size, 0, '初始為背景時不應排程影格');
hiddenDocument.hidden = false;
hiddenDocument.emit('visibilitychange');
assert.equal(hiddenScheduler.pending.size, 1);
hiddenScheduler.fire(42);
assert.equal(hiddenCalls, 1);
stopHidden();

console.log('3D 探索渲染迴圈的背景暫停、恢復與清理測試通過');
