export async function sleep(
  sleepTime: number,
  signal?: AbortSignal
): Promise<boolean> {
  if (signal?.aborted === true) return false;
  return new Promise((resolve) => {
    let successTimeout: NodeJS.Timeout | undefined = undefined;
    let resolved = false;
    const cleanupOnSignal = () => {
      if (successTimeout !== undefined) {
        clearTimeout(successTimeout);
        successTimeout = undefined;
      }
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    };

    signal?.addEventListener("abort", cleanupOnSignal, { once: true });
    successTimeout = setTimeout(() => {
      signal?.removeEventListener("abort", cleanupOnSignal);
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    }, sleepTime);
  });
}
