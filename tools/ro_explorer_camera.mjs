function vectorValues(value) {
  if (Array.isArray(value)) {
    if (value.length !== 3) return null;
    const values = value.map(Number);
    return values.every(Number.isFinite) ? values : null;
  }
  if (!value || typeof value !== 'object') return null;
  const values = [Number(value.x), Number(value.y), Number(value.z)];
  return values.every(Number.isFinite) ? values : null;
}

function validNormalizedVector(values) {
  return values && values.every(value => Number.isFinite(value) && Math.abs(value) <= 100);
}

function cameraDistance(position, target) {
  return Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2]
  );
}

export function buildRoExplorerCameraSnapshot(position, target, maxDimension) {
  const scale = Number(maxDimension);
  const positionValues = vectorValues(position);
  const targetValues = vectorValues(target);
  if (!Number.isFinite(scale) || scale <= 0 || !positionValues || !targetValues) return null;

  const normalizedPosition = positionValues.map(value => value / scale);
  const normalizedTarget = targetValues.map(value => value / scale);
  if (!validNormalizedVector(normalizedPosition) || !validNormalizedVector(normalizedTarget)) return null;
  const distance = cameraDistance(normalizedPosition, normalizedTarget);
  if (!Number.isFinite(distance) || distance < 0.009 || distance > 21) return null;

  return {
    version: 1,
    position: normalizedPosition.map(value => Number(value.toFixed(6))),
    target: normalizedTarget.map(value => Number(value.toFixed(6))),
  };
}

export function resolveRoExplorerCameraSnapshot(snapshot, maxDimension) {
  const scale = Number(maxDimension);
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1
    || !Number.isFinite(scale) || scale <= 0) return null;

  const position = vectorValues(snapshot.position);
  const target = vectorValues(snapshot.target);
  if (!validNormalizedVector(position) || !validNormalizedVector(target)) return null;
  const distance = cameraDistance(position, target);
  if (!Number.isFinite(distance) || distance < 0.009 || distance > 21) return null;

  return {
    position: { x: position[0] * scale, y: position[1] * scale, z: position[2] * scale },
    target: { x: target[0] * scale, y: target[1] * scale, z: target[2] * scale },
  };
}
