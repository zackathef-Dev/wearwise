#!/usr/bin/env node
/* Generates the SIMULATED demo recordings for the local seed:
 *
 *   supabase/seed/demo-recordings.sql                   rows: sessions, channels, alerts, fall
 *   supabase/seed/recordings/<user>/<session>/<channel>.wwch   the channel files for Storage
 *
 * Run it again only if you change it (the output is committed and deterministic):
 *   node supabase/scripts/generate-demo-recordings.mjs
 *
 * Every value is synthetic (seeded PRNG, textbook waveforms). Nothing comes from a person.
 * The .wwch files use the phone's own container format (apps/mobile/src/data/sync/
 * chunk-container.ts): raw int16 LE samples in chunks, each with its CRC-32, so the
 * dashboard and the phone's restore path verify them exactly as they verify real uploads.
 * The account UUIDs match supabase/seed.sql.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../seed/', import.meta.url));
const PARTICIPANT = '0d3e0000-0000-4000-8000-000000000001';
const OTHER = '0d3e0000-0000-4000-8000-000000000002';
const SIM_DEVICE = '51ae1a7e-0000-4000-8000-000000000001'; // the app's simulated patch id

/* ---- deterministic randomness ---- */
let state = 0x5eed1234;
const rand = () => { state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return state / 2 ** 32; };
const noise = (amp) => (rand() * 2 - 1) * amp;

/* ---- CRC-32/IEEE, same as packages/sensor-protocol/src/crc32.ts ---- */
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/* Wire codes, units and scales: packages/sensor-protocol (docs/ble-protocol.md). */
const SENSORS = {
  1: { unit: 'mV', scale: 0.001 },
  2: { unit: '%', scale: 0.01 },
  3: { unit: '°C', scale: 0.01 },
  4: { unit: 'bpm', scale: 0.1 },
  5: { unit: 'g', scale: 0.001 },
  6: { unit: 'counts', scale: 1 },
};

/* Packs one channel like the phone: one chunk per 200 ms packet (gappy 1 Hz channels: one
   sample per chunk), sequence = chunk index, timestamps in µs from the session start. */
function pack(type, rate, values) {
  const { scale } = SENSORS[type];
  const perChunk = Math.max(1, Math.round(rate / 5));
  const raw = values.map((v) => Math.max(-32768, Math.min(32767, Math.round(v / scale))));
  const chunks = [];
  for (let i = 0, n = 0; i < raw.length; i += perChunk, n++) {
    const part = raw.slice(i, i + perChunk);
    const payload = new Uint8Array(part.length * 2);
    const dv = new DataView(payload.buffer);
    part.forEach((r, j) => dv.setInt16(j * 2, r, true));
    chunks.push({ n, first: BigInt(Math.round((i / rate) * 1e6)), last: BigInt(Math.round(((i + part.length - 1) / rate) * 1e6)), count: part.length, payload });
  }
  const total = 12 + chunks.reduce((s, c) => s + 40 + c.payload.length, 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf.set([0x57, 0x57, 0x43, 0x48], 0); buf[4] = 1; dv.setUint32(8, chunks.length, true);
  let o = 12;
  for (const c of chunks) {
    dv.setUint32(o, c.n, true); dv.setUint32(o + 4, c.n, true); dv.setUint32(o + 8, c.n, true);
    dv.setBigUint64(o + 12, c.first, true); dv.setBigUint64(o + 20, c.last, true);
    dv.setUint32(o + 28, c.count, true); dv.setUint32(o + 32, crc32(c.payload), true); dv.setUint32(o + 36, c.payload.length, true);
    buf.set(c.payload, o + 40); o += 40 + c.payload.length;
  }
  /* Stats from the values as stored (after int16 quantisation), like the phone. */
  const stored = raw.map((r) => r * scale);
  return {
    bytes: buf, count: raw.length,
    min: Math.min(...stored), max: Math.max(...stored), avg: stored.reduce((s, v) => s + v, 0) / stored.length,
    firstUs: chunks[0].first, lastUs: chunks.at(-1).last,
  };
}

/* ---- synthetic signals ---- */
const SECONDS = 180;
const hrAt = (t) => (t >= 60 && t < 100 ? 112 + 3 * Math.sin(t / 4) : 72 + 3 * Math.sin(t / 15)); // a 40 s high-heart-rate episode
const FALL_S = 150;

function ecg(rate) {
  const out = []; let phase = 0;
  const g = (x, mu, sd, a) => a * Math.exp(-((x - mu) ** 2) / (2 * sd * sd));
  for (let i = 0; i < SECONDS * rate; i++) {
    const t = i / rate; phase += hrAt(t) / 60 / rate; const x = phase % 1;
    out.push(g(x, 0.2, 0.025, 0.12) - g(x, 0.37, 0.01, 0.12) + g(x, 0.4, 0.012, 1.1) - g(x, 0.43, 0.01, 0.25) + g(x, 0.7, 0.04, 0.3) + noise(0.02));
  }
  return out;
}
function ppg(rate) {
  const out = []; let phase = 0;
  for (let i = 0; i < SECONDS * rate; i++) {
    const t = i / rate; phase += hrAt(t) / 60 / rate; const x = phase % 1;
    out.push(900 * Math.exp(-((x - 0.3) ** 2) / 0.01) + 250 * Math.exp(-((x - 0.6) ** 2) / 0.008) - 400 + noise(25));
  }
  return out;
}
function movement(rate) {
  const out = [];
  for (let i = 0; i < SECONDS * rate; i++) {
    const t = i / rate; let g = 1 + noise(0.04) + 0.05 * Math.sin(t * 1.7);
    if (t >= FALL_S - 0.4 && t < FALL_S) g = 0.3 + noise(0.05);           // free fall
    else if (t >= FALL_S && t < FALL_S + 0.08) g = 3.1 + noise(0.1);      // impact
    else if (t >= FALL_S + 0.08 && t < FALL_S + 20) g = 1 + noise(0.01);  // lying still
    out.push(g);
  }
  return out;
}
const perSecond = (fn, rate = 1) => Array.from({ length: SECONDS * rate }, (_, i) => fn(i / rate));

/* ---- sessions ---- */
const uuid = (s, n) => `0d3e0000-0000-4000-8000-${s}${String(n).padStart(12 - s.length, '0')}`;
const sessions = [
  {
    id: uuid('5e5', 1), user: PARTICIPANT, hoursAgo: 26, label: 'all signals, with an alert and a possible fall',
    channels: [
      [1, 250, ecg(250)],
      [2, 1, perSecond((t) => 97.5 + 0.6 * Math.sin(t / 20) + noise(0.2))],
      [3, 2, perSecond((t) => 33.6 + 0.4 * (1 - Math.exp(-t / 60)) + noise(0.03), 2)],
      [4, 1, perSecond((t) => hrAt(t) + noise(1))],
      [5, 50, movement(50)],
      [6, 100, ppg(100)],
    ],
    alert: { id: uuid('a1e', 1), type: 4, kind: 'high', value: 115.0, startS: 60, endS: 100 },
    fall: { id: uuid('fa1', 1), atMs: FALL_S * 1000, freefallMin: 0.3, impactPeak: 3.1, status: 'cancelled' },
  },
  {
    id: uuid('5e5', 2), user: PARTICIPANT, hoursAgo: 3, label: 'temperature and heart rate only',
    channels: [
      [3, 2, perSecond((t) => 33.9 + 0.2 * Math.sin(t / 40) + noise(0.03), 2)],
      [4, 1, perSecond((t) => 68 + 2 * Math.sin(t / 12) + noise(1))],
    ],
  },
  {
    id: uuid('5e5', 3), user: OTHER, hoursAgo: 5, label: 'another participant (never shared)',
    channels: [[3, 2, perSecond((t) => 34.1 + noise(0.03), 2)]],
  },
];

/* ---- write ---- */
rmSync(`${OUT}recordings`, { recursive: true, force: true });
const sql = [
  '-- GENERATED by supabase/scripts/generate-demo-recordings.mjs. Do not edit by hand.',
  '-- SIMULATED demo recordings for LOCAL development (loaded after seed.sql). Every value is',
  '-- synthetic; the matching channel files are in seed/recordings/ and are uploaded to the',
  "-- private 'recordings' bucket by the CLI ([storage.buckets.recordings] in config.toml).",
  'do $$',
  'declare',
  '  t0 timestamptz;',
  'begin',
];
let channelN = 0;
for (const s of sessions) {
  sql.push(`  -- ${s.label}`);
  sql.push(`  t0 := date_trunc('second', now()) - interval '${s.hoursAgo} hours';`);
  const config = { deviceName: 'Simulated Patch (demo seed)', firmwareVersion: null, protocolVersion: 1, channels: s.channels.map(([type, rate]) => ({ sensorType: type, sampleRateHz: rate })) };
  sql.push(`  insert into public.recorded_sessions (id, user_id, device_id, started_at, ended_at, duration_ms, status, simulated, initial_transport, final_transport, transport_switch_count, configuration_snapshot)`);
  sql.push(`  values ('${s.id}', '${s.user}', '${SIM_DEVICE}', t0, t0 + interval '${SECONDS} seconds', ${SECONDS * 1000}, 'complete', true, 'simulation', 'simulation', 0, '${JSON.stringify(config)}'::jsonb);`);
  for (const [type, rate, values] of s.channels) {
    const cid = uuid('c4a', ++channelN);
    const path = `${s.user}/${s.id}/${cid}.wwch`;
    const p = pack(type, rate, values);
    mkdirSync(`${OUT}recordings/${s.user}/${s.id}`, { recursive: true });
    writeFileSync(`${OUT}recordings/${path}`, p.bytes);
    const f = (v) => Number(v.toFixed(4));
    sql.push(`  insert into public.recorded_channels (id, session_id, user_id, sensor_type, canonical_unit, sample_rate_hz, sample_count, minimum_value, maximum_value, average_value, first_timestamp_us, last_timestamp_us, storage_path)`);
    sql.push(`  values ('${cid}', '${s.id}', '${s.user}', ${type}, '${SENSORS[type].unit}', ${rate}, ${p.count}, ${f(p.min)}, ${f(p.max)}, ${f(p.avg)}, '${p.firstUs}', '${p.lastUs}', '${path}');`);
  }
  if (s.alert) {
    const a = s.alert;
    sql.push(`  insert into public.vital_alerts (id, user_id, session_id, sensor_type, kind, value, started_at, ended_at)`);
    sql.push(`  values ('${a.id}', '${s.user}', '${s.id}', ${a.type}, '${a.kind}', ${a.value}, t0 + interval '${a.startS} seconds', t0 + interval '${a.endS} seconds');`);
  }
  if (s.fall) {
    const fl = s.fall;
    sql.push(`  insert into public.fall_events (id, user_id, session_id, detected_at_ms, freefall_min_g, impact_peak_g, status, created_at)`);
    sql.push(`  values ('${fl.id}', '${s.user}', '${s.id}', ${fl.atMs}, ${fl.freefallMin}, ${fl.impactPeak}, '${fl.status}', t0 + interval '${fl.atMs / 1000} seconds');`);
  }
}
sql.push('end $$;', '');
writeFileSync(`${OUT}demo-recordings.sql`, sql.join('\n'));
console.log(`wrote ${channelN} channel files under supabase/seed/recordings/ and supabase/seed/demo-recordings.sql`);
