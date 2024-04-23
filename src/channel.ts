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

  public async *iterate(signal?: AbortSignal): AsyncIterableIterator<T> {
    while (signal?.aborted !== true && !this.closed) {
      try {
        const nextValue = await this.read(signal);
        yield nextValue;
      } catch (e: unknown) {
        if (e instanceof ReadCancelledException) break;
        if (e instanceof ChannelClosedException) break;
        throw e;
      }
    }
  }

  private static async selectInternal(
    options: [Channel<unknown>, handler: (x: unknown) => Promise<void>][],
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) return;

    const controller = new AbortController();
    const abortOnExternalSignal = () => controller.abort();
    signal?.addEventListener("abort", abortOnExternalSignal, { once: true });

    try {
      const channelReads = options.map(([channel], i) =>
        channel
          .read(controller.signal)
          .catch((x: unknown) => {
            // We ignore ReadCancelledException here.
            if (!(x instanceof ReadCancelledException)) throw x;
          })
          .then((value) => {
            controller.abort(); // Cancel as many of the other reads as we can
            // However, we might still read from all channels before cancellation,
            // so we should attempt to execute the handler here instead.
            return options[i][1](value);
          })
      );
      await Promise.race(channelReads);
    } finally {
      signal?.removeEventListener("abort", abortOnExternalSignal);
    }
  }

  // This simulates Go's select statement for up to five channels
  public static async select<T1, T2>(
    channel1: Channel<T1>,
    handler1: (value: T1) => Promise<void>,
    channel2: Channel<T2>,
    handler2: (value: T2) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void>;
  public static async select<T1, T2, T3>(
    channel1: Channel<T1>,
    handler1: (value: T1) => Promise<void>,
    channel2: Channel<T2>,
    handler2: (value: T2) => Promise<void>,
    channel3: Channel<T3>,
    handler3: (value: T3) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void>;
  public static async select<T1, T2, T3, T4>(
    channel1: Channel<T1>,
    handler1: (value: T1) => Promise<void>,
    channel2: Channel<T2>,
    handler2: (value: T2) => Promise<void>,
    channel3: Channel<T3>,
    handler3: (value: T3) => Promise<void>,
    channel4: Channel<T4>,
    handler4: (value: T4) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void>;
  public static async select<T1, T2, T3, T4, T5>(
    channel1: Channel<T1>,
    handler1: (value: T1) => Promise<void>,
    channel2: Channel<T2>,
    handler2: (value: T2) => Promise<void>,
    channel3: Channel<T3>,
    handler3: (value: T3) => Promise<void>,
    channel4: Channel<T4>,
    handler4: (value: T4) => Promise<void>,
    channel5: Channel<T5>,
    handler5: (value: T5) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void>;
  public static async select<T1, T2, T3, T4, T5>(
    channel1: Channel<T1>,
    handler1: (value: T1) => Promise<void>,
    channel2: Channel<T2>,
    handler2: (value: T2) => Promise<void>,
    channel3orSignal?: Channel<T3> | AbortSignal,
    handler3?: (value: T3) => Promise<void>,
    channel4orSignal?: Channel<T4> | AbortSignal,
    handler4?: (value: T4) => Promise<void>,
    channel5orSignal?: Channel<T5> | AbortSignal,
    handler5?: (value: T5) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    const waiting: [Channel<unknown>, (value: any) => Promise<void>][] = [
      [channel1, handler1],
      [channel2, handler2],
    ];
    let passedSignal: AbortSignal | undefined;
    if (channel3orSignal instanceof Channel) {
      if (handler3 !== undefined) {
        waiting.push([channel3orSignal, handler3]);
      }
    } else if (channel3orSignal !== undefined) {
      passedSignal = channel3orSignal;
    }
    if (channel4orSignal instanceof Channel) {
      if (handler4 !== undefined) {
        waiting.push([channel4orSignal, handler4]);
      }
    } else if (channel4orSignal !== undefined) {
      passedSignal = channel4orSignal;
    }
    if (channel5orSignal instanceof Channel) {
      if (handler5 !== undefined) {
        waiting.push([channel5orSignal, handler5]);
      }
    } else if (channel5orSignal !== undefined) {
      passedSignal = channel5orSignal;
    }
    return await Channel.selectInternal(waiting, signal ?? passedSignal);
  }
}
