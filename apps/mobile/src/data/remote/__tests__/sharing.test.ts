import type { SupabaseClient } from '@supabase/supabase-js';
import { SensorType } from '@wearwise/sensor-protocol';
import { SupabaseSharing, SharingFailure, SHAREABLE_SIGNALS } from '../sharing';

/* The sharing RPC wrapper against a scripted client: what it sends, how it shapes
 * rows, and how failures fold. The real client is never built here. */
jest.mock('../supabase-client', () => ({ supabase: null }));

type Reply = { data?: unknown; error?: { message?: string; code?: string } | null; status?: number };

function fakeClient(reply: Reply | (() => Promise<Reply>)) {
  const rpc = jest.fn(async () => {
    const r = typeof reply === 'function' ? await reply() : reply;
    return { data: r.data ?? null, error: r.error ?? null, status: r.status ?? (r.error ? 400 : 200) };
  });
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}

const grantRow = {
  grant_id: '0b6c1f3e-0000-4000-8000-000000000001',
  grantee_name: 'Dr Priya Shah',
  grantee_email: 'priya@uni.example',
  grantee_role: 'clinician',
  sensor_types: [4, 2],
  include_falls: true,
  created_at: '2026-10-12T09:30:00+00:00',
  access_active: true,
};

const failsWith = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(SharingFailure);
  await expect(p).rejects.toMatchObject({ code });
};

describe('creating a share code', () => {
  test('sends the chosen signals deduped and in order, and returns the first row', async () => {
    const { rpc, client } = fakeClient({ data: [{ code: 'ABCDE-FGHJK', expires_at: '2026-10-14T10:00:00+00:00' }] });
    const code = await new SupabaseSharing(client).createShareCode({
      sensorTypes: [SensorType.SpO2, SensorType.Ecg, SensorType.SpO2], includeFalls: false,
    });
    expect(code).toEqual({ code: 'ABCDE-FGHJK', expiresAt: '2026-10-14T10:00:00+00:00' });
    expect(rpc).toHaveBeenCalledWith('create_share_code', { p_sensor_types: [1, 2], p_include_falls: false });
  });

  test('no signals is refused before any network call', async () => {
    const { rpc, client } = fakeClient({ data: [] });
    await failsWith(new SupabaseSharing(client).createShareCode({ sensorTypes: [], includeFalls: true }), 'no-signals');
    /* Unknown codes are dropped, so a list of only unknown codes is empty too. */
    await failsWith(new SupabaseSharing(client).createShareCode({ sensorTypes: [99 as SensorType], includeFalls: true }), 'no-signals');
    expect(rpc).not.toHaveBeenCalled();
  });

  test('an empty reply is an error, not a blank code', async () => {
    const { client } = fakeClient({ data: [] });
    await failsWith(new SupabaseSharing(client).createShareCode({ sensorTypes: [...SHAREABLE_SIGNALS], includeFalls: true }), 'unknown');
  });

  test('a non-participant account is told so', async () => {
    const { client } = fakeClient({ error: { message: 'only an active participant can share data', code: '42501' } });
    await failsWith(new SupabaseSharing(client).createShareCode({ sensorTypes: [SensorType.Ecg], includeFalls: false }), 'not-allowed');
  });
});

describe('listing who has access', () => {
  test('shapes rows: known signals only, in display order, blank names become null', async () => {
    const { rpc, client } = fakeClient({
      data: [grantRow, { ...grantRow, grant_id: 'g2', grantee_name: '  ', grantee_role: 'researcher', sensor_types: [6, 1, 42], include_falls: false }],
    });
    const grants = await new SupabaseSharing(client).listAccessGrants();
    expect(rpc).toHaveBeenCalledWith('list_my_access_grants', undefined);
    expect(grants).toEqual([
      { id: grantRow.grant_id, name: 'Dr Priya Shah', email: 'priya@uni.example', role: 'clinician',
        sensorTypes: [SensorType.HeartRate, SensorType.SpO2], includeFalls: true, accessActive: true, createdAt: grantRow.created_at },
      { id: 'g2', name: null, email: 'priya@uni.example', role: 'researcher',
        sensorTypes: [SensorType.Ecg, SensorType.Ppg], includeFalls: false, accessActive: true, createdAt: grantRow.created_at },
    ]);
  });

  test('a viewer who lost their role is still listed, with no role and access not active', async () => {
    const { client } = fakeClient({ data: [{ ...grantRow, grantee_role: 'participant', access_active: false }] });
    const [g] = await new SupabaseSharing(client).listAccessGrants();
    expect(g?.role).toBeNull();
    expect(g?.accessActive).toBe(false);
  });

  test('an unknown access state is never reported as active', async () => {
    const { client } = fakeClient({ data: [{ ...grantRow, access_active: null }] });
    const [g] = await new SupabaseSharing(client).listAccessGrants();
    expect(g?.accessActive).toBe(false);
  });

  test('nobody yet is an empty list', async () => {
    const { client } = fakeClient({ data: null });
    await expect(new SupabaseSharing(client).listAccessGrants()).resolves.toEqual([]);
  });

  test('a malformed row fails the whole list rather than hiding someone', async () => {
    const { client } = fakeClient({ data: [grantRow, { grant_id: 7 }] });
    await failsWith(new SupabaseSharing(client).listAccessGrants(), 'unknown');
  });
});

describe('changing and removing access', () => {
  test('update sends the grant id and the new scope, and says whether it changed', async () => {
    const { rpc, client } = fakeClient({ data: true });
    await expect(new SupabaseSharing(client).updateAccessGrant('g1', { sensorTypes: [SensorType.Temperature], includeFalls: true }))
      .resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('update_access_grant', { p_grant_id: 'g1', p_sensor_types: [3], p_include_falls: true });
  });

  test('update of a grant that had already ended resolves false, not an error', async () => {
    const { client } = fakeClient({ data: false });
    await expect(new SupabaseSharing(client).updateAccessGrant('g1', { sensorTypes: [SensorType.Ecg], includeFalls: false }))
      .resolves.toBe(false);
  });

  test('a non-boolean reply is a contract break, not a quiet no', async () => {
    const { client } = fakeClient({ data: null });
    await failsWith(new SupabaseSharing(client).updateAccessGrant('g1', { sensorTypes: [SensorType.Ecg], includeFalls: false }), 'unknown');
    await failsWith(new SupabaseSharing(client).revokeAccessGrant('g1'), 'unknown');
  });

  test('update to no signals is refused locally — removing access is the way to share nothing', async () => {
    const { rpc, client } = fakeClient({ data: null });
    await failsWith(new SupabaseSharing(client).updateAccessGrant('g1', { sensorTypes: [], includeFalls: true }), 'no-signals');
    expect(rpc).not.toHaveBeenCalled();
  });

  test('revoke sends the grant id and says whether this call ended it', async () => {
    const { rpc, client } = fakeClient({ data: true });
    await expect(new SupabaseSharing(client).revokeAccessGrant('g1')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('revoke_access_grant', { p_grant_id: 'g1' });
    const gone = fakeClient({ data: false });
    await expect(new SupabaseSharing(gone.client).revokeAccessGrant('g1')).resolves.toBe(false);
  });
});

describe('the code waiting to be used', () => {
  test('returns its scope (in display order) and expiry — never the code itself', async () => {
    const { rpc, client } = fakeClient({ data: [{ expires_at: '2026-10-14T10:00:00+00:00', sensor_types: [3, 1, 42], include_falls: false }] });
    await expect(new SupabaseSharing(client).pendingShareCode()).resolves.toEqual({
      expiresAt: '2026-10-14T10:00:00+00:00', sensorTypes: [SensorType.Ecg, SensorType.Temperature], includeFalls: false,
    });
    expect(rpc).toHaveBeenCalledWith('my_pending_share_code', undefined);
  });

  test('none waiting is null', async () => {
    for (const data of [[], null]) {
      const { client } = fakeClient({ data });
      await expect(new SupabaseSharing(client).pendingShareCode()).resolves.toBeNull();
    }
  });

  test('a malformed row is an error', async () => {
    const { client } = fakeClient({ data: [{ sensor_types: [1] }] });
    await failsWith(new SupabaseSharing(client).pendingShareCode(), 'unknown');
  });

  test('cancel says whether there was a code to withdraw', async () => {
    const { rpc, client } = fakeClient({ data: true });
    await expect(new SupabaseSharing(client).cancelShareCode()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('cancel_share_code', undefined);
    const none = fakeClient({ data: false });
    await expect(new SupabaseSharing(none.client).cancelShareCode()).resolves.toBe(false);
  });

  test('offline cancel fails as offline', async () => {
    const { client } = fakeClient({ error: { message: 'TypeError: Network request failed', code: '' }, status: 0 });
    await failsWith(new SupabaseSharing(client).cancelShareCode(), 'offline');
  });
});

describe('failures', () => {
  test('a dropped connection (status 0) is offline, whatever the message', async () => {
    const { client } = fakeClient({ error: { message: 'TypeError: Network request failed', code: '' }, status: 0 });
    await failsWith(new SupabaseSharing(client).listAccessGrants(), 'offline');
  });

  test('a thrown fetch is offline, not a crash', async () => {
    const { client } = fakeClient(() => Promise.reject(new TypeError('Network request failed')));
    await failsWith(new SupabaseSharing(client).revokeAccessGrant('g1'), 'offline');
  });

  test('missing functions (migration not applied) are unavailable', async () => {
    const { client } = fakeClient({ error: { message: 'Could not find the function', code: 'PGRST202' }, status: 404 });
    await failsWith(new SupabaseSharing(client).listAccessGrants(), 'unavailable');
  });

  test('server-side signal validation folds to no-signals', async () => {
    const { client } = fakeClient({ error: { message: 'choose at least one signal to share', code: '22023' } });
    await failsWith(new SupabaseSharing(client).updateAccessGrant('g1', { sensorTypes: [SensorType.Ecg], includeFalls: false }), 'no-signals');
  });

  test('anything else is unknown', async () => {
    const { client } = fakeClient({ error: { message: 'boom', code: 'XX000' }, status: 500 });
    await failsWith(new SupabaseSharing(client).revokeAccessGrant('g1'), 'unknown');
  });

  test('no backend configured fails every call with the setup code', async () => {
    const api = new SupabaseSharing(null);
    await failsWith(api.listAccessGrants(), 'not-configured');
    await failsWith(api.createShareCode({ sensorTypes: [SensorType.Ecg], includeFalls: false }), 'not-configured');
  });
});
