/**
 * Run one animation frame at a time while the document is visible.
 * The injected scheduler keeps this browser lifecycle behavior testable in Node.
 */
export function createVisibilityAwareFrameLoop(documentRef, onFrame, requestFrame, cancelFrame) {
  if (!documentRef || typeof documentRef.addEventListener !== 'function'
    || typeof documentRef.removeEventListener !== 'function') {
    throw new TypeError('必須提供支援事件監聽的 document。');
  }
  if (typeof onFrame !== 'function' || typeof requestFrame !== 'function'
    || typeof cancelFrame !== 'function') {
    throw new TypeError('動畫回呼與影格排程函式必須有效。');
  }

  let frameHandle = null;
  let stopped = false;

  function schedule() {
    if (stopped || documentRef.hidden || frameHandle !== null) return;
    frameHandle = requestFrame(tick);
  }

  function tick(now) {
    frameHandle = null;
    if (stopped || documentRef.hidden) return;
    try {
      onFrame(now);
    } finally {
      schedule();
    }
  }

  function handleVisibilityChange() {
    if (documentRef.hidden) {
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      return;
    }
    schedule();
  }

  documentRef.addEventListener('visibilitychange', handleVisibilityChange);
  schedule();

  return function stop() {
    if (stopped) return;
    stopped = true;
    documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
  };
}
