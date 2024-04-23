import {
  Channel,
  ChannelClosedException,
  ReadCancelledException,
  WriteCancelledException,
} from "../src/channel";
import { sleep } from "../src/sleep";

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

  it("supports closing on pre-existing reads and new writes", async () => {
    let readRejected = false;
    const channel = new Channel<number>();
    const readPromise = channel.read().catch((x: unknown) => {
      expect(readRejected).toBe(false);
      expect(x).toBeInstanceOf(ChannelClosedException);
      readRejected = true;
    });

    expect(channel.isClosed).toBe(false);
    channel.close();
    expect(channel.isClosed).toBe(true);
    let writeRejected = false;
    try {
      await channel.write(7);
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ChannelClosedException);
      writeRejected = true;
    }

    expect(writeRejected).toBe(true);
    await readPromise;
    expect(readRejected).toBe(true);
    expect(channel.isClosed).toBe(true);
  });

  it("supports closing on pre-existing writes and new reads", async () => {
    let writeRejected = false;
    const channel = new Channel<number>();
    const writePromise = channel.write(7).catch((x: unknown) => {
      expect(writeRejected).toBe(false);
      expect(x).toBeInstanceOf(ChannelClosedException);
      writeRejected = true;
    });

    expect(channel.isClosed).toBe(false);
    channel.close();
    expect(channel.isClosed).toBe(true);
    let readRejected = false;
    try {
      await channel.read();
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(ChannelClosedException);
      readRejected = true;
    }

    expect(readRejected).toBe(true);
    await writePromise;
    expect(writeRejected).toBe(true);
    expect(channel.isClosed).toBe(true);
  });

  it("supports iteration", async () => {
    const channel = new Channel<number>();
    const controller = new AbortController();
    const writePromise = (async () => {
      for (let i = 0; i < 10; i++) {
        await channel.write(i);
      }
      controller.abort();
    })();

    const numbers: number[] = [];
    for await (const element of channel.iterate(controller.signal)) {
      numbers.push(element);
    }
    for (let i = 0; i < 10; i++) {
      expect(numbers[i]).toEqual(i);
    }

    await writePromise;
  });

  it("supports iteration with channel closure", async () => {
    const channel = new Channel<number>();
    const writePromise = (async () => {
      for (let i = 0; i < 10; i++) {
        await channel.write(i);
      }
      channel.close();
    })();

    const numbers: number[] = [];
    for await (const element of channel.iterate()) {
      numbers.push(element);
    }
    for (let i = 0; i < 10; i++) {
      expect(numbers[i]).toEqual(i);
    }

    await writePromise;
  });

  it("supports select", async () => {
    const numberChannel = new Channel<number>();
    const stringChannel = new Channel<string>();
    const booleanChannel = new Channel<boolean>();

    const writePromise = (async () => {
      await numberChannel.write(15);
      await stringChannel.write("something");
      await booleanChannel.write(true);
    })();

    let gotBool = false;
    let gotString = false;
    let gotNumber = false;

    while (!gotBool || !gotString || !gotNumber) {
      await Channel.select(
        booleanChannel,
        async (boolValue) => {
          await sleep(1);
          expect(gotBool).toBe(false);
          expect(boolValue).toEqual(true);
          gotBool = true;
        },
        stringChannel,
        async (stringValue) => {
          await sleep(2);
          expect(gotString).toBe(false);
          expect(stringValue).toEqual("something");
          gotString = true;
        },
        numberChannel,
        async (numberValue) => {
          await sleep(3);
          expect(gotNumber).toBe(false);
          expect(numberValue).toEqual(15);
          gotNumber = true;
        }
      );
    }

    await writePromise;

    expect(gotBool).toBe(true);
    expect(gotString).toBe(true);
    expect(gotNumber).toBe(true);
  });
});
