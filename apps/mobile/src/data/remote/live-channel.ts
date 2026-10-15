import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveLink } from '@/domain/repositories/live-link';

/* One viewer's live-view channel: Supabase Realtime broadcast on the PRIVATE channel
 * `live:<grant id>` (docs/architecture/live-view-and-alerts.md §2). The server's
 * realtime.messages policies let this participant join and send only on their own
 * grants' channels, and only that grant's viewer receive — and send back, which is
 * used for three things: 'stop' (the viewer stops watching), 'record' (they ask the
 * participant to start a recording; the phone asks the participant) and 'record-stop'
 * (they stop a recording they asked for). Every other event from the viewer is
 * ignored.
 *
 * The caller must have run `await client.realtime.setAuth()` first, so the join
 * carries the participant's token rather than the anon key (which is refused).
 * Nothing is sent until the channel is joined: an unjoined send would fall back to a
 * REST request per batch.
 */
export interface ViewerRequests { stop(): void; record(): void; recordStop(): void }

export function openLiveChannel(client: SupabaseClient, grantId: string, viewer: ViewerRequests): LiveLink {
  const channel = client.channel(`live:${grantId.toLowerCase()}`, {
    config: { private: true, broadcast: { self: false } },
  });
  const v1 = (msg: { payload?: unknown }) => (msg.payload as { v?: unknown } | undefined)?.v === 1;
  channel.on('broadcast', { event: 'stop' }, (msg: { payload?: unknown }) => { if (v1(msg)) viewer.stop(); });
  channel.on('broadcast', { event: 'record' }, (msg: { payload?: unknown }) => { if (v1(msg)) viewer.record(); });
  channel.on('broadcast', { event: 'record-stop' }, (msg: { payload?: unknown }) => { if (v1(msg)) viewer.recordStop(); });
  let subscribed = false;
  let closing = false;
  channel.subscribe((status, err) => {
    subscribed = status === 'SUBSCRIBED';
    /* CLOSED after our own close() is expected, not worth a warning. */
    if (__DEV__ && !subscribed && !closing) console.warn(`[wearwise] live view channel ${status}`, err?.message ?? '');
  });
  /* Joined right now: a dropped socket leaves the subscribe state stale until rejoin. */
  const ready = () => subscribed && channel.state === 'joined';
  return {
    ready,
    async send(event: 'samples' | 'status' | 'fall' | 'record', payload: object) {
      if (!ready()) return;
      try { await channel.send({ type: 'broadcast', event, payload }); } catch { /* live: the next batch follows */ }
    },
    async close() {
      closing = true;
      subscribed = false;
      try { await client.removeChannel(channel); } catch { /* already gone */ }
    },
  };
}
