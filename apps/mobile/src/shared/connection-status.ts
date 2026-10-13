import type { TransportConnectionState } from '@/domain/repositories/sensor-transport';
import type { IconName } from '@/shared/icons/icon-data';

/* One wording for the link to the patch, shared by every screen that shows it, so
 * "how is my data travelling right now" always reads the same — in words, with an
 * icon alongside, never colour alone. */
export interface ConnectionStatus {
  text: string;
  icon: IconName;
  connected: boolean;
}

export function describeConnection(
  state: TransportConnectionState | string | null | undefined,
  transportType: string | null | undefined,
): ConnectionStatus {
  switch (state) {
    case 'connected_wifi':
      return { text: 'Connected · Wi-Fi', icon: 'wifi', connected: true };
    case 'connected_ble':
      return transportType === 'simulation'
        ? { text: 'Connected · Simulated', icon: 'cpu', connected: true }
        : { text: 'Connected · Bluetooth', icon: 'bluetooth', connected: true };
    case 'provisioning_wifi':
    case 'connecting_wifi':
      return { text: 'Joining Wi-Fi…', icon: 'wifi', connected: false };
    case 'switching_transport':
      return { text: 'Switching connection…', icon: 'bluetooth-searching', connected: false };
    case 'scanning':
    case 'connecting':
      return { text: 'Connecting…', icon: 'bluetooth-searching', connected: false };
    case 'reconnecting':
      return { text: 'Reconnecting…', icon: 'bluetooth-searching', connected: false };
    case 'failed':
      return { text: 'Connection lost', icon: 'bluetooth-off', connected: false };
    default:
      return { text: 'Disconnected', icon: 'bluetooth-off', connected: false };
  }
}
