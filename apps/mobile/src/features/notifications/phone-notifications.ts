import { create } from 'zustand';
import { prefs } from '@/platform/kv/kv';
import {
  notificationsAvailable, getNotificationPermission, requestNotificationPermission, presentNotification,
  setForegroundPresentation, deleteChannels, type NotificationPermission,
} from '@/platform/notifications/notifications';
import {
  channelFor, channelsFor, obsoleteChannelIds, presentationFor, shouldAutoAsk, soundFor,
  type AlertFeedback, type PhoneNotificationKind,
} from './notification-policy';

/* Phone notifications: the participant's on/off switch (Profile, on by default), the
 * system permission, and posting. Monitoring calls postPhoneNotification() next to its
 * in-app notice; nothing is shown while the switch is off or permission is missing.
 *
 * Permission is never asked for at app start. It is asked once, the first time the
 * participant connects a sensor or starts a recording themselves — the moment alerts
 * start to matter — and again whenever they turn the Profile switch on.
 */

const PREF_ENABLED = 'notifications.phone.enabled';
const PREF_ASKED = 'notifications.phone.asked';
/* Alert sound and vibration (Profile): the fall alarm and phone notifications. On by default. */
const PREF_SOUND = 'alerts.sound';
const PREF_VIBRATION = 'alerts.vibration';
/* Android accent for the small icon: the brand teal. */
const ACCENT = '#18B6A4';

const readEnabled = () => prefs.getString(PREF_ENABLED) !== '0';
const readOn = (key: string) => prefs.getString(key) !== '0';

interface PhoneNotificationsState {
  /* The participant's choice. */
  enabled: boolean;
  /* The system's answer; 'unavailable' in a build without the native module. */
  permission: NotificationPermission;
  canAskAgain: boolean;
  /* Re-read the permission (it can change in Settings while the app is away). */
  refresh(): Promise<void>;
  setEnabled(on: boolean): Promise<void>;
  /* Alert sound and vibration, for the fall alarm and phone notifications. */
  sound: boolean;
  vibration: boolean;
  setFeedback(patch: Partial<AlertFeedback>): void;
}

const feedbackOf = (s: { sound: boolean; vibration: boolean }): AlertFeedback => ({ sound: s.sound, vibration: s.vibration });

export const usePhoneNotifications = create<PhoneNotificationsState>((set, get) => ({
  enabled: readEnabled(),
  permission: 'undetermined',
  canAskAgain: true,
  sound: readOn(PREF_SOUND),
  vibration: readOn(PREF_VIBRATION),

  setFeedback(patch) {
    const next = { ...feedbackOf(get()), ...patch };
    prefs.set(PREF_SOUND, next.sound ? '1' : '0');
    prefs.set(PREF_VIBRATION, next.vibration ? '1' : '0');
    set(next);
    /* The new channels are made on the next notification; drop the old ones now. */
    void deleteChannels(obsoleteChannelIds(next));
  },

  async refresh() {
    const p = await getNotificationPermission();
    set({ permission: p.status, canAskAgain: p.canAskAgain });
  },

  async setEnabled(on) {
    prefs.set(PREF_ENABLED, on ? '1' : '0');
    set({ enabled: on });
    if (!on) return;
    const current = await getNotificationPermission();
    if (current.status !== 'granted' && current.canAskAgain) {
      prefs.set(PREF_ASKED, '1');
      const p = await requestNotificationPermission(channelsFor(feedbackOf(get())));
      set({ permission: p.status, canAskAgain: p.canAskAgain });
      return;
    }
    set({ permission: current.status, canAskAgain: current.canAskAgain });
  },
}));

/* The first time it makes sense (see header): ask, once. Never throws. */
export async function askForPhoneNotificationsOnce(): Promise<void> {
  try {
    const { enabled } = usePhoneNotifications.getState();
    const askedBefore = prefs.getString(PREF_ASKED) === '1';
    if (!enabled || askedBefore) return;
    const p = await getNotificationPermission();
    if (!shouldAutoAsk({ enabled, available: notificationsAvailable(), status: p.status, canAskAgain: p.canAskAgain, askedBefore })) {
      usePhoneNotifications.setState({ permission: p.status, canAskAgain: p.canAskAgain });
      return;
    }
    prefs.set(PREF_ASKED, '1');
    const after = await requestNotificationPermission(channelsFor(feedbackOf(usePhoneNotifications.getState())));
    usePhoneNotifications.setState({ permission: after.status, canAskAgain: after.canAskAgain });
  } catch { /* the in-app list still has everything */ }
}

let configured = false;
/* Once, early: how notifications show while the app is open. Asks nothing. */
export function configurePhoneNotifications(): void {
  if (configured) return;
  configured = true;
  setForegroundPresentation((data) => presentationFor(data, feedbackOf(usePhoneNotifications.getState())));
  /* Sound or vibration may have been switched since the channels were made. */
  void deleteChannels(obsoleteChannelIds(feedbackOf(usePhoneNotifications.getState())));
}

/* Show one on the phone, if the participant wants them. Fire and forget. */
export function postPhoneNotification(kind: PhoneNotificationKind, title: string, body: string, route: string | null): void {
  const state = usePhoneNotifications.getState();
  if (!state.enabled || !notificationsAvailable()) return;
  configurePhoneNotifications();
  const f = feedbackOf(state);
  void presentNotification({
    title, body, channelId: channelFor(kind, f), channels: channelsFor(f), color: ACCENT, sound: soundFor(kind, f),
    data: route ? { kind, route } : { kind },
  });
}
