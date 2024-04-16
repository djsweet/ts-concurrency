import { Condition } from "./condition";

export class Semaphore {
  private handles: Set<number> = new Set();
  private nextHandle = 0;
  private slotCV = new Condition();

  public constructor(private slots: number = 1) {}

  public get waiting(): number {
    return this.slotCV.waiting;
  }

  public async acquire(signal?: AbortSignal): Promise<number | undefined> {
    while (this.slots < 1) {
      const didWait = await this.slotCV.wait(signal);
      if (!didWait) return undefined;
    }

    this.slots--;
    const resultHandle = this.nextHandle++;
    this.handles.add(resultHandle);
    return resultHandle;
  }

  public release(handle: number | undefined): void {
    if (handle === undefined) return;
    if (!this.handles.has(handle)) return;
    this.handles.delete(handle);
    this.slots++;
    this.slotCV.notifyOne();
  }

  public async withSlot<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<{ status: "acquired"; result: T } | { status: "aborted" }> {
    let handle: number | undefined = undefined;
    try {
      handle = await this.acquire(signal);
      if (!handle) return { status: "aborted" };

      const result = await fn();
      return { status: "acquired", result };
    } finally {
      this.release(handle);
    }
  }
}
