import { sleep } from "./sleep";
import { monotonicNow } from "./time";

export class QuotaGovernor {
  private waitPeriodMS: number;
  public constructor(public readonly ratePerSecond: number) {
    this.waitPeriodMS = 1000 / ratePerSecond;
  }

  private lastTime: number | undefined;
  private outstandingMutable: number = 0;

  public get outstanding(): number {
    return this.outstandingMutable;
  }

  public async wait(signal?: AbortSignal): Promise<boolean> {
    const prior = this.outstandingMutable++;
    const deltaFromLastTime =
      this.lastTime === undefined
        ? Number.MAX_SAFE_INTEGER
        : monotonicNow() - this.lastTime;
    const waitAfterPeriod = Math.max(this.waitPeriodMS - deltaFromLastTime, 0);
    try {
      return await sleep(waitAfterPeriod + this.waitPeriodMS * prior, signal);
    } finally {
      this.lastTime = monotonicNow();
      this.outstandingMutable--;
    }
  }
}
