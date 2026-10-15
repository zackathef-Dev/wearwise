import { Linking, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type * as ExpoNotifications from 'expo-notifications';

/* Notifications on this phone (local only: no push, no server, no token), over
 * expo-notifications.
 *
 * expo-notifications needs its native code, which only an app rebuilt since it was
 * added has. In an older build, merely importing it throws (each of its modules calls
 * requireNativeModule as it loads), so it is loaded lazily, and only after checking its
 * native modules are there. Without them every call here is a quiet no-op and
 * notificationsAvailable() is false: the app runs exactly as before.
 */

type Api = typeof ExpoNotifications;

export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';
export interface PermissionInfo {
  status: NotificationPermission;
  /* False once the system will not show its prompt again (the person said no, or
     turned notifications off in Settings): only Settings can turn them on then. */
  canAskAgain: boolean;
}

export interface ChannelSpec {
  id: string;
  name: string;
  description: string;
  importance: 'max' | 'high' | 'default';
  /** 'default' = the system sound, 'none' = silent, otherwise a sound bundled by the config plugin */
  sound: string;
  vibration: readonly number[];
}

/* What to do with a notification that arrives while the app is open. */
export interface Presentation {
  banner: boolean;
  list: boolean;
  sound: boolean;
}

export interface NotificationTap {
  id: string;
  data: Record<string, unknown>;
}

/* The modules expo-notifications binds when it loads (the channel managers on Android
   only). They ship together, so this is belt and braces around the try/catch below. */
const NATIVE_MODULES = [
  'ExpoNotificationPresenter', 'ExpoNotificationScheduler', 'ExpoNotificationsHandlerModule', 'ExpoNotificationsEmitter',
  'ExpoNotificationPermissionsModule', 'ExpoPushTokenManager', 'NotificationsServerRegistrationModule', 'ExpoBadgeModule',
  'ExpoNotificationCategoriesModule', 'ExpoBackgroundNotificationTasksModule',
  ...(Platform.OS === 'android' ? ['ExpoNotificationChannelManager', 'ExpoNotificationChannelGroupManager'] : []),
];

let api: Api | null | undefined;

function load(): Api | null {
  if (api !== undefined) return api;
  try {
    api = NATIVE_MODULES.every((name) => requireOptionalNativeModule(name) != null)
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately lazy: see the header
      ? (require('expo-notifications') as Api)
      : null;
  } catch {
    api = null;
  }
  if (!api && __DEV__) console.info('[wearwise] phone notifications are not in this build; rebuild the app to enable them');
  return api;
}

export const notificationsAvailable = (): boolean => load() != null;

const toInfo = (p: { status: string; canAskAgain: boolean; granted: boolean }): PermissionInfo => ({
  status: p.granted ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined',
  canAskAgain: p.canAskAgain,
});

export async function getNotificationPermission(): Promise<PermissionInfo> {
  const n = load();
  if (!n) return { status: 'unavailable', canAskAgain: false };
  try { return toInfo(await n.getPermissionsAsync()); } catch { return { status: 'unavailable', canAskAgain: false }; }
}

/* Shows the system prompt if it still can. Android 13+ only prompts once the app has a
   notification channel, so channels are created first. */
export async function requestNotificationPermission(channels: ChannelSpec[]): Promise<PermissionInfo> {
  const n = load();
  if (!n) return { status: 'unavailable', canAskAgain: false };
  try {
    await ensureChannels(n, channels);
    return toInfo(await n.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
  } catch {
    return getNotificationPermission();
  }
}

let channelsReady = '';
async function ensureChannels(n: Api, channels: ChannelSpec[]): Promise<void> {
  const key = channels.map((c) => c.id).join();
  if (channelsReady === key || Platform.OS !== 'android') return;
  for (const c of channels) {
    await n.setNotificationChannelAsync(c.id, {
      name: c.name,
      description: c.description,
      importance: c.importance === 'max' ? n.AndroidImportance.MAX
        : c.importance === 'high' ? n.AndroidImportance.HIGH : n.AndroidImportance.DEFAULT,
      /* On a channel `sound` names a bundled file (res/raw); leaving it out gives the
         system's default sound and null makes the channel silent. */
      ...(c.sound === 'none' ? { sound: null } : c.sound === 'default' ? {} : { sound: c.sound }),
      enableVibrate: c.vibration.length > 0,
      ...(c.vibration.length ? { vibrationPattern: [...c.vibration] } : {}),
      lockscreenVisibility: n.AndroidNotificationVisibility.PRIVATE,
    });
  }
  channelsReady = key;
}

/** Removes channels the app no longer posts to (Android; a no-op elsewhere). */
export async function deleteChannels(ids: string[]): Promise<void> {
  const n = load();
  if (!n || Platform.OS !== 'android') return;
  const existing = new Set((await n.getNotificationChannelsAsync().catch(() => [])).map((c) => c.id));
  for (const id of ids) if (existing.has(id)) await n.deleteNotificationChannelAsync(id).catch(() => undefined);
  channelsReady = '';
}

/* How notifications that arrive while the app is open are shown. Set once, early. */
export function setForegroundPresentation(decide: (data: Record<string, unknown>) => Presentation): void {
  const n = load();
  if (!n) return;
  n.setNotificationHandler({
    handleNotification: async (notification) => {
      const p = decide((notification.request.content.data ?? {}) as Record<string, unknown>);
      return { shouldShowBanner: p.banner, shouldShowList: p.list, shouldPlaySound: p.sound, shouldSetBadge: false };
    },
  });
}

/* Show a notification now. Resolves quietly if it can't (no permission, no module). */
export async function presentNotification(note: {
  title: string; body: string; channelId: string; channels: ChannelSpec[]; data: Record<string, string>; color?: string;
  /** iOS plays this ('default', 'none' or a bundled file); Android uses the channel's */
  sound: string;
}): Promise<void> {
  const n = load();
  if (!n) return;
  try {
    /* Without permission the OS refuses it anyway; say nothing rather than log an error. */
    if (!(await n.getPermissionsAsync()).granted) return;
    await ensureChannels(n, note.channels);
    await n.scheduleNotificationAsync({
      content: {
        title: note.title, body: note.body, data: note.data,
        /* true = the system's default sound; a string names a bundled file (on Android
           'default' would be looked up as a file called "default" and fail). */
        sound: note.sound === 'none' ? false : note.sound === 'default' ? true : note.sound,
        ...(note.color ? { color: note.color } : {}),
      },
      trigger: Platform.OS === 'android' ? { channelId: note.channelId } : null,
    });
  } catch (e) {
    if (__DEV__) console.warn('[wearwise] notification not shown:', e instanceof Error ? e.message : e);
  }
}

/* Clears this app's notifications from the notification centre (after sign-out, they
   would still say what happened to the previous account). */
export async function dismissAllNotifications(): Promise<void> {
  const n = load();
  if (!n) return;
  await n.dismissAllNotificationsAsync().catch(() => undefined);
}

/* Taps on a notification (its body, not an action button). */
export function onNotificationTap(listener: (tap: NotificationTap) => void): () => void {
  const n = load();
  if (!n) return () => {};
  const sub = n.addNotificationResponseReceivedListener((r) => {
    if (r.actionIdentifier !== n.DEFAULT_ACTION_IDENTIFIER) return;
    listener({ id: r.notification.request.identifier, data: (r.notification.request.content.data ?? {}) as Record<string, unknown> });
  });
  return () => sub.remove();
}

/* The tap that opened the app from closed, if any — handed out once. */
export function takeLaunchTap(): NotificationTap | null {
  const n = load();
  if (!n) return null;
  try {
    const r = n.getLastNotificationResponse();
    if (!r || r.actionIdentifier !== n.DEFAULT_ACTION_IDENTIFIER) return null;
    n.clearLastNotificationResponse();
    return { id: r.notification.request.identifier, data: (r.notification.request.content.data ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/* The app's page in the phone's Settings, where notifications are turned back on. */
export function openNotificationSettings(): void {
  Linking.openSettings().catch(() => {});
}
