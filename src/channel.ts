import { Condition } from "./condition";

export class ChannelClosedException extends Error {}
export class ReadCancelledException extends Error {}
export class WriteCancelledException extends Error {}

/**
 * Go-style, unbuffered, unidirectional data channel
 *
 * A channel is a concurrency primitive popularized by Go
 * (although existing in preceding programming languages)
 * that establishes a unidirectional write-read flow between
 * two concurrent processes.
 *
 * Consumers call {@link Channel#read} to receive values
 * from producers, and producers call {@link Channel#write}
 * to send values to consumers. Every write corresponds to
 * at most one read, and every read corresponds to at most one
 * write.
 *
 * If a reader attempts to read before a writer provides a
 * value, the {@link Channel#read} method blocks until a
 * write is made available or the read attempt is cancelled
 * with an optional `AbortSignal`.
 *
 * If a writer attempts to write before a reader prepares to
 * read a value, the {@link Channel#write} method blocks until
 * a read attempt occurs or the write attempt is cancelled with
 * an optional `AbortSignal`.
 *
 * Concurrent reads from multiple channels are provided by
 * {@link Channel#select}, which emulates the semantics of
 * Go's `select` statement with respect to channel read operations.
 *
 * Iteration over all supplied channel reads is provided by
 * {@link Channel.iterate}, which emulates the semantics of
 * Go's `for x := range c` statement. Iteration continues
 * until the channel is closed, or the optional `AbortSignal`
 * indicates that the iteration is cancelled.
 */
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

  /**
   * Closes the channel to prevent future communications
   *
   * All pending reads and writes are cancelled and result
   * in a {@link ChannelClosedException} being thrown, and
   * all future reads and writes immediately result in a
   * {@link ChannelClosedException} being thrown.
   */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readCV.notifyAll();
    this.writeReadCV.notifyAll();
    this.writeWriteCV.notifyAll();
  }

  /**
   * Produces a value for pending or future calls to {@link Channel.read}
   *
   * Each call to this method corresponds to at most one {@link Channel.read}
   * call. If no outstanding readers are available, this method blocks until
   * a call to {@link Channel.read} is available.
   *
   * Because of the at-most-once semantics of writes corresponding to reads,
   * outstanding writers do block each other. If two writes are established,
   * then a single read occurs, one of the two writes will remain outstanding.
   *
   * @param value - The value to send to a {@link Channel.read} call
   * @param signal - An optional `AbortSignal` that can be used to cancel the write attempt
   * @throws WriteCancelledException if the optional `signal` has been aborted
   * @throws ChannelClosedException if the underlying channel has been closed
   */
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

    // By this point, the reader has read the value, or we've given up.
    // We should signal another writer that it can write.
    this.value = undefined; // Don't hold on to the value so that we can GC it
    this.valueInTransit = false;
    this.writeWriteCV.notifyOne();

    if (!fromNotify) throw new WriteCancelledException();
    if (this.closed) throw new ChannelClosedException();
  }

  private async readInternal(
    shouldTakeRead: () => boolean,
    signal: AbortSignal | undefined
  ): Promise<T> {
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
    // We expose this to ensure at-most-once handler execution in selects.
    if (!shouldTakeRead()) throw new ReadCancelledException();

    const result = this.value!;
    this.readSerial++;
    this.writeReadCV.notifyOne();
    return result;
  }

  private readonly alwaysTakeRead = () => true;

  /**
   * Consumes a value produced by pending or future calls to {@link Channel#write}
   *
   * Each call to this method corresponds to at most one {@link Channel.write}
   * call. If no outstanding readers are available, this method blocks until
   * a call to {@link Channel.write} is available.
   *
   * Because of the at-most-once semantics of writes corresponding to reads,
   * outstanding readers do block each other. If two reads are established,
   * then a single write occurs, one of the two reads will remain outstanding.
   *
   * @param signal - An optional `AbortSignal`
   * @returns A value produced by a call to {@link Channel#write}
   * @throws ReadCancelledException if the optional `signal` has been aborted
   * @throws ChannelClosedException if the underlying channel has been closed
   */
  public async read(signal?: AbortSignal): Promise<T> {
    return await this.readInternal(this.alwaysTakeRead, signal);
  }

  /**
   * Iterates over this channel by repeatedly calling {@link Channel#read}
   *
   * The iteration continues until either the channel has been closed with
   * {@link Channel#close}, or the optional `AbortSignal` has been aborted.
   * @param signal - An optional `AbortSignal` that can be used to cancel iteration
   */
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

    // This ensures that at most one handler will run, and that at most one
    // channel will have its read value taken.
    let didRead = false;
    const shouldTakeRead = () => {
      if (didRead) return false;
      didRead = true;
      return true;
    };

    try {
      const channelReads = options.map(([channel], i) =>
        channel
          .readInternal(shouldTakeRead, controller.signal)
          .then((value) => {
            controller.abort(); // Cancel as many of the other reads as we can
            // Since we have the read value here, we'll execute the handler.
            return options[i][1](value);
          })
          .catch((x: unknown) => {
            // We ignore ReadCancelledException here.
            if (!(x instanceof ReadCancelledException)) throw x;
          })
      );
      // Instead of Promise.race, we use a Promise.all paired with the above boolean
      // to ensure at most one handler runs all the way to completion.
      await Promise.all(channelReads);
    } finally {
      signal?.removeEventListener("abort", abortOnExternalSignal);
    }
  }

  /**
   * Simulates Go's `select` statement with channel reads up to five channels
   */
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
