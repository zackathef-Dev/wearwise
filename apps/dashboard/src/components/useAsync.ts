import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/* Load once per dependency change, with reload. A reload() keeps the previous data
   on screen (status 'loading' + data) instead of flashing an empty state; a change
   of deps (another participant, another session) starts empty, so one record is
   never shown under another's heading. Results that arrive after the deps changed
   or the component unmounted are dropped. */

export interface AsyncState<T> {
  status: 'loading' | 'success' | 'error';
  data: T | undefined;
  error: string | null;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({ status: 'loading', data: undefined, error: null });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const lastTick = useRef(tick);

  useEffect(() => {
    let alive = true;
    const isReload = lastTick.current !== tick;
    lastTick.current = tick;
    setState((s) => ({ status: 'loading', data: isReload ? s.data : undefined, error: null }));
    fnRef.current().then(
      (data) => { if (alive) setState({ status: 'success', data, error: null }); },
      (e: unknown) => {
        if (alive) setState((s) => ({ status: 'error', data: s.data, error: e instanceof Error ? e.message : 'Something went wrong.' }));
      },
    );
    return () => { alive = false; };
    /* deps are the caller's, plus the reload tick */
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
