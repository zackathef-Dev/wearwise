/* The retry timing behind auto-sync (see auto-sync.ts), kept free of React Native
 * so it can be tested on its own. After each attempt that leaves sessions pending,
 * the next try waits one step longer, up to the last step; any fresh trigger
 * (foreground, a saved recording) starts again from the first step. */

export const RETRY_STEPS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;

interface Timers {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (t: ReturnType<typeof setTimeout>) => void;
}

export class AutoSyncScheduler {
  private step = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = true;
  private disposed = false;

  /** `run` uploads and resolves to how many sessions are still pending. */
  constructor(
    private readonly run: () => Promise<number>,
    private readonly timers: Timers = { setTimeout, clearTimeout },
  ) {}

  /** Something happened that makes uploading worthwhile now; restarts the backoff. */
  trigger(): Promise<void> {
    this.step = 0;
    return this.attempt();
  }

  /** Foreground (true) or background (false). Background cancels pending retries. */
  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.cancel();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private async attempt(): Promise<void> {
    this.cancel();
    if (!this.active || this.disposed) return;
    let pending: number;
    try {
      pending = await this.run();
    } catch {
      pending = 1; // treat an unexpected failure as "still to do"
    }
    if (pending <= 0) { this.step = 0; return; }
    if (!this.active || this.disposed) return;
    const delay = RETRY_STEPS_MS[Math.min(this.step, RETRY_STEPS_MS.length - 1)] ?? 300_000;
    this.step += 1;
    this.timer = this.timers.setTimeout(() => { void this.attempt(); }, delay);
  }

  private cancel(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
