/* Sync verification against a running backend (local or hosted), through the same
 * public API and Storage the phone uses (Milestone 6).
 *
 * Requires the migrations to be applied. Uses a confirmed account (no admin key):
 *   SB_URL         the API URL: http://127.0.0.1:54321 for local Supabase, or
 *                  https://<ref>.supabase.co (SB_PROJECT_REF=<ref> works too)
 *   SB_ANON        publishable / anon key
 *   SB_TEST_EMAIL  a confirmed user's email  (local seed: demo.participant@example.invalid)
 *   SB_TEST_PW     that user's password
 * Optional SB_OTHER_EMAIL / SB_OTHER_PW (a second account; local seed:
 * demo.other@example.invalid) enable the cross-user RLS negative check.
 *
 * It uploads a session + channel row + a chunk-container payload to Storage,
 * reads them back, verifies the payload CRC survived, then deletes everything.
 */
const URL = (process.env.SB_URL || (process.env.SB_PROJECT_REF ? `https://${process.env.SB_PROJECT_REF}.supabase.co` : '')).replace(/\/$/, '');
const ANON = process.env.SB_ANON;
const EMAIL = process.env.SB_TEST_EMAIL;
const PW = process.env.SB_TEST_PW;
if (!URL || !ANON || !EMAIL || !PW) { console.error('need SB_URL (or SB_PROJECT_REF), SB_ANON, SB_TEST_EMAIL, SB_TEST_PW'); process.exit(1); }

const BUCKET = 'recordings';
let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); };

/* CRC-32/IEEE — same as packages/sensor-protocol/crc32.ts. */
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/* Pack one chunk into a WWCH container (mirrors chunk-container.ts). */
function packOne(payload) {
  const meta = 40, buf = new Uint8Array(12 + meta + payload.length), dv = new DataView(buf.buffer);
  buf.set([0x57, 0x57, 0x43, 0x48], 0); buf[4] = 1; dv.setUint32(8, 1, true);
  let o = 12;
  dv.setUint32(o, 0, true); o += 4; dv.setUint32(o, 0, true); o += 4; dv.setUint32(o, 0, true); o += 4;
  dv.setBigUint64(o, 0n, true); o += 8; dv.setBigUint64(o, 1000n, true); o += 8;
  dv.setUint32(o, payload.length / 2, true); o += 4; dv.setUint32(o, crc32(payload), true); o += 4;
  dv.setUint32(o, payload.length, true); o += 4; buf.set(payload, o);
  return buf;
}

async function signIn(email, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) });
  return r.json();
}
const rest = (path, jwt, init = {}) => fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
const store = (path, jwt, init = {}) => fetch(`${URL}/storage/v1/object/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, ...(init.headers || {}) } });

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

(async () => {
  const auth = await signIn(EMAIL, PW);
  if (!auth.access_token) { console.error('sign-in failed:', auth); process.exit(1); }
  const jwt = auth.access_token, uid = auth.user.id;
  const sid = uuid(Date.now() % 1e12), cid = uuid((Date.now() % 1e12) + 1);
  const path = `${uid}/${sid}/${cid}.wwch`;
  const payload = new Uint8Array([1, 0, 2, 0, 250, 255, 44, 4]);

  try {
    // 1. session row
    let r = await rest('recorded_sessions', jwt, { method: 'POST', body: JSON.stringify({
      id: sid, device_id: 'sync-live', started_at: new Date(0).toISOString(), ended_at: new Date(60000).toISOString(),
      duration_ms: 60000, status: 'complete', simulated: true, initial_transport: 'bluetooth', final_transport: 'bluetooth',
      transport_switch_count: 0, configuration_snapshot: { deviceName: 'Patch', protocolVersion: 1, channels: [] } }) });
    ok(r.status === 201, `insert session (status ${r.status})`);

    // 2. payload → Storage
    r = await store(`${BUCKET}/${path}`, jwt, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: packOne(payload) });
    ok(r.ok, `upload payload to Storage (status ${r.status})`);

    // 3. channel row pointing at it
    r = await rest('recorded_channels', jwt, { method: 'POST', body: JSON.stringify({
      id: cid, session_id: sid, sensor_type: 1, canonical_unit: 'mV', sample_rate_hz: 70, sample_count: 4,
      minimum_value: -1, maximum_value: 1, average_value: 0, storage_path: path }) });
    ok(r.status === 201, `insert channel (status ${r.status})`);

    // 4. read back the session
    r = await rest(`recorded_sessions?id=eq.${sid}&select=*`, jwt);
    const rows = await r.json();
    ok(Array.isArray(rows) && rows.length === 1 && rows[0].status === 'complete', 'read back session row');

    // 5. download payload + verify CRC round-trip
    r = await store(`${BUCKET}/${path}`, jwt);
    const back = new Uint8Array(await r.arrayBuffer());
    const dv = new DataView(back.buffer);
    const storedCrc = dv.getUint32(12 + 32, true);           // checksum field: header(12) + meta offset 32
    const plen = dv.getUint32(12 + 36, true);
    const gotPayload = back.slice(12 + 40, 12 + 40 + plen);
    ok(crc32(gotPayload) === storedCrc && [...gotPayload].join() === [...payload].join(), 'payload survived round trip (CRC clean)');

    // 6. cross-user RLS negative check (optional; needs a second account)
    if (process.env.SB_OTHER_EMAIL && process.env.SB_OTHER_PW) {
      const other = await signIn(process.env.SB_OTHER_EMAIL, process.env.SB_OTHER_PW);
      const rr = await rest(`recorded_sessions?id=eq.${sid}&select=*`, other.access_token);
      const orows = await rr.json();
      ok(Array.isArray(orows) && orows.length === 0, 'another user CANNOT read this session (RLS)');
      const os = await store(`${BUCKET}/${path}`, other.access_token);
      ok(!os.ok, 'another user CANNOT download this payload (Storage RLS)');
    } else {
      console.log('SKIP  cross-user RLS check (set SB_OTHER_EMAIL, SB_OTHER_PW)');
    }
  } finally {
    // cleanup — owner deletes own rows + object
    await store(`${BUCKET}/${path}`, jwt, { method: 'DELETE' }).catch(() => {});
    await rest(`recorded_sessions?id=eq.${sid}`, jwt, { method: 'DELETE' }).catch(() => {});
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
