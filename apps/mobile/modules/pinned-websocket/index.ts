import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/* A wss:// WebSocket pinned to ONE certificate: the sensor's self-signed one, by the
 * SHA-256 of its DER encoding (read over Bluetooth). Native on both platforms
 * (Kotlin/OkHttp on Android, Swift/URLSession on iOS) because React Native's built-in
 * WebSocket can only trust public CAs.
 *
 * The surface mimics the browser WebSocket closely enough for the Wi-Fi transport:
 * onopen / onmessage / onerror / onclose, send(text), close(). Binary frames arrive
 * as base64 strings in `ev.data` (the transport already decodes those).
 */

interface NativeEvents {
  onOpen: (e: { id: string }) => void;
  onMessage: (e: { id: string; data: string }) => void;
  onClose: (e: { id: string; code: number }) => void;
  onError: (e: { id: string; message: string; pinMismatch: boolean }) => void;
}

interface PinnedWebSocketNative {
  connect(id: string, url: string, pinSha256Hex: string): void;
  send(id: string, text: string): boolean;
  close(id: string): void;
  addListener<K extends keyof NativeEvents>(event: K, listener: NativeEvents[K]): EventSubscription;
}

/* Looked up on first use, not at import time, so nothing breaks just because the
   file was imported before the native side is ready. */
let resolved: PinnedWebSocketNative | null | undefined;
function nativeModule(): PinnedWebSocketNative | null {
  if (resolved === undefined) resolved = requireOptionalNativeModule<PinnedWebSocketNative>('PinnedWebSocket');
  return resolved;
}

/* False in a build made before this module existed (e.g. an older installed APK). */
export const pinnedWebSocketAvailable = (): boolean => nativeModule() != null;

/* One native subscription per event for the whole app, routed to sockets by id. */
const live = new Map<string, PinnedWebSocket>();
let subscribed = false;
function subscribe(n: PinnedWebSocketNative) {
  if (subscribed) return;
  subscribed = true;
  n.addListener('onOpen', ({ id }) => live.get(id)?.onopen?.());
  n.addListener('onMessage', ({ id, data }) => live.get(id)?.onmessage?.({ data }));
  n.addListener('onClose', ({ id, code }) => { const s = live.get(id); live.delete(id); s?.onclose?.({ code }); });
  n.addListener('onError', ({ id, message, pinMismatch }) => {
    const s = live.get(id); live.delete(id);
    s?.onerror?.({ message, pinMismatch });
    s?.onclose?.({ code: 1006 });
  });
}

let nextId = 0;

export class PinnedWebSocket {
  /* Kept for WebSocket-shape compatibility; frames always arrive as base64. */
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: { message: string; pinMismatch: boolean }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  private readonly id = `pws-${++nextId}`;
  private readonly native: PinnedWebSocketNative;

  constructor(url: string, pinSha256Hex: string) {
    const Native = nativeModule();
    if (!Native) throw new Error('Encrypted Wi-Fi needs an app update (secure connection module missing).');
    if (!/^[0-9a-f]{64}$/i.test(pinSha256Hex)) throw new Error('Invalid sensor certificate fingerprint.');
    if (!url.startsWith('wss://')) throw new Error('Encrypted Wi-Fi requires a wss:// address.');
    this.native = Native;
    subscribe(Native);
    live.set(this.id, this);
    Native.connect(this.id, url, pinSha256Hex);
  }

  send(text: string): void { this.native.send(this.id, text); }

  close(): void {
    live.delete(this.id);
    this.native.close(this.id);
  }
}
