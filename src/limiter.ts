import { Condition } from "./condition";
import { Semaphore } from "./semaphore";

export class ConcurrencyLimiter {
  private readonly semaphore: Semaphore;
  private outstandingMutable: number = 0;
  private outstandingCV = new Condition();

  public constructor(public readonly limit: number) {
    this.semaphore = new Semaphore(limit);
  }

  public get outstanding(): number {
    return this.outstandingMutable;
  }

  public async run<T>(
    operation: () => Promise<T>,
    onError?: (e: unknown) => void
  ): Promise<void> {
    this.outstandingMutable++;
    const handle = await this.semaphore.acquire();
    const doRun = async () => {
      try {
        await operation();
      } catch (e: unknown) {
        if (onError !== undefined) {
          onError(e);
        } else {
          throw e;
        }
      } finally {
        const remaining = --this.outstandingMutable;
        this.semaphore.release(handle);
        if (remaining <= 0) {
          this.outstandingCV.notifyAll();
        }
      }
    };
    void doRun();
  }

  public async wait(): Promise<void> {
    while (this.outstandingMutable > 0) {
      await this.outstandingCV.wait();
    }
  }
}
