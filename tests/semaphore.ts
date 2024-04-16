import { Semaphore } from "../src/semaphore";

describe("semaphore", () => {
  it("only blocks when all counters are allocated", async () => {
    const semaphore = new Semaphore(2);
    const firstHandle = await semaphore.acquire();
    expect(firstHandle).toBeDefined();
    const secondHandle = await semaphore.acquire();
    expect(secondHandle).toBeDefined();

    let flag = false;
    const thirdHandlePromise = semaphore.withSlot(async () => {
      expect(flag).toBe(true);
    });
    expect(semaphore.waiting).toEqual(1);

    flag = true;
    semaphore.release(secondHandle);
    const thirdHandleResult = await thirdHandlePromise;
    expect(thirdHandleResult.status).toEqual("acquired");

    const fourthHandleResult = await semaphore.withSlot(async () => {
      expect(flag).toBe(true);
    });
    expect(fourthHandleResult.status).toEqual("acquired");

    const fifthHandle = await semaphore.acquire();
    expect(fifthHandle).toBeDefined();

    const controller = new AbortController();
    const sixthHandlePromise = semaphore.acquire(controller.signal);
    expect(semaphore.waiting).toEqual(1);

    setImmediate(() => controller.abort());
    const sixthHandle = await sixthHandlePromise;
    expect(sixthHandle).toBeUndefined();

    semaphore.release(fifthHandle);
    expect(semaphore.waiting).toEqual(0);
    semaphore.release(firstHandle);
    expect(semaphore.waiting).toEqual(0);
  });

  it("releases in withSlot when thrown", async () => {
    const semaphore = new Semaphore(2);
    const firstHandle = await semaphore.acquire();
    expect(firstHandle).toBeDefined();
    expect(semaphore.waiting).toEqual(0);

    let flag = false;
    expect(() =>
      semaphore.withSlot(async () => {
        flag = true;
        throw new Error("yep we're throwing");
      })
    ).rejects.toThrow();

    const controller = new AbortController();
    const secondHandlePromise = semaphore.acquire(controller.signal);
    setImmediate(() => controller.abort());
    const secondHandle = await secondHandlePromise;
    expect(secondHandle).toBeDefined();
    expect(flag).toBe(true);

    semaphore.release(secondHandle);
    semaphore.release(firstHandle);
  });

  it("only releases with the right handle", async () => {
    const semaphore = new Semaphore();
    const firstHandle = await semaphore.acquire();
    expect(firstHandle).toBeDefined();

    let flag = false;
    const secondHandlePromise = semaphore
      .acquire()
      .then(() => expect(flag).toBe(true));
    expect(semaphore.waiting).toEqual(1);

    semaphore.release(undefined);
    expect(semaphore.waiting).toEqual(1);

    semaphore.release(-1);
    expect(semaphore.waiting).toEqual(1);

    flag = true;
    semaphore.release(firstHandle);

    await secondHandlePromise;
  });
});
