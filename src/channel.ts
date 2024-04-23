import { Condition } from "./condition";

export class ChannelClosedException extends Error {}
export class ReadCancelledException extends Error {}
export class WriteCancelledException extends Error {}

export class Channel<T> {
  private readSerial = Number.MIN_SAFE_INTEGER;
  private writeSerial = Number.MIN_SAFE_INTEGER;

  private readCV = new Condition();
  private writeReadCV = new Condition();
  private writeWriteCV = new Condition();

  private valueInTransit = false;
  private closed = false;
  private value: T | undefined;

  public get isClosed(): boolean {
    return this.closed;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readCV.notifyAll();
    this.writeReadCV.notifyAll();
    this.writeWriteCV.notifyAll();
  }

  public async write(value: T, signal?: AbortSignal): Promise<void> {
    while (this.valueInTransit && !this.closed) {
      const fromNotify = await this.writeWriteCV.wait(signal);
      // fromNotify === false means that we have been cancelled according to
      // the signal.
      if (!fromNotify) throw new WriteCancelledException();
    }
    if (this.closed) throw new ChannelClosedException();

    this.valueInTransit = true;
    this.value = value;
    const nextReadSerial = ++this.writeSerial;
    this.readCV.notifyOne();

    let fromNotify = true;
    while (this.readSerial < nextReadSerial && !this.closed && fromNotify) {
      fromNotify = await this.writeReadCV.wait(signal);
    }

    if (!fromNotify) {
      // If we're cancelling the write, no reader showed up, so we have to
      // nudge the read serial upwards so that future reads function correctly.
      this.readSerial++;
    }

    // By this point, the reader has read the value.
    // We should signal another writer that it can write.
    this.value = undefined; // Don't hold on to the value so that we can GC it
    this.valueInTransit = false;
    this.writeWriteCV.notifyOne();

    if (!fromNotify) throw new WriteCancelledException();
    if (this.closed) throw new ChannelClosedException();
  }

  public async read(signal?: AbortSignal): Promise<T> {
    while (
      // If readSerial === writeSerial, we have to wait for a writer
      // to give us a value. We'll say >= just to be safe.
      this.readSerial >= this.writeSerial &&
      !this.closed
    ) {
      const fromNotify = await this.readCV.wait(signal);
      // fromNotify === false means that we have been cancelled according to
      // the signal.
      if (!fromNotify) throw new ReadCancelledException();
    }

    if (this.closed) throw new ChannelClosedException();

    const result = this.value!;
    this.readSerial++;
    this.writeReadCV.notifyOne();
    return result;
  }
}
