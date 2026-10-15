import { Platform, Vibration } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

/* The fall alarm's sound and vibration: loud enough to notice, until the wearer
 * answers it. The sound plays even with the phone on silent (it is an alarm, like a
 * timer going off) and ducks other audio rather than stopping it. Either can be
 * switched off in Profile; the caller passes that choice in.
 *
 * expo-audio is loaded lazily and only when its native module is in the installed
 * build (an older dev client has none); without it the alarm still vibrates.
 */

type AudioApi = typeof import('expo-audio');
type Player = ReturnType<AudioApi['createAudioPlayer']>;

let audio: AudioApi | null | undefined;
function loadAudio(): AudioApi | null {
  if (audio !== undefined) return audio;
  try {
    audio = requireOptionalNativeModule('ExpoAudio') != null
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberately lazy: see the header
      ? (require('expo-audio') as AudioApi)
      : null;
  } catch {
    audio = null;
  }
  return audio;
}

const ALARM_SOUND = require('../../../assets/sounds/fall_alarm.wav') as number;

/* Long buzzes with gaps, repeated. iOS ignores the lengths (it buzzes for ~0.4 s at
   each step) but keeps the rhythm. */
const ALARM_VIBRATION = Platform.OS === 'android' ? [0, 800, 400, 800, 1200] : [0, 1000, 1000];
const SHORT_VIBRATION = [0, 400, 200, 400];

let player: Player | null = null;

/** Starts the alarm. `loop: false` sounds it once with a short buzz (a simulated fall). */
export function startAlarm({ loop, sound, vibration }: { loop: boolean; sound: boolean; vibration: boolean }): void {
  stopAlarm();
  /* A build without the vibrate permission throws here; the sound must still play. */
  if (vibration) try { Vibration.vibrate(loop ? ALARM_VIBRATION : SHORT_VIBRATION, loop); } catch { /* no buzz */ }
  const a = sound ? loadAudio() : null;
  if (!a) return;
  try {
    void a.setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: false }).catch(() => undefined);
    const p = a.createAudioPlayer(ALARM_SOUND);
    p.loop = loop;
    p.volume = 1;
    p.play();
    player = p;
  } catch {
    player = null; // no sound is better than a crash; the vibration still runs
  }
}

export function stopAlarm(): void {
  try { Vibration.cancel(); } catch { /* nothing buzzing */ }
  if (!player) return;
  try { player.pause(); player.remove(); } catch { /* already released */ }
  player = null;
}
