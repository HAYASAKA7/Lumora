export function moveRuntimeTab(
  order: readonly string[],
  runtimeId: string,
  destinationIndex: number
): readonly string[] {
  const sourceIndex = order.indexOf(runtimeId);
  if (sourceIndex === -1 || order.length < 2) {
    return order;
  }

  const boundedDestination = Math.max(
    0,
    Math.min(Math.trunc(destinationIndex), order.length - 1)
  );
  if (sourceIndex === boundedDestination) {
    return order;
  }

  const next = [...order];
  next.splice(sourceIndex, 1);
  next.splice(boundedDestination, 0, runtimeId);
  return next;
}
