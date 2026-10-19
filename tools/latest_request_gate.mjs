/* Monotonic request gate: only the newest asynchronous map load may publish a scene. */
export function createLatestRequestGate() {
  let generation = 0;
  return Object.freeze({
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return Number.isSafeInteger(token) && token === generation;
    },
  });
}
