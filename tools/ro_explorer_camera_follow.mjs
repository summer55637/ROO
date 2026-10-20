export function getRoExplorerCameraFollowDelta(previousPosition, currentPosition) {
  const isPoint = point => point && ['x', 'y', 'z'].every(key => Number.isFinite(point[key]));
  if (!isPoint(previousPosition) || !isPoint(currentPosition)) return null;
  const delta = {
    x: currentPosition.x - previousPosition.x,
    y: currentPosition.y - previousPosition.y,
    z: currentPosition.z - previousPosition.z,
  };
  return ['x', 'y', 'z'].every(key => Number.isFinite(delta[key])) ? delta : null;
}
