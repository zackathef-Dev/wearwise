import { secondsFrom } from './series';
import type { ChannelRow, FallRow } from './types';

/* One time axis for a whole session.
 *
 * Sample timestamps are on the DEVICE's clock (microseconds since it booted, see
 * packages/sensor-protocol), so the axis is "seconds since the session's first
 * recorded sample": origin = the earliest first_timestamp_us of any channel the
 * viewer can see. Every channel shares it, so the charts line up.
 *
 * Falls are timed on the PHONE's clock (fall_events.detected_at_ms = ms since the
 * recording started). The two clocks start within a moment of each other (the
 * phone starts its timer as the device starts streaming), so a fall is placed at
 * detected_at_ms on the same axis. It is an approximation of up to about a second,
 * and the UI says so.
 */

export interface Timeline {
  /** device-clock µs of t = 0; null when no channel has samples */
  originUs: bigint | null;
  start: number;
  /** seconds; the end of the data, stretched to include any fall */
  end: number;
}

export function sessionTimeline(channels: ChannelRow[], falls: FallRow[], durationMs: number | null): Timeline {
  let origin: bigint | null = null;
  for (const c of channels) {
    if (c.firstTimestampUs != null && (origin == null || c.firstTimestampUs < origin)) origin = c.firstTimestampUs;
  }

  let end = 0;
  if (origin != null) {
    for (const c of channels) {
      if (c.lastTimestampUs != null) end = Math.max(end, secondsFrom(origin, c.lastTimestampUs));
    }
  }
  if (!(end > 0) && durationMs != null && durationMs > 0) end = durationMs / 1000;
  for (const f of falls) end = Math.max(end, f.detectedAtMs / 1000 + 1);
  if (!(end > 0)) end = 1;

  return { originUs: origin, start: 0, end };
}
