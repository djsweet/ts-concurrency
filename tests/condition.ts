import { Condition } from "../src/condition";

describe("condition variables", () => {
  it("signals when notifies one", async () => {
    const cv = new Condition();
    setImmediate(() => cv.notifyOne());
    const notified = await cv.wait();
    expect(notified).toBe(true);
  });

  it("signals only one when notifies one", async () => {
    const cv = new Condition();
    const controller = new AbortController();

    const firstNotify = cv.wait(controller.signal);
    const secondNotify = cv.wait(controller.signal);
    expect(cv.waiting).toEqual(2);
    cv.notifyOne();

    let notifications = 0;
    const incrementIfNotified = (notified: boolean) => {
      if (notified) {
        notifications++;
      }
    };

    setImmediate(() => controller.abort());
    await Promise.all([
      firstNotify.then(incrementIfNotified),
      secondNotify.then(incrementIfNotified),
    ]);
    expect(notifications).toEqual(1);
    expect(cv.waiting).toEqual(0);
  });

  it("signals only one when notifies one, with intermediate steps", async () => {
    const cv = new Condition();

    const firstNotify = cv.wait();
    const secondNotify = cv.wait();
    expect(cv.waiting).toEqual(2);
    cv.notifyOne();

    expect(cv.waiting).toEqual(1);
    cv.notifyOne();

    let notifications = 0;
    const incrementIfNotified = (notified: boolean) => {
      if (notified) {
        notifications++;
      }
    };

    await Promise.all([
      firstNotify.then(incrementIfNotified),
      secondNotify.then(incrementIfNotified),
    ]);

    expect(notifications).toEqual(2);
    expect(cv.waiting).toEqual(0);
  });

  it("signals all when notifies all", async () => {
    const cv = new Condition();
    const controller = new AbortController();

    const firstNotify = cv.wait(controller.signal);
    const secondNotify = cv.wait(controller.signal);
    expect(cv.waiting).toEqual(2);
    cv.notifyAll();

    let notifications = 0;
    const incrementIfNotified = (notified: boolean) => {
      if (notified) {
        notifications++;
      }
    };

    setImmediate(() => controller.abort());
    await Promise.all([
      firstNotify.then(incrementIfNotified),
      secondNotify.then(incrementIfNotified),
    ]);

    expect(notifications).toEqual(2);
    expect(cv.waiting).toEqual(0);
  });
});
