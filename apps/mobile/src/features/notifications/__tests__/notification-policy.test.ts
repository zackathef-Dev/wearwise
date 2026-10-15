import { CHANNELS, channelFor, channelsFor, obsoleteChannelIds, presentationFor, routeFromData, shouldAutoAsk, soundFor } from '../notification-policy';

describe('phone notification policy', () => {
  it('gives each kind a channel whose sound and vibration match how urgent it is', () => {
    expect(channelFor('fall')).toBe('falls');
    expect(channelFor('alert')).toBe('health-alerts');
    expect(channelFor('recording')).toBe('recording-problems');
    expect(CHANNELS.map((c) => [c.id, c.importance, c.sound])).toEqual([
      ['falls', 'max', 'fall_alarm.wav'], ['health-alerts', 'high', 'default'], ['recording-problems', 'default', 'none'],
    ]);
    expect(soundFor('fall')).toBe('fall_alarm.wav');
    expect(soundFor('recording')).toBe('none');
    /* The fall buzz is the longest; a lost sensor gets one short buzz. */
    const buzz = (id: string) => (CHANNELS.find((c) => c.id === id)!.vibration as readonly number[]).reduce((a, b) => a + b, 0);
    expect(buzz('falls')).toBeGreaterThan(buzz('health-alerts'));
    expect(buzz('health-alerts')).toBeGreaterThan(buzz('recording-problems'));
  });

  it('makes a separate set of channels for each sound/vibration choice, and knows which to remove', () => {
    const quiet = { sound: false, vibration: true };
    expect(channelsFor(quiet).map((c) => [c.id, c.sound, c.vibration.length > 0])).toEqual([
      ['falls.nosound', 'none', true], ['health-alerts.nosound', 'none', true], ['recording-problems.nosound', 'none', true],
    ]);
    expect(channelsFor({ sound: true, vibration: false }).every((c) => c.vibration.length === 0)).toBe(true);
    expect(channelFor('fall', quiet)).toBe('falls.nosound');
    expect(soundFor('fall', quiet)).toBe('none');
    expect(channelFor('alert', { sound: false, vibration: false })).toBe('health-alerts.silent');
    const stale = obsoleteChannelIds(quiet);
    expect(stale).toContain('falls');
    expect(stale).toContain('health-alerts.silent');
    expect(stale).not.toContain('falls.nosound');
    expect(stale).toHaveLength(9);
    expect(presentationFor({ kind: 'alert' }, quiet).sound).toBe(false);
  });

  it('shows alerts and falls as a banner while the app is open (a fall’s sound is the in-app alarm); the rest only in the list', () => {
    expect(presentationFor({ kind: 'alert' })).toEqual({ banner: true, list: true, sound: true });
    expect(presentationFor({ kind: 'fall' })).toEqual({ banner: true, list: true, sound: false });
    expect(presentationFor({ kind: 'recording' })).toEqual({ banner: false, list: true, sound: false });
    expect(presentationFor({})).toEqual({ banner: false, list: true, sound: false });
    expect(presentationFor({ kind: 42 })).toEqual({ banner: false, list: true, sound: false });
  });

  it('opens only known in-app screens', () => {
    expect(routeFromData({ route: '/alerts' })).toBe('/alerts');
    expect(routeFromData({ route: '/home' })).toBe('/home');
    expect(routeFromData({ route: '/session/3f2b8c1e-0b7a-4d2e-9c1f-5a6b7c8d9e0f' })).toBe('/session/3f2b8c1e-0b7a-4d2e-9c1f-5a6b7c8d9e0f');
    expect(routeFromData({ route: 'https://evil.example' })).toBeNull();
    expect(routeFromData({ route: '/session/../privacy' })).toBeNull();
    expect(routeFromData({ route: '/alerts?x=1' })).toBeNull();
    expect(routeFromData({ route: 7 })).toBeNull();
    expect(routeFromData({})).toBeNull();
  });

  it('asks on its own only once, only when on, and only while the system would still prompt', () => {
    const base = { enabled: true, available: true, status: 'undetermined' as const, canAskAgain: true, askedBefore: false };
    expect(shouldAutoAsk(base)).toBe(true);
    expect(shouldAutoAsk({ ...base, askedBefore: true })).toBe(false);
    expect(shouldAutoAsk({ ...base, enabled: false })).toBe(false);
    expect(shouldAutoAsk({ ...base, available: false })).toBe(false);
    expect(shouldAutoAsk({ ...base, status: 'granted' })).toBe(false);
    expect(shouldAutoAsk({ ...base, status: 'denied' })).toBe(false);
    expect(shouldAutoAsk({ ...base, canAskAgain: false })).toBe(false);
  });
});
