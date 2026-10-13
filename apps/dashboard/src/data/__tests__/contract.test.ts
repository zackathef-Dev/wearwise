import { describe, expect, test } from 'vitest';
import { checkShareCode, formatShareCodeInput } from '../share-code';
import { toChannel, toFall, toRedeemResult, toSession, toSharedParticipant } from '../rows';
import { sessionTimeline } from '../timeline';

/* The backend contract, as the dashboard reads it. Rows here are shaped like
   PostgREST's JSON for the columns in 20261014000005_data_sharing.sql and earlier. */

describe('share codes', () => {
  test('formats as the participant sees it', () => {
    expect(formatShareCodeInput('abcde')).toBe('ABCDE');
    expect(formatShareCodeInput('abcdefg')).toBe('ABCDE-FG');
    expect(formatShareCodeInput(' abc de-fghjk extra')).toBe('ABCDE-FGHJK');
  });

  test('catches codes that cannot be valid before they cost a rate-limit attempt', () => {
    expect(checkShareCode('abcde-fghjk')).toEqual({ ok: true, code: 'ABCDE-FGHJK' });
    expect(checkShareCode('ABCDEFGHJK')).toEqual({ ok: true, code: 'ABCDE-FGHJK' });
    expect(checkShareCode('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkShareCode('ABCDE-FGH')).toMatchObject({ ok: false, reason: 'length' });
    expect(checkShareCode('ABCD0-FGHIK')).toMatchObject({ ok: false, reason: 'characters', invalid: ['0', 'I'] });
  });
});

describe('row mappers', () => {
  test('list_shared_participants row', () => {
    expect(toSharedParticipant({
      grant_id: 'g1', participant_id: 'p1', participant_name: '  Sam ', participant_email: null,
      sensor_types: [1, 5], include_falls: true, shared_since: '2026-10-13T01:00:00+00:00',
      last_session_at: null, session_count: 3,
    })).toEqual({
      grantId: 'g1', participantId: 'p1', name: 'Sam', sensorTypes: [1, 5],
      includeFalls: true, sharedSince: '2026-10-13T01:00:00+00:00', lastSessionAt: null, sessionCount: 3,
    });
  });

  test('redeem_share_code jsonb', () => {
    expect(toRedeemResult({ ok: true, grant_id: 'g1', participant_name: '' })).toEqual({ ok: true, grantId: 'g1', participantName: '' });
    expect(toRedeemResult({ ok: false, reason: 'rate_limited' })).toEqual({ ok: false, reason: 'rate_limited' });
    expect(toRedeemResult({ ok: false, reason: 'invalid_or_expired' })).toEqual({ ok: false, reason: 'invalid_or_expired' });
    expect(toRedeemResult(null)).toEqual({ ok: false, reason: 'invalid_or_expired' });
  });

  test('recorded_channels keeps u64 timestamps exact', () => {
    const c = toChannel({
      id: 'c1', session_id: 's1', sensor_type: 1, canonical_unit: 'mV', sample_rate_hz: 250, sample_count: '90000',
      minimum_value: -0.5, maximum_value: 1.2, average_value: null,
      first_timestamp_us: '18446744073709551615', last_timestamp_us: null, storage_path: 'u/s1/c1.wwch',
    });
    expect(c.firstTimestampUs).toBe(18446744073709551615n);
    expect(c.lastTimestampUs).toBeNull();
    expect(c.sampleCount).toBe(90000);
    expect(c.avg).toBeNull();
  });

  test('recorded_sessions and fall_events', () => {
    expect(toSession({
      id: 's1', user_id: 'p1', started_at: 'a', ended_at: null, duration_ms: '61000', status: 'interrupted',
      simulated: true, device_name: 'WearWise-6280', firmware_version: null,
    })).toMatchObject({ durationMs: 61000, status: 'interrupted', simulated: true, deviceName: 'WearWise-6280', firmwareVersion: null });
    expect(toFall({
      id: 'f1', session_id: 's1', detected_at_ms: '4200', freefall_min_g: 0.1, impact_peak_g: 3.2, status: 'emergency', created_at: 'x',
    })).toMatchObject({ detectedAtMs: 4200, impactPeakG: 3.2, status: 'emergency' });
  });
});

describe('session timeline', () => {
  const ch = (first: bigint | null, last: bigint | null) => toChannel({
    id: 'c', session_id: 's', sensor_type: 1, sample_rate_hz: 250, sample_count: 1, storage_path: 'p',
    first_timestamp_us: first?.toString() ?? null, last_timestamp_us: last?.toString() ?? null,
  });

  test('all channels share one origin: the earliest first sample', () => {
    const t = sessionTimeline([ch(5_000_000n, 65_000_000n), ch(4_500_000n, 64_000_000n)], [], 61_000);
    expect(t.originUs).toBe(4_500_000n);
    expect(t.end).toBeCloseTo(60.5, 9);
  });

  test('extends to show a fall after the last sample; falls back to the duration with no samples', () => {
    expect(sessionTimeline([ch(0n, 10_000_000n)], [toFall({ detected_at_ms: 12_000 })], null).end).toBeGreaterThan(12);
    expect(sessionTimeline([], [], 42_000)).toMatchObject({ originUs: null, end: 42 });
  });
});
