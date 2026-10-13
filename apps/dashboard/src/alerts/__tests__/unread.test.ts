import { describe, expect, it } from 'vitest';
import { alertTitle, alertValue } from '../../data/alert-text';
import type { AlertItem } from '../../data/types';
import { arrivals, countUnread } from '../unread';

const alert = (id: string, at: string, o: Partial<AlertItem> = {}): AlertItem => ({
  id, kind: 'low', participantId: 'p', sessionId: null, sensorType: 2, value: 91, at, endedAt: null,
  fallStatus: null, detectedAtMs: null, ...o,
});

describe('unread and arrivals', () => {
  const a = alert('a', '2026-10-13T10:00:00Z');
  const b = alert('b', '2026-10-13T10:05:00Z');
  it('counts what happened after the last visit', () => {
    expect(countUnread([a, b], Date.parse('2026-10-13T10:01:00Z'))).toBe(1);
    expect(countUnread([a, b], 0)).toBe(2);
  });
  it('notifies only for new, recent rows', () => {
    const now = Date.parse('2026-10-13T10:06:00Z');
    const old = alert('old', '2026-10-01T10:00:00Z');
    expect(arrivals([a], [a, b, old], now).map((x) => x.id)).toEqual(['b']);
  });
});

describe('alert text', () => {
  it('uses the phone app’s words', () => {
    expect(alertTitle({ kind: 'low', sensorType: 2 })).toBe('Low blood oxygen');
    expect(alertValue({ kind: 'low', sensorType: 2, value: 90.6 })).toBe('lowest 91 %');
    expect(alertTitle({ kind: 'fall', sensorType: null })).toBe('Fall detected');
    expect(alertValue({ kind: 'fall', sensorType: null, value: 3.24 })).toBe('impact 3.2 g');
    expect(alertTitle({ kind: 'high', sensorType: 4 })).toBe('High heart rate');
  });
});
