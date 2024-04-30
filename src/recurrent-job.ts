import { Condition } from "./condition";

enum RecurrentJobState {
  Inert,
  InProgress,
  Again,
}

export class RecurrentJob {
  public constructor(
    private readonly operation: () => Promise<void>,
    private readonly onError?: (e: unknown) => void
  ) {}

  private state: RecurrentJobState = RecurrentJobState.Inert;
  private doingPromise: Promise<void> | undefined;
  private workCV = new Condition();

  private async doOperation(): Promise<void> {
    try {
      await this.operation();
    } catch (e: unknown) {
      if (this.onError !== undefined) {
        this.onError(e);
      } else {
        throw e;
      }
    } finally {
      if (this.state !== RecurrentJobState.Again) {
        this.doingPromise = undefined;
      }
      if (this.state === RecurrentJobState.InProgress) {
        this.state = RecurrentJobState.Inert;
        this.workCV.notifyAll();
      } else if (this.state === RecurrentJobState.Again) {
        this.state = RecurrentJobState.InProgress;
        // We're about to possibly throw an exception,
        // so if we're going again we can't do it in a loop here.
        // Instead we have to set up an entire new Promise lifecycle.
        this.doingPromise = this.doOperation();
      }
    }
  }

  public request(): void {
    switch (this.state) {
      case RecurrentJobState.Inert:
        this.state = RecurrentJobState.InProgress;
        break;
      case RecurrentJobState.InProgress:
        this.state = RecurrentJobState.Again;
        break;
    }
    if (this.doingPromise === undefined) {
      this.doingPromise = this.doOperation();
    }
  }

  public async wait(): Promise<void> {
    while (this.state !== RecurrentJobState.Inert) {
      await this.workCV.wait();
    }
  }
}
