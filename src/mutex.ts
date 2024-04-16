import { Condition } from "./condition";

/**
 * A simple non-reentrant Mutex object to demonstrate parallelism internals
 */
export class Mutex {
  private locked = false;
  private lockHandle = 0;
  private lockCV = new Condition();

  public async acquire(signal?: AbortSignal): Promise<number | undefined> {
    while (this.locked) {
      const didWait = await this.lockCV.wait(signal);
      if (!didWait) return undefined;
    }

    this.locked = true;
    return ++this.lockHandle;
  }

  public release(handle: number | undefined): void {
    if (handle === undefined) return;
    if (!this.locked) return;
    if (this.lockHandle !== handle) return;
    this.locked = false;
    this.lockCV.notifyOne();
  }

  public async withLock<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<{ status: "acquired"; result: T } | { status: "aborted" }> {
    let lockHandle: number | undefined = undefined;
    try {
      lockHandle = await this.acquire(signal);
      if (lockHandle === undefined) return { status: "aborted" };

      const result = await fn();
      return { status: "acquired", result };
    } finally {
      this.release(lockHandle);
    }
  }
}
