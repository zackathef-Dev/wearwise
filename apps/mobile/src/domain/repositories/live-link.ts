/* One viewer's live-view channel — the port live view sends through. The Supabase
 * Realtime implementation is data/remote/live-channel.ts; tests use a fake.
 * Payloads are the contract's events (features/live-view/live-view-core.ts).
 */
export interface LiveLink {
  /* Joined and able to send right now. */
  ready(): boolean;
  /* Fire and forget: resolves whether or not it got through (it's live data). */
  send(event: 'samples' | 'status' | 'fall' | 'record', payload: object): Promise<void>;
  /* Leave the channel. */
  close(): Promise<void>;
}
