import { create } from 'zustand';
import { AppState } from 'react-native';
import { supabase } from '@/data/remote/supabase-client';
import { sharing, isSharingFailure } from '@/data/remote/sharing';
import { openLiveChannel } from '@/data/remote/live-channel';
import { useAuth } from '@/features/authentication/auth-store';
import { currentFall, liveSource, onLiveFall, onLiveSamples, useMonitoring } from '@/features/monitoring/monitoring-store';
import { LiveViewBroadcaster } from './live-view-broadcaster';
import {
  fallEvent, liveViewGrants, liveViewMs, sensorGone, viewerName, DEFAULT_LIVE_VIEW_MINUTES, BATCH_MS, GRANT_RECHECK_MS,
  MAX_FAILED_GRANT_CHECKS, type LiveGrant,
} from './live-view-core';

/* LIVE VIEW FOR SETUP — while it is on, the people this participant shares with can
 * watch the sensor's readings as they arrive (to help put it on and check it works).
 * Nothing is stored: readings go out over Realtime broadcast and nowhere else.
 *
 * Falls go out too, while it is on, to viewers whose share includes falls: the fall
 * alarm's steps as they happen. Without live view, falls reach them only through
 * recordings, as before.
 *
 * A viewer may ask for a recording while it is on: the participant is asked
 * (RecordRequestHost) and nothing records unless they tap Start. The viewer who asked
 * may stop that recording from their side; it is saved like any other.
 *
 * Off by default, and never on for long: it switches itself off at the end of the time
 * the participant chose (30 minutes unless they pick up to 8 hours), when
 * the participant signs out, when the sensor is gone for good, when nobody may watch
 * any more (or everyone stopped watching), or when who may watch can no longer be
 * checked. Who may watch is re-read every 30 s, so someone whose access ends stops
 * receiving straight away.
 */

export type LiveViewEnd = 'time-up' | 'sensor-lost' | 'no-viewers' | 'viewers-stopped' | 'offline' | 'signed-out';

interface LiveViewState {
  phase: 'off' | 'starting' | 'on';
  endsAt: number | null;
  /* Who is watching (may be watching): active viewers and their signals. */
  viewers: LiveGrant[];
  /* How many of them are connected right now. */
  reachable: number;
  error: string | null;
  /* Why live view last switched itself off (not set when the participant stopped it). */
  ended: LiveViewEnd | null;

  /* For this many minutes (one of LIVE_VIEW_MINUTES; 30 by default). */
  start(minutes?: number): Promise<void>;
  stop(reason?: LiveViewEnd): Promise<void>;
  /* Re-read who may watch now (also run on a timer while on). */
  refreshViewers(): Promise<void>;

  /* A viewer's request to start a recording, waiting for the participant. */
  recordRequest: { grantId: string; name: string } | null;
  answerRecordRequest(start: boolean): Promise<void>;
  /* Told to the participant once: a viewer stopped the recording they asked for. */
  recordNotice: string | null;
  clearRecordNotice(): void;
}

/* An unanswered recording request is withdrawn (and the viewer told "declined") after this. */
const RECORD_PROMPT_MS = 60_000;
const recordingNow = () => {
  const st = useMonitoring.getState().engine?.state;
  return st === 'recording' || st === 'preparing';
};

interface Running {
  broadcaster: LiveViewBroadcaster;
  userId: string;
  cleanups: (() => void)[];
  notConnectedSince: number | null;
  failedGrantChecks: number;
  /* The viewer whose request started the current recording, if one did. */
  recordingBy: string | null;
  promptTimer: ReturnType<typeof setTimeout> | null;
}
let running: Running | null = null;

const failureText = (e: unknown): string =>
  isSharingFailure(e) && e.code === 'offline'
    ? 'You’re offline, or the server can’t be reached. Check your connection and try again.'
    : 'Live view couldn’t start. Try again in a moment.';

export const useLiveView = create<LiveViewState>((set, get) => ({
  phase: 'off', endsAt: null, viewers: [], reachable: 0, error: null, ended: null,
  recordRequest: null, recordNotice: null,

  async start(minutes = DEFAULT_LIVE_VIEW_MINUTES) {
    if (get().phase !== 'off') return;
    const userId = useAuth.getState().participant?.id;
    const client = supabase;
    if (!userId || !client) { set({ error: 'This build isn’t connected to a WearWise server.' }); return; }
    if (!liveSource().connected) { set({ error: 'Connect your sensor first.' }); return; }
    set({ phase: 'starting', error: null, ended: null });

    let viewers: LiveGrant[];
    try {
      viewers = liveViewGrants(await sharing.listAccessGrants());
      /* Joining a private channel needs the participant's token, not the anon key. */
      await client.realtime.setAuth();
    } catch (e) {
      if (get().phase === 'starting') set({ phase: 'off', error: failureText(e) });
      return;
    }
    /* Stopped, or someone else signed in, while we were asking. */
    if (get().phase !== 'starting' || useAuth.getState().participant?.id !== userId) {
      if (get().phase === 'starting') set({ phase: 'off' });
      return;
    }
    if (!viewers.length) { set({ phase: 'off', error: 'Nobody you share with can see live readings right now.' }); return; }

    const endsAt = Date.now() + liveViewMs(minutes);
    const broadcaster = new LiveViewBroadcaster({
      openLink: (grantId, onStop) => openLiveChannel(client, grantId, onStop),
      onViewerStopped: () => {
        if (running !== run) return;
        const left = broadcaster.viewing();
        if (left.length) set({ viewers: left }); else void get().stop('viewers-stopped');
      },
      source: () => {
        const s = liveSource();
        return {
          device: s.device, simulated: s.simulated, streamed: s.streamed, recording: recordingNow(), recordingBy: run.recordingBy,
          link: s.link, firmware: s.firmware, sensors: s.sensors,
        };
      },
      onRecordRequest: (grant) => askToRecord(grant),
      onRecordStop: (grant) => { void stopRecordingFor(grant); },
      now: Date.now,
    }, endsAt);
    const run: Running = {
      broadcaster, userId, cleanups: [], notConnectedSince: null, failedGrantChecks: 0, recordingBy: null, promptTimer: null,
    };
    /* A viewer asks: tell them it's being asked, or why it can't be. */
    const askToRecord = (grant: LiveGrant) => {
      if (running !== run) return;
      if (get().recordRequest) { broadcaster.answerRecord(grant.id, 'declined'); return; }   // someone else is being answered
      if (recordingNow()) { broadcaster.answerRecord(grant.id, 'recording'); return; }
      if (!liveSource().connected) { broadcaster.answerRecord(grant.id, 'unavailable'); return; }
      set({ recordRequest: { grantId: grant.id, name: viewerName(grant) } });
      broadcaster.answerRecord(grant.id, 'asked');
      run.promptTimer = setTimeout(() => { void get().answerRecordRequest(false); }, RECORD_PROMPT_MS);
    };
    /* Only the viewer whose request started the recording may stop it. */
    const stopRecordingFor = async (grant: LiveGrant) => {
      if (running !== run || run.recordingBy !== grant.id || !recordingNow()) return;
      run.recordingBy = null;
      await useMonitoring.getState().stopRecording().catch(() => undefined);
      broadcaster.answerRecord(grant.id, 'stopped');
      set({ recordNotice: `${viewerName(grant)} stopped the recording they asked for. It’s saved in History.` });
    };
    running = run;
    try {
      broadcaster.setGrants(viewers);
    } catch {
      await get().stop();
      set({ error: 'Live view couldn’t start. Try again in a moment.' });
      return;
    }

    run.cleanups.push(onLiveSamples((e) => broadcaster.push(e.sensorType, e.samples, e.rateHz, e.atMs, e.simulated, e.leadsOff)));
    run.cleanups.push(onLiveFall((f, state) => { const ev = fallEvent(f, state); if (ev) broadcaster.fall(ev); }));
    /* An alarm already on screen when live view starts. */
    const onScreen = currentFall();
    const pendingFall = onScreen && fallEvent(onScreen.fall, onScreen.state);
    if (pendingFall) broadcaster.fall(pendingFall);

    const tick = setInterval(() => {
      if (running !== run) return;
      const now = Date.now();
      if (now >= endsAt) { void get().stop('time-up'); return; }
      const src = liveSource();
      run.notConnectedSince = src.connected ? null : run.notConnectedSince ?? now;
      if (sensorGone(src.connection, run.notConnectedSince, now)) { void get().stop('sensor-lost'); return; }
      if (run.failedGrantChecks >= MAX_FAILED_GRANT_CHECKS) { void get().stop('offline'); return; }
      broadcaster.tick();
      const reachable = broadcaster.reachable();
      if (reachable !== get().reachable) set({ reachable });
    }, BATCH_MS);
    const recheck = setInterval(() => { void get().refreshViewers(); }, GRANT_RECHECK_MS);
    /* Back from the background: who may watch could have changed meanwhile. */
    const resumed = AppState.addEventListener('change', (state) => { if (state === 'active') void get().refreshViewers(); });
    run.cleanups.push(() => clearInterval(tick), () => clearInterval(recheck), () => resumed.remove());
    /* Recording started or stopped (here or by request): a fresh status for everyone,
       and once it is over nobody "started" the next one. */
    run.cleanups.push(useMonitoring.subscribe((s, prev) => {
      const now = s.engine?.state === 'recording' || s.engine?.state === 'preparing';
      const before = prev.engine?.state === 'recording' || prev.engine?.state === 'preparing';
      if (now === before) return;
      if (!now) run.recordingBy = null;
      broadcaster.announce();
    }));
    run.cleanups.push(() => { if (run.promptTimer) clearTimeout(run.promptTimer); });
    run.cleanups.push(useAuth.subscribe((state) => {
      if (state.participant?.id !== userId) void get().stop('signed-out');
    }));

    set({ phase: 'on', endsAt, viewers, reachable: 0 });
  },

  async stop(reason) {
    const run = running;
    running = null;
    /* After a sign-out there is nobody to tell why. */
    set({
      phase: 'off', endsAt: null, viewers: [], reachable: 0, ended: reason === 'signed-out' ? null : reason ?? null, error: null,
      recordRequest: null,
    });
    if (!run) return;
    for (const c of run.cleanups) c();
    await run.broadcaster.stop();
  },

  async answerRecordRequest(start) {
    const run = running;
    const req = get().recordRequest;
    if (!req) return;
    set({ recordRequest: null });
    if (run?.promptTimer) { clearTimeout(run.promptTimer); run.promptTimer = null; }
    if (!run) return;
    if (!start) { run.broadcaster.answerRecord(req.grantId, 'declined'); return; }
    if (recordingNow()) { run.broadcaster.answerRecord(req.grantId, 'recording'); return; }
    /* The participant's own choice of signals, as the Record panel uses: only ones the
       sensor is reporting. */
    const m = useMonitoring.getState();
    const chosen = m.selected.filter((t) => m.capabilities.some((c) => c.sensorType === t && c.reporting));
    if (!chosen.length) { run.broadcaster.answerRecord(req.grantId, 'unavailable'); return; }
    m.select(chosen);
    try {
      await m.startRecording(run.userId);
      run.recordingBy = req.grantId;
      run.broadcaster.answerRecord(req.grantId, 'started');
      run.broadcaster.announce();
    } catch (e) {
      run.broadcaster.answerRecord(req.grantId, 'unavailable');
      set({ recordNotice: e instanceof Error ? `The recording couldn’t start: ${e.message}` : 'The recording couldn’t start.' });
    }
  },

  clearRecordNotice() { set({ recordNotice: null }); },

  async refreshViewers() {
    const run = running;
    if (!run) return;
    let viewers: LiveGrant[];
    try {
      viewers = liveViewGrants(await sharing.listAccessGrants());
    } catch {
      run.failedGrantChecks += 1;   // keep the last list; the tick stops live view if this goes on
      return;
    }
    if (running !== run) return;
    run.failedGrantChecks = 0;
    if (!viewers.length) { await get().stop('no-viewers'); return; }
    run.broadcaster.setGrants(viewers);
    const watching = run.broadcaster.viewing();
    if (!watching.length) { await get().stop('viewers-stopped'); return; }
    set({ viewers: watching });
  },
}));
