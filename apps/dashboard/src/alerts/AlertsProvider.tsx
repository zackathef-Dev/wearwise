import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useViewer } from '../auth/AuthProvider';
import { api, supabase } from '../data/client';
import { alertTitle } from '../data/alert-text';
import type { AlertItem } from '../data/types';
import { participantLabel } from '../pages/ParticipantsPage';
import { playChime, unlockChime } from './chime';
import { arrivals, atMs, countUnread } from './unread';

/* The alerts feed for whoever is signed in: their own alerts plus, for staff, those of
 * participants who share the signal (or falls) with them. RLS decides what is visible.
 *
 * Fresh within seconds: Realtime postgres_changes (INSERT and UPDATE only; DELETE
 * events aren't filtered per viewer) on vital_alerts and fall_events, over the private
 * channel `alerts:<own user id>` that migration 6 lets each account join, trigger a
 * reload. A 60 s poll covers a dropped connection or a server not yet migrated. New arrivals raise
 * a browser notification if this person switched them on. Unread = newer than the
 * last visit to the Alerts page, remembered per account in this browser.
 */

export type NotifyState = 'unsupported' | 'blocked' | 'off' | 'on';

interface AlertsValue {
  items: AlertItem[] | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** participant id → how to name them ("You" for the signed-in account) */
  nameOf: (participantId: string) => string;
  /** where an alert's participant lives in the dashboard */
  baseOf: (participantId: string) => string;
  unread: number;
  seenUpTo: number;
  markSeen: () => void;
  notify: NotifyState;
  setNotify: (on: boolean) => Promise<void>;
  /** a short tone when a new alert arrives while the dashboard is open */
  sound: boolean;
  setSound: (on: boolean) => void;
}

const AlertsContext = createContext<AlertsValue | null>(null);
const POLL_MS = 60_000;

const readNum = (key: string): number | null => {
  try { const v = localStorage.getItem(key); return v == null ? null : Number(v) || 0; } catch { return null; }
};
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode: in-memory only */ } };

function notifyState(pref: boolean): NotifyState {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return pref && Notification.permission === 'granted' ? 'on' : 'off';
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { profile, staff } = useViewer();
  const navigate = useNavigate();
  const seenKey = `ww.alerts.seen.${profile.id}`;
  const notifyKey = `ww.alerts.notify.${profile.id}`;
  const soundKey = `ww.alerts.sound.${profile.id}`;

  const [items, setItems] = useState<AlertItem[] | undefined>(undefined);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seenUpTo, setSeenUpTo] = useState<number>(() => readNum(seenKey) ?? Date.now());
  const [notifyPref, setNotifyPref] = useState(() => readNum(notifyKey) === 1);
  const [sound, setSoundState] = useState(() => readNum(soundKey) !== 0); // on unless switched off
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const [, rerender] = useState(0);
  const prev = useRef<AlertItem[] | null>(null);
  const prefRef = useRef(notifyPref);
  prefRef.current = notifyPref;

  /* First visit on this browser: what already happened isn't "new". */
  useEffect(() => { if (readNum(seenKey) === null) write(seenKey, String(seenUpTo)); }, [seenKey, seenUpTo]);

  const nameOf = useCallback((id: string) => (id === profile.id ? 'You' : names.get(id) ?? 'A participant'), [names, profile.id]);
  const baseOf = useCallback((id: string) => (id === profile.id ? '/me' : `/participants/${id}`), [profile.id]);

  const showNotifications = useCallback((fresh: AlertItem[]) => {
    if (!fresh.length) return;
    /* One tone for the batch, the most urgent kind. */
    if (soundRef.current) playChime(fresh.some((a) => a.kind === 'fall') ? 'fall' : 'alert');
    if (!prefRef.current || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const a of fresh.slice(0, 3)) {
      /* No names or readings: a notification can show on a shared or locked screen.
         The Alerts page has the details. */
      const n = new Notification(`WearWise: ${alertTitle(a)}`, {
        body: a.participantId === profile.id ? 'Open WearWise to see it.' : 'For a participant who shares with you. Open WearWise to see who.',
        tag: a.id, icon: '/favicon.svg',
        /* A fall stays on screen until someone deals with it; other alerts fade as usual. */
        requireInteraction: a.kind === 'fall',
      });
      n.onclick = () => { window.focus(); navigate('/alerts'); n.close(); };
    }
  }, [navigate, profile.id]);

  /* Browsers allow sound only after a click or key press on the page. */
  useEffect(() => {
    const unlock = () => unlockChime();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  const setSound = useCallback((on: boolean) => {
    setSoundState(on);
    write(soundKey, on ? '1' : '0');
    if (on) { unlockChime(); playChime('alert'); } // let them hear what it sounds like
  }, [soundKey]);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [list, shared] = await Promise.all([api.listAlerts(200), staff ? api.listSharedParticipants() : Promise.resolve([])]);
      setNames(new Map(shared.map((p) => [p.participantId, participantLabel(p)])));
      if (prev.current) showNotifications(arrivals(prev.current, list, Date.now()));
      prev.current = list;
      setItems(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Alerts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [staff, showNotifications]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void loadRef.current();
    let timer: number | undefined;
    const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void loadRef.current(), 800); };
    let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
    let closed = false;
    if (supabase) {
      void supabase.realtime.setAuth().then(() => {
        if (closed) return;
        channel = supabase!.channel(`alerts:${profile.id}`, { config: { private: true } });
        for (const table of ['vital_alerts', 'fall_events']) {
          channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table }, soon);
          channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, soon);
        }
        channel.subscribe();
      });
    }
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void loadRef.current(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      closed = true;
      if (channel) void supabase!.removeChannel(channel);
    };
  }, [profile.id]);

  const markSeen = useCallback(() => {
    const newest = Math.max(Date.now(), ...(items ?? []).map(atMs));
    setSeenUpTo(newest);
    write(seenKey, String(newest));
  }, [items, seenKey]);

  const setNotify = useCallback(async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    setNotifyPref(on && granted);
    write(notifyKey, on && granted ? '1' : '0');
    rerender((n) => n + 1);
  }, [notifyKey]);

  const value = useMemo<AlertsValue>(() => ({
    items, error, loading, reload: () => void load(), nameOf, baseOf,
    unread: countUnread(items ?? [], seenUpTo), seenUpTo, markSeen,
    notify: notifyState(notifyPref), setNotify, sound, setSound,
  }), [items, error, loading, load, nameOf, baseOf, seenUpTo, markSeen, notifyPref, setNotify, sound, setSound]);

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsValue {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error('useAlerts outside AlertsProvider');
  return ctx;
}
