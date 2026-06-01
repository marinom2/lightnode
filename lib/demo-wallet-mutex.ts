/**
 * Process-singleton mutex for the demo-wallet routes
 * (/api/preflight-demo + /api/chat-demo).
 *
 * Why: the shared demo wallet only has one active gateway session at a
 * time. Two concurrent requests both call `prepareSession`, the gateway
 * supersedes the older one and the loser gets 409 selection_mismatch.
 * Serialising at the API boundary turns the race into a queue.
 *
 * Caveats:
 *   - Process-singleton only. Serverless invocations on different cold
 *     instances do not share this lock; for the lightnode.app demo the
 *     traffic is light enough that one warm instance handles bursts.
 *   - Honour `acquireTimeoutMs`: if the queue is too long we fail fast
 *     so the visitor sees a clear "busy, try again" instead of hitting
 *     Vercel's 60s function timeout.
 */

type Waiter = (release: () => void) => void;

class Mutex {
  private locked = false;
  private waiters: Waiter[] = [];

  /**
   * Block until the lock is free or the timeout elapses. Returns a
   * release function on success, or null when the timeout fired first.
   * Always call the returned release in a try/finally.
   */
  async acquire(timeoutMs: number): Promise<(() => void) | null> {
    return new Promise<(() => void) | null>((resolve) => {
      const deadline = setTimeout(() => {
        // Drop this waiter from the queue if it has not been resolved yet.
        const idx = this.waiters.indexOf(grant);
        if (idx !== -1) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      const grant: Waiter = (release) => {
        clearTimeout(deadline);
        resolve(release);
      };
      const release = (): void => {
        this.locked = false;
        const next = this.waiters.shift();
        if (next) {
          this.locked = true;
          next(release);
        }
      };
      if (!this.locked) {
        this.locked = true;
        grant(release);
      } else {
        this.waiters.push(grant);
      }
    });
  }
}

// Two separate mutexes so a long-running chat-demo does not starve a
// quick preflight check (their gateway selections are independent).
export const preflightMutex = new Mutex();
export const chatMutex = new Mutex();
