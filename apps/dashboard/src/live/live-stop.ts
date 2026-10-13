import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../data/client';

/* The live channel each open Live view has joined, so "Stop live view" and "Remove
 * participant" can tell the phone to stop sending to this viewer: one 'stop' event on
 * `live:<grantId>`, the only thing the phone accepts from a viewer
 * (docs/architecture/live-view-and-alerts.md §2).
 */

const joined = new Map<string, RealtimeChannel>();
const STOP_TIMEOUT_MS = 5_000;
const JOIN_TIMEOUT_MS = 5_000;

/** Called by Live view once its channel is joined; the returned function forgets it. */
export function rememberLiveChannel(grantId: string, channel: RealtimeChannel): () => void {
  const key = grantId.toLowerCase();
  joined.set(key, channel);
  return () => { if (joined.get(key) === channel) joined.delete(key); };
}

/** One of the three things a viewer may ask the phone (contract §2): stop live view for
 *  them, start a recording (the participant is asked), or stop the recording they asked
 *  for. False if the channel isn't joined or the server didn't take it. */
export async function sendToPhone(grantId: string, event: 'stop' | 'record' | 'record-stop'): Promise<boolean> {
  const channel = joined.get(grantId.toLowerCase());
  if (!channel || channel.state !== 'joined') return false;
  try {
    /* The channel is joined with ack, so 'ok' means the server took it (checked against
       the grant), not just that it left this browser. */
    return (await channel.send({ type: 'broadcast', event, payload: { v: 1 } }, { timeout: STOP_TIMEOUT_MS })) === 'ok';
  } catch {
    return false;
  }
}

/** Asks the phone to stop live view for this viewer. */
export const sendLiveStop = (grantId: string): Promise<boolean> => sendToPhone(grantId, 'stop');

/** Stop live view for this viewer before their access ends (Remove participant). Uses
 *  the open Live view's channel if there is one, otherwise joins the channel just to
 *  send the stop. Best effort: if it can't get through, the phone still stops at its
 *  next check of who may watch (within 30 s). Resolves once the stop is through, or
 *  has failed, so the caller can revoke the grant afterwards and not before. */
export async function stopLiveFor(grantId: string): Promise<void> {
  if (await sendLiveStop(grantId)) return;
  const client = supabase;
  if (!client) return;
  let channel: RealtimeChannel | null = null;
  try {
    await client.realtime.setAuth();
    const ch = client.channel(`live:${grantId.toLowerCase()}`, { config: { private: true, broadcast: { self: false, ack: true } } });
    channel = ch;
    const ready = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), JOIN_TIMEOUT_MS);
      ch.subscribe((state) => {
        if (state === 'SUBSCRIBED') { window.clearTimeout(timer); resolve(true); }
        else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') { window.clearTimeout(timer); resolve(false); }
      });
    });
    if (ready) await ch.send({ type: 'broadcast', event: 'stop', payload: { v: 1 } }, { timeout: STOP_TIMEOUT_MS });
  } catch {
    /* best effort, see above */
  } finally {
    if (channel) await client.removeChannel(channel).catch(() => undefined);
  }
}
