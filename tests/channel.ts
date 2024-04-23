import {
  Channel,
  ReadCancelledException,
  WriteCancelledException,
} from "../src/channel";

describe("channel", () => {
  it("supports writes before reads", async () => {
    const channel = new Channel<number>();

    let setupReadPromise = false;
    const writePromise = channel.write(12).then(() => {
      expect(setupReadPromise).toBe(true);
    });

    const readPromise = channel.read().then((value) => {
      expect(value).toEqual(12);
    });
    setupReadPromise = true;

    await Promise.all([readPromise, writePromise]);

    expect(channel.isClosed).toBe(false);
  });

  it("supports reads before writes", async () => {
    const channel = new Channel<number>();

    let setupWritePromise = false;
    const readPromise = channel.read().then((value) => {
      expect(value).toEqual(5);
      expect(setupWritePromise).toBe(true);
    });

    const writePromise = channel.write(5);
    setupWritePromise = true;
    await readPromise;
    await writePromise;

    expect(channel.isClosed).toBe(false);
  });

  it("supports more reads than writes", async () => {
    const channel = new Channel<number>();

    let successfulReads = 0;
    let unsuccessfulReads = 0;
    const controller = new AbortController();

    const onValue = (value: number) => {
      expect(value).toEqual(7);
      successfulReads++;
      controller.abort();
    };

    const onRaise = (e: unknown) => {
      expect(e).toBeInstanceOf(ReadCancelledException);
      unsuccessfulReads++;
    };

    const readPromise1 = channel
      .read(controller.signal)
      .then(onValue)
      .catch(onRaise);
    const readPromise2 = channel
      .read(controller.signal)
      .then(onValue)
      .catch(onRaise);

    await channel.write(7);

    await Promise.all([readPromise1, readPromise2]);
    expect(successfulReads).toEqual(1);
    expect(unsuccessfulReads).toEqual(1);

    const writeAfterCancelPromise = channel.write(8);
    const readAfterCancel = await channel.read();
    expect(readAfterCancel).toEqual(8);

    await writeAfterCancelPromise;
    expect(channel.isClosed).toBe(false);
  });

  it("supports more writes than reads", async () => {
    const channel = new Channel<number>();

    let successfulWrites = 0;
    let unsuccessfulWrites = 0;
    const controller = new AbortController();

    const onWrite = () => {
      successfulWrites++;
      controller.abort();
    };

    const onRaise = (e: unknown) => {
      expect(e).toBeInstanceOf(WriteCancelledException);
      unsuccessfulWrites++;
    };

    const writePromise1 = channel
      .write(10, controller.signal)
      .then(onWrite)
      .catch(onRaise);
    const writePromise2 = channel
      .write(10, controller.signal)
      .then(onWrite)
      .catch(onRaise);

    const readValue = await channel.read();
    expect(readValue).toEqual(10);

    await Promise.all([writePromise1, writePromise2]);

    expect(successfulWrites).toEqual(1);
    expect(unsuccessfulWrites).toEqual(1);

    const writeAfterCancelPromise = channel.write(11);
    const readAfterCancel = await channel.read();
    expect(readAfterCancel).toEqual(11);

    await writeAfterCancelPromise;
    expect(channel.isClosed).toBe(false);
  });
});
