import React from 'react';
import { AppState } from 'react-native';
import { homeRoute, useAuth } from '@/features/authentication/auth-store';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { useSync } from './sync-store';
import { AutoSyncScheduler } from './auto-sync-scheduler';

/* Keeps the cloud copy current without anyone tapping Sync.
 *
 * Triggers: sign-in / app start, the app returning to the foreground, and a
 * recording being saved. While uploads are still pending afterwards (offline,
 * server unreachable, a recording in progress), it retries on a backoff for as
 * long as the app is in the foreground — so sessions go up soon after the
 * connection returns, with no network-status native module needed. Backgrounding
 * pauses the retries; the next foreground starts afresh. The upload itself is
 * syncNow(): resumable and idempotent, guarded against overlapping runs.
 *
 * Vital alerts have their own, lighter trigger: a moment after an alert opens or
 * changes (its peak, its end), syncAlertsNow() uploads just the alerts — also while
 * recording and in the background, where the full sync waits. At most one upload per
 * few seconds: a burst of changes (a climbing peak) goes up together, and a peak that
 * keeps climbing still goes up every few seconds rather than waiting for it to stop.
 */

/* An alert change is uploaded within this long. */
const ALERT_SETTLE_MS = 3000;

/** Mounted once under the root layout; does nothing while signed out, or until the
    account has answered "Before you continue" (18+, terms): the server refuses uploads
    from an account that hasn't confirmed it is 18 or older. */
export function useAutoSync(): void {
  const userId = useAuth((s) => (s.status === 'signed-in' && homeRoute(s.participant) === '/home' ? s.participant?.id ?? null : null));

  React.useEffect(() => {
    if (!userId) return;
    const scheduler = new AutoSyncScheduler(async () => {
      await useSync.getState().syncNow(userId);
      return useSync.getState().pending + useSync.getState().alertsPending;
    });
    /* Never paused by backgrounding: an alert is worth one small request whenever the
       app is still running to record it. */
    const alertScheduler = new AutoSyncScheduler(async () => {
      await useSync.getState().syncAlertsNow(userId);
      return useSync.getState().alertsPending;
    });
    let settle: ReturnType<typeof setTimeout> | undefined;
    scheduler.setActive(AppState.currentState === 'active');
    void scheduler.trigger();

    const app = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      scheduler.setActive(active);
      if (active) void scheduler.trigger();
    });
    /* A recording just got saved: upload it now rather than at the next foreground. */
    const unsubscribe = useMonitoring.subscribe((state, previous) => {
      if (state.engine?.state === 'saved' && previous.engine?.state !== 'saved') void scheduler.trigger();
      /* The alert list reloads after every alert write (open, new peak, end). */
      if (state.recentAlerts !== previous.recentAlerts && !settle) {
        settle = setTimeout(() => { settle = undefined; void alertScheduler.trigger(); }, ALERT_SETTLE_MS);
      }
    });
    return () => { app.remove(); unsubscribe(); scheduler.dispose(); alertScheduler.dispose(); if (settle) clearTimeout(settle); };
  }, [userId]);
}
