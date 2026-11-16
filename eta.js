export function calculateEta(currentStop, endStop) {
  if (!currentStop || !endStop) return 0;
  return Math.max(1, Math.round(Math.abs(endStop.stdMin - currentStop.stdMin)));
}
