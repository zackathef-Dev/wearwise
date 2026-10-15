import { refusedPairingHelp } from '../pairing-help';

describe('refusedPairingHelp', () => {
  it('opens with one line that fits the Home card, then numbered steps', () => {
    const text = refusedPairingHelp('android', 'WearWise-6280');
    const lines = text.split('\n');
    expect(lines[0]).toBe('The patch didn’t accept this device.');
    expect(lines.filter((l) => /^\d\. /.test(l))).toHaveLength(3);
    expect(text).toContain('BOOT');
    expect(text).toContain('6-digit PIN');
  });

  it('names the right Bluetooth setting for each platform', () => {
    expect(refusedPairingHelp('ios', 'WearWise-6280')).toContain('Forget This Device');
    expect(refusedPairingHelp('android', 'WearWise-6280')).toContain('Unpair');
    expect(refusedPairingHelp('android', 'WearWise-6280')).toContain('WearWise-6280');
    expect(refusedPairingHelp('ios')).toContain('the patch is listed');
  });
});
