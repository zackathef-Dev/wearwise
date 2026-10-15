/* The rules behind phone notifications, kept free of React Native so they are tested
 * on their own (phone-notifications.ts does the posting; platform/notifications talks
 * to the OS).
 *
 * Three things reach the lock screen: a vital alert opening, a fall alarm, and the
 * sensor dropping out while a recording runs. Everything else stays in the in-app
 * notifications list (the bell), which is unchanged.
 */

export type PhoneNotificationKind = 'alert' | 'fall' | 'recording';

/* Sound and vibration follow how urgent it is:
     fall     the alarm tone (assets/sounds/fall_alarm.wav) and a long buzz, top
              priority: the wearer may need help, or needs to say they're OK
     alert    the phone's usual notification sound and two short buzzes
     recording no sound, one short buzz: worth knowing, not alarming
   Android groups notifications into channels the person can tune in Settings. Ids,
   sounds and importance are permanent once shipped (Android never updates them). */
export type ChannelSound = 'default' | 'none' | 'fall_alarm.wav';
export interface ChannelSpecRule {
  id: string; name: string; description: string;
  importance: 'max' | 'high' | 'default';
  sound: ChannelSound;
  vibration: number[];
}
const BASE = [
  {
    id: 'falls', name: 'Fall alarm', description: 'A possible fall: an alarm sound and a long vibration, so you can say you’re OK or get help.',
    importance: 'max', sound: 'fall_alarm.wav', vibration: [0, 800, 400, 800, 400, 800],
  },
  {
    id: 'health-alerts', name: 'Health alerts', description: 'A reading that stayed out of its usual range.',
    importance: 'high', sound: 'default', vibration: [0, 250, 200, 250],
  },
  {
    id: 'recording-problems', name: 'Recording problems', description: 'Your sensor disconnecting while you record.',
    importance: 'default', sound: 'none', vibration: [0, 200],
  },
] as const satisfies readonly ChannelSpecRule[];

/* The participant can turn alert sound and vibration off (Profile). Android never
   changes a channel's sound or vibration once it exists, so each combination is its
   own set of channels — the base id plus a suffix — and the app keeps only the set
   for the current choice (the others are deleted when the choice changes). */
export interface AlertFeedback { sound: boolean; vibration: boolean }
export const FEEDBACK_ON: AlertFeedback = { sound: true, vibration: true };
const VARIANTS = ['', '.nosound', '.novibration', '.silent'] as const;
const variant = (f: AlertFeedback) => (f.sound ? (f.vibration ? '' : '.novibration') : f.vibration ? '.nosound' : '.silent');

export function channelsFor(f: AlertFeedback): ChannelSpecRule[] {
  return BASE.map((c) => ({
    ...c,
    id: c.id + variant(f),
    sound: f.sound ? c.sound : 'none',
    vibration: f.vibration ? [...c.vibration] : [],
  }));
}

/** The channels as they are with sound and vibration on (and their permanent base ids). */
export const CHANNELS: ChannelSpecRule[] = channelsFor(FEEDBACK_ON);

/** Every channel id this app has ever made that isn't for this choice. */
export function obsoleteChannelIds(f: AlertFeedback): string[] {
  const current = new Set(channelsFor(f).map((c) => c.id));
  return BASE.flatMap((c) => VARIANTS.map((v) => c.id + v)).filter((id) => !current.has(id));
}

const baseFor = (kind: PhoneNotificationKind) => (kind === 'fall' ? 'falls' : kind === 'alert' ? 'health-alerts' : 'recording-problems');

export const channelFor = (kind: PhoneNotificationKind, f: AlertFeedback = FEEDBACK_ON): string => baseFor(kind) + variant(f);

/** The sound a notification asks for (iOS reads it from the notification; Android from the channel). */
export const soundFor = (kind: PhoneNotificationKind, f: AlertFeedback = FEEDBACK_ON): ChannelSound =>
  f.sound ? BASE.find((c) => c.id === baseFor(kind))!.sound : 'none';

const KINDS: readonly string[] = ['alert', 'fall', 'recording'] satisfies PhoneNotificationKind[];
const kindOf = (data: Record<string, unknown>): PhoneNotificationKind | null =>
  typeof data.kind === 'string' && KINDS.includes(data.kind) ? (data.kind as PhoneNotificationKind) : null;

/* While the app is open: alerts and falls still drop down as a banner — a fall or a
   high heart rate should be noticed whatever screen is showing. An alert plays its
   sound; a fall doesn't, because the open app is already sounding the fall alarm
   (platform/alarm) and two alarms at once would only be noise. A dropped sensor goes
   quietly into the notification list: the open app already shows the link state. */
export function presentationFor(
  data: Record<string, unknown>, f: AlertFeedback = FEEDBACK_ON,
): { banner: boolean; list: boolean; sound: boolean } {
  const kind = kindOf(data);
  if (kind === 'alert') return { banner: true, list: true, sound: f.sound };
  if (kind === 'fall') return { banner: true, list: true, sound: false };
  return { banner: false, list: true, sound: false };
}

/* Where a tapped notification may take the app. Only these in-app routes are accepted,
   whatever arrives in the notification's data. */
const ROUTES = [/^\/alerts$/, /^\/home$/, /^\/notifications$/, /^\/session\/[0-9a-f-]{36}$/i];
export function routeFromData(data: Record<string, unknown>): string | null {
  const route = data.route;
  return typeof route === 'string' && ROUTES.some((r) => r.test(route)) ? route : null;
}

/* Ask for permission without being asked to? Only once, only if phone notifications
   are on, and only while the system would still show its prompt. Later changes go
   through the Profile switch, which asks again or points to Settings. */
export function shouldAutoAsk(s: {
  enabled: boolean; available: boolean; status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  canAskAgain: boolean; askedBefore: boolean;
}): boolean {
  return s.enabled && s.available && s.status === 'undetermined' && s.canAskAgain && !s.askedBefore;
}
