import type { SessionStore } from '@/domain/repositories/session-store';
import { MemorySessionStore } from './memory-session-store';
import { SqliteSessionStore } from './sqlite-session-store';
import { getOrCreateDatabaseKey } from '@/platform/secure-storage/database-key';

/* Which SessionStore the app runs on, and WHY.
 *
 * `encrypted` is the only mode that persists. If the encrypted database cannot
 * be opened — keystore unavailable, corrupt file, native module missing in a
 * test build — the app runs on memory and the UI says so in words: "Recordings
 * will not be kept after you close the app." There is no plaintext-on-disk
 * fallback anywhere in this codebase (build-instruction §25: "If encryption
 * cannot be implemented correctly, report the blocker. Do not silently use
 * plaintext storage.").
 */

export type StorageMode = 'encrypted' | 'memory-only';

export interface OpenedStore {
  store: SessionStore;
  mode: StorageMode;
  /* Why memory-only, when it is. User-safe text — no paths, no stack traces. */
  reason: string | null;
  /* Path of the encrypted file, for the verification script. */
  path: string | null;
}

let opened: Promise<OpenedStore> | null = null;

export function openSessionStore(): Promise<OpenedStore> {
  if (!opened) {
    opened = (async () => {
      try {
        const key = await getOrCreateDatabaseKey();
        const store = await SqliteSessionStore.open(key);
        return { store, mode: 'encrypted', reason: null, path: store.path() };
      } catch (e) {
        if (__DEV__) console.warn('[wearwise] encrypted store unavailable, running memory-only:', e);
        return {
          store: new MemorySessionStore(), mode: 'memory-only',
          reason: 'Secure storage could not be opened on this device. Recordings will not be kept after you close the app.',
          path: null,
        };
      }
    })();
  }
  return opened;
}

/* Tests and the recovery flow may need a fresh instance. */
export function resetSessionStoreForTests(): void { opened = null; }
