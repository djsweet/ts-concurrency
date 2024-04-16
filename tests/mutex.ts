import { Mutex } from "../src/mutex";

describe("mutex", () => {
  it("locks and unlocks", async () => {
    const mutex = new Mutex();
    const firstHandle = await mutex.acquire();
    expect(firstHandle).toBeDefined();

    let flag = false;
    const verifyPromise = mutex.withLock(async () => {
      expect(flag).toBe(true);
    });

    flag = true;
    mutex.release(firstHandle);

    const verifyResult = await verifyPromise;
    expect(verifyResult.status).toEqual("acquired");
  });

  it("supports cancellation", async () => {
    const mutex = new Mutex();
    const firstHandle = await mutex.acquire();
    expect(firstHandle).toBeDefined();

    const controller = new AbortController();
    const verifyPromise = mutex.withLock(async () => {
      fail("Should not have run");
    }, controller.signal);

    controller.abort();
    mutex.release(firstHandle);
    const verifyResult = await verifyPromise;
    expect(verifyResult.status).toEqual("aborted");
  });

  it("releases in withLock when thrown", async () => {
    const mutex = new Mutex();

    expect(() =>
      mutex.withLock(async () => {
        throw new Error("Yep we threw");
      })
    ).rejects.toThrow();

    const controller = new AbortController();
    const acquirePromise = mutex.acquire(controller.signal);
    setImmediate(() => controller.abort());
    const acquireResult = await acquirePromise;
    expect(acquireResult).toBeDefined();

    mutex.release(acquireResult);
  });

  it("only releases with the right handle", async () => {
    const mutex = new Mutex();
    const firstHandle = await mutex.acquire();
    expect(firstHandle).toBeDefined();

    let flag = false;
    mutex.release(-1);
    const verifyPromise = mutex.withLock(async () => {
      expect(flag).toBe(true);
    });

    flag = true;
    mutex.release(firstHandle);

    const verifyResult = await verifyPromise;
    expect(verifyResult.status).toEqual("acquired");
  });
});
