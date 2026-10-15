import { AutoSyncScheduler, RETRY_STEPS_MS } from '../auto-sync-scheduler';

/* Fake timers that record what was scheduled, so the backoff can be stepped. */
function fakeTimers() {
  let next = 1;
  const queue = new Map<number, { fn: () => void; ms: number }>();
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => { const id = next++; queue.set(id, { fn, ms }); return id as unknown as ReturnType<typeof setTimeout>; },
      clearTimeout: (t: ReturnType<typeof setTimeout>) => { queue.delete(t as unknown as number); },
    },
    scheduled: () => [...queue.values()].map((q) => q.ms),
    async fire() {
      const first = [...queue.entries()][0];
      if (!first) throw new Error('nothing scheduled');
      queue.delete(first[0]);
      first[1].fn();
      await new Promise<void>((r) => setImmediate(() => r()));
    },
  };
}

describe('AutoSyncScheduler', () => {
  it('does not retry once everything is uploaded', async () => {
    const t = fakeTimers();
    const run = jest.fn().mockResolvedValue(0);
    await new AutoSyncScheduler(run, t.timers).trigger();
    expect(run).toHaveBeenCalledTimes(1);
    expect(t.scheduled()).toEqual([]);
  });

  it('backs off while sessions stay pending, then stops when the connection returns', async () => {
    const t = fakeTimers();
    const run = jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    await new AutoSyncScheduler(run, t.timers).trigger();
    expect(t.scheduled()).toEqual([RETRY_STEPS_MS[0]]);
    await t.fire();
    expect(t.scheduled()).toEqual([RETRY_STEPS_MS[1]]);
    await t.fire();
    expect(t.scheduled()).toEqual([RETRY_STEPS_MS[2]]);
    await t.fire(); // uploads succeed now
    expect(run).toHaveBeenCalledTimes(4);
    expect(t.scheduled()).toEqual([]);
  });

  it('caps the backoff at the last step', async () => {
    const t = fakeTimers();
    const s = new AutoSyncScheduler(jest.fn().mockResolvedValue(1), t.timers);
    await s.trigger();
    for (let i = 0; i < RETRY_STEPS_MS.length + 2; i++) await t.fire();
    expect(t.scheduled()).toEqual([RETRY_STEPS_MS[RETRY_STEPS_MS.length - 1]]);
  });

  it('a new trigger restarts the backoff', async () => {
    const t = fakeTimers();
    const s = new AutoSyncScheduler(jest.fn().mockResolvedValue(1), t.timers);
    await s.trigger();
    await t.fire();
    expect(t.scheduled()).toEqual([RETRY_STEPS_MS[1]]);
    await s.trigger(); // e.g. app came back to the foreground
    expect(t.scheduled()).toEqual([RETRY_STEPS_MS[0]]);
  });

  it('pauses in the background and never runs while inactive', async () => {
    const t = fakeTimers();
    const run = jest.fn().mockResolvedValue(1);
    const s = new AutoSyncScheduler(run, t.timers);
    await s.trigger();
    s.setActive(false);
    expect(t.scheduled()).toEqual([]);
    await s.trigger();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('treats an unexpected failure as still pending', async () => {
    const t = fakeTimers();
    await new AutoSyncScheduler(jest.fn().mockRejectedValue(new Error('boom')), t.timers).trigger();
    expect(t.scheduled()).toEqual([RETRY_STEPS_MS[0]]);
  });

  it('stops for good when disposed (signed out)', async () => {
    const t = fakeTimers();
    const run = jest.fn().mockResolvedValue(1);
    const s = new AutoSyncScheduler(run, t.timers);
    await s.trigger();
    s.dispose();
    expect(t.scheduled()).toEqual([]);
    await s.trigger();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
