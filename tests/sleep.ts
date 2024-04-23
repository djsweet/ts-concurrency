import { sleep } from "../src/sleep";

describe("sleep", () => {
  it("sleeps", async () => {
    const fullSleep = await sleep(500);
    expect(fullSleep).toBe(true);
  });

  it("cancels sleep", async () => {
    const controller = new AbortController();
    const fullSleepPromise = sleep(500, controller.signal);
    controller.abort();
    const fullSleep = await fullSleepPromise;
    expect(fullSleep).toBe(false);
  });
});
