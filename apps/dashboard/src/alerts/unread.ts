import type { AlertItem } from '../data/types';

/* Which alerts are new to this person, and which just arrived. Pure; the provider
   keeps the "seen up to" time per account in localStorage. */

export const atMs = (a: AlertItem): number => Date.parse(a.at) || 0;

export const countUnread = (items: readonly AlertItem[], seenUpTo: number): number =>
  items.reduce((n, a) => n + (atMs(a) > seenUpTo ? 1 : 0), 0);

/** Alerts in `next` that weren't in `prev` and happened recently: worth a notification.
 *  Old rows that only now became visible (a new share, a late upload) are not news. */
export function arrivals(prev: readonly AlertItem[], next: readonly AlertItem[], now: number, recentMs = 15 * 60_000): AlertItem[] {
  const known = new Set(prev.map((a) => a.id));
  return next.filter((a) => !known.has(a.id) && now - atMs(a) <= recentMs);
}
