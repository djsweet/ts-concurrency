export function monotonicNow(): number {
  if (typeof performance === "object") {
    return performance.now();
  }
  // We don't have a 'performance' object so
  // we have to fallback to Date.
  return Date.now();
}
