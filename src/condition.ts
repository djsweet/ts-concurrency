export class Condition {
  private readonly handlers: (() => void)[] = [];

  public get waiting(): number {
    return this.handlers.length;
  }

  private removeFromHandlers(handler: () => void): void {
    const notifyCallbackIndex = this.handlers.indexOf(handler);
    if (notifyCallbackIndex < 0) return;
    // Here, we're removing the handler callback.
    if (this.handlers.length === 1) {
      this.handlers.splice(0, this.handlers.length);
    } else {
      // Splice will move all elements to the right, left. This could turn
      // into an O(n) operation, so we'll turn this into O(1) by copying the
      // last element into this index, then splicing the end of the array.
      this.handlers[notifyCallbackIndex] = this.handlers[this.handlers.length];
      this.handlers.splice(this.handlers.length - 1);
    }
  }

  /**
   * Waits for a notification from either `notifyOne` or `notifyAll`
   *
   * @param abortSignal - If passed, the caller can abort the wait sequence.
   * @returns Whether the wait was caused by a notification. If false, the wait has been aborted.
   */
  public async wait(abortSignal?: AbortSignal): Promise<boolean> {
    return await new Promise((resolve) => {
      const cleanup = () => {
        abortSignal?.removeEventListener("abort", resolveByAbort);
        this.removeFromHandlers(resolveByNotify);
      };

      const resolveByAbort = () => {
        cleanup();
        resolve(false);
      };

      const resolveByNotify = () => {
        cleanup();
        resolve(true);
      };

      // If the abortController is given, we'll want to resolve this promise immediately.
      abortSignal?.addEventListener("abort", resolveByAbort);
      this.handlers.push(resolveByNotify);
    });
  }

  /**
   * Notifies exactly one call to `wait`.
   *
   * @returns void
   */
  public notifyOne(): void {
    if (this.handlers.length < 1) return;
    // Math.random() will return [0 , 1), so we only have to floor its
    // multiplication by the length to get a valid 0-based index.
    const handlerTarget = Math.floor(Math.random() * this.handlers.length);
    const handler = this.handlers[handlerTarget];
    this.removeFromHandlers(handler);
    handler();
  }

  /**
   * Notifies all outstanding calls to `wait` at once.
   *
   * @returns void
   */
  public notifyAll(): void {
    if (this.handlers.length < 1) return;
    const allHandlers = this.handlers.splice(0);
    for (const handler of allHandlers) {
      handler();
    }
  }
}
