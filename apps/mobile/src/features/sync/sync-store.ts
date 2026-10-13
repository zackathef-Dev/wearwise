import { create } from 'zustand';
import { SyncEngine, type SyncOutcome, type AlertSyncOutcome } from '@/domain/sync/sync-engine';
import { SupabaseSyncGateway } from '@/data/remote/supabase-sync-gateway';
import { getSessionStore, isRecording } from '@/features/monitoring/monitoring-store';
import { backendConfigured } from '@/data/remote/supabase-client';
import { useAuth } from '@/features/authentication/auth-store';

/* Cloud-sync feature state. Screens read `pending`/`phase`/`lastError` and can
 * trigger `syncNow`. Sync is best-effort and offline-first: a failure is surfaced
 * quietly and retried. Triggers live in auto-sync.ts (sign-in, app foreground, a
 * recording saved, then backoff retries while anything is pending) plus Home focus
 * and the manual Sync buttons. The local store stays the source of truth throughout.
 *
 * Vital alerts also have a lighter path of their own, syncAlertsNow: a small upsert,
 * run soon after an alert opens or changes — even mid-recording, when the full sync
 * waits — so the people a participant shares with see alerts while they matter.
 */

type Phase = 'idle' | 'syncing' | 'error';

interface SyncState {
  phase: Phase;
  pending: number;         // finished sessions not yet fully uploaded
  lastError: string | null;
  lastOutcome: SyncOutcome | null;
  lastSyncedAt: string | null;
  /* Set when restoreOnce() brought sessions back from the cloud, so lists reload. */
  restoredAt: string | null;
  /* Vital alerts whose last upload failed in a way worth retrying soon (offline). A
     backend without the vital_alerts table is not counted: nothing to retry until it has. */
  alertsPending: number;

  refreshPending(userId: string): Promise<void>;
  syncNow(userId: string): Promise<void>;
  syncAlertsNow(userId: string): Promise<void>;
}

let running = false; // guard against overlapping syncs (foreground + manual tap)
let alertsRunning = false;
let alertsAgain = false; // an alert changed while its upload was running: go round again

const ownsSession = (userId: string) =>
  useAuth.getState().status === 'signed-in' && useAuth.getState().participant?.id === userId;
const retryableAlerts = (o: AlertSyncOutcome | undefined) => (o?.status === 'failed' ? o.pending : 0);

export const useSync = create<SyncState>((set, get) => ({
  phase: 'idle', pending: 0, lastError: null, lastOutcome: null, lastSyncedAt: null, restoredAt: null, alertsPending: 0,

  async refreshPending(userId) {
    const store = getSessionStore();
    if (!store) return;
    try { set({ pending: await store.countPendingSync(userId) }); } catch { /* store not ready */ }
  },

  async syncNow(userId) {
    const owns = () => ownsSession(userId);
    if (!owns()) return;
    if (running) return;
    /* Never sync on the JS thread while recording — it stutters the live trace and
       delays packet ingest. Just refresh the count; the next trigger (stop, next
       foreground) uploads. */
    if (isRecording()) { await get().refreshPending(userId); return; }
    const store = getSessionStore();
    if (!store || !backendConfigured) { await get().refreshPending(userId); return; }
    running = true;
    set({ phase: 'syncing', lastError: null });
    try {
      const engine = new SyncEngine(store, new SupabaseSyncGateway(), userId);
      /* If a recording starts mid-sync, abort between sessions and yield the thread. */
      const outcome = await engine.syncOnce(() => isRecording() || !owns());
      if (!owns()) return;
      /* Then the reverse direction: bring back cloud sessions this phone lacks
         (reinstall / new phone). Best-effort; never fails the upload result. */
      try {
        const { restored, errors } = await engine.restoreOnce(() => isRecording() || !owns());
        if (__DEV__ && errors?.length) console.warn('[wearwise] restore failed for', errors.length, 'session(s):', errors[0]);
        if (restored > 0 && owns()) set({ restoredAt: new Date().toISOString() });
      } catch (e) {
        /* offline or backend unavailable — retried on the next trigger */
        if (__DEV__) console.warn('[wearwise] restore unavailable:', e instanceof Error ? e.message : e);
      }
      if (!owns()) return;
      const pending = await store.countPendingSync(userId);
      set({
        phase: outcome.failed > 0 ? 'error' : 'idle',
        pending,
        lastOutcome: outcome,
        lastError: outcome.errors[0]?.message ?? null,
        lastSyncedAt: outcome.synced > 0 ? new Date().toISOString() : get().lastSyncedAt,
        ...(outcome.alerts ? { alertsPending: retryableAlerts(outcome.alerts) } : {}),
      });
    } catch (e) {
      if (!owns()) return;
      set({ phase: 'error', lastError: e instanceof Error ? e.message : 'Sync failed.' });
    } finally {
      running = false;
    }
  },

  async syncAlertsNow(userId) {
    if (!ownsSession(userId)) return;
    const store = getSessionStore();
    if (!store || !backendConfigured) return;
    if (alertsRunning) { alertsAgain = true; return; }
    alertsRunning = true;
    try {
      do {
        alertsAgain = false;
        const outcome = await new SyncEngine(store, new SupabaseSyncGateway(), userId).syncAlerts(() => !ownsSession(userId));
        if (!ownsSession(userId)) return;
        if (__DEV__ && outcome.status === 'failed') console.warn('[wearwise] alert upload failed:', outcome.error);
        set({ alertsPending: retryableAlerts(outcome) });
      } while (alertsAgain);
    } finally {
      alertsRunning = false;
    }
  },
}));

useAuth.subscribe((state, previous) => {
  if (state.participant?.id !== previous.participant?.id) {
    useSync.setState({ phase: 'idle', pending: 0, lastError: null, lastOutcome: null, lastSyncedAt: null, restoredAt: null, alertsPending: 0 });
  }
});
