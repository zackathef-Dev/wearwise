import { getSessionStore, useMonitoring } from '@/features/monitoring/monitoring-store';
import { SupabaseSyncGateway } from '@/data/remote/supabase-sync-gateway';

/* Delete recorded sessions everywhere they exist — the one implementation behind the
 * session screen's Delete and History's multi-select delete.
 *
 * Cloud first: if that fails the phone copy stays, so the participant can retry
 * rather than being left with an orphaned cloud copy they can no longer reach. Any
 * sync attempt writes the session row before its channels, so once a sync state exists
 * a cloud copy may exist too — even after a failed or partial upload.
 */
export async function deleteSessionEverywhere(userId: string, sessionId: string): Promise<void> {
  const store = getSessionStore();
  if (!store) throw new Error('Storage is not ready yet.');
  const snap = useMonitoring.getState().engine;
  if (snap?.sessionId === sessionId && (snap.state === 'recording' || snap.state === 'preparing' || snap.state === 'stopping')) {
    throw new Error('Stop the recording before deleting it.');
  }
  const sync = await store.getSyncState(sessionId);
  const cloudMayExist = sync != null && (sync.status !== 'pending' || sync.attempts > 0);
  if (cloudMayExist) {
    const gateway = new SupabaseSyncGateway();
    if (!gateway.isConfigured()) throw new Error('The cloud copy could not be deleted. Check your connection and try again.');
    await gateway.deleteSession(userId, sessionId);
  }
  await store.deleteSession(sessionId);
}

/* Delete several, one after another (each is its own cloud + phone delete). Reports
   progress; failures do not stop the rest and are returned for the UI to show. */
export async function deleteSessionsEverywhere(
  userId: string, ids: readonly string[], onProgress?: (done: number) => void,
): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }> {
  const deleted: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    try { await deleteSessionEverywhere(userId, id); deleted.push(id); }
    catch (e) { failed.push({ id, reason: e instanceof Error ? e.message : 'Could not delete.' }); }
    onProgress?.(deleted.length + failed.length);
  }
  return { deleted, failed };
}
