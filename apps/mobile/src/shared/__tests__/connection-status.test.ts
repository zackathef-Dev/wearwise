import { describeConnection } from '../connection-status';

describe('describeConnection', () => {
  test('names the link carrying the data', () => {
    expect(describeConnection('connected_wifi', 'wifi')).toMatchObject({ text: 'Connected · Wi-Fi', icon: 'wifi', connected: true });
    expect(describeConnection('connected_ble', 'bluetooth')).toMatchObject({ text: 'Connected · Bluetooth', icon: 'bluetooth', connected: true });
  });

  test('a simulated session never claims a radio link', () => {
    expect(describeConnection('connected_ble', 'simulation')).toMatchObject({ text: 'Connected · Simulated', connected: true });
  });

  test('transitional and lost states read as not connected, in words', () => {
    expect(describeConnection('connecting_wifi', 'bluetooth')).toMatchObject({ text: 'Joining Wi-Fi…', connected: false });
    expect(describeConnection('reconnecting', 'bluetooth')).toMatchObject({ text: 'Reconnecting…', connected: false });
    expect(describeConnection('failed', 'bluetooth')).toMatchObject({ text: 'Connection lost', connected: false });
    expect(describeConnection(undefined, undefined)).toMatchObject({ text: 'Disconnected', connected: false });
  });
});
