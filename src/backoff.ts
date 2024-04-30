export class BackoffSession {
  private attemptsMutable = 0;

  public constructor(public readonly basisWaitTime: number) {}

  public get attempts(): number {
    return this.attemptsMutable;
  }

  public nextSleepTime(): number {
    // Clamping the uniform sample to the 99.5th percentile means
    // we aren't going to sleep _forever_ on the next attempt.
    const roll = Math.min(Math.random(), 0.995);
    // This is the quantile function of the exponential distribution;
    // we're sampling the jitter from an exponential distribution with
    // a rate of 1/basisWaitTime to better match an expected
    // Poisson-distributed nature of the caller. This has the nice
    // property of Poisson-distributing any retry traffic.
    const jitter = -Math.log(1 - roll);
    const currentAttempt = ++this.attemptsMutable;
    return jitter * this.basisWaitTime * currentAttempt ** 2;
  }

  public resetAttempts(): void {
    this.attemptsMutable = 0;
  }
}
