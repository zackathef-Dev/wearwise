import React from 'react';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useAuth } from '@/features/authentication/auth-store';
import { onNotificationTap, takeLaunchTap, type NotificationTap } from '@/platform/notifications/notifications';
import { routeFromData } from './notification-policy';
import { configurePhoneNotifications } from './phone-notifications';

/* Tapping a phone notification opens the matching screen: Alerts for an alert or a
 * fall, Home for a sensor that dropped out mid-recording. Mounted once at the root.
 *
 * Waits until someone is signed in and the start route has handed over to a real
 * screen — otherwise the start route's own redirect to Home would land on top. A tap
 * that opened the app from closed is picked up then.
 */

const handled = new Set<string>();   // each notification opens its screen once

export function useNotificationRouting(): void {
  const router = useRouter();
  const pathname = usePathname();
  const ready = useAuth((s) => s.status === 'signed-in') && pathname !== '/';

  React.useEffect(() => { configurePhoneNotifications(); }, []);

  React.useEffect(() => {
    if (!ready) return;
    const open = (tap: NotificationTap) => {
      if (handled.has(tap.id)) return;
      handled.add(tap.id);
      const route = routeFromData(tap.data);
      if (route) router.push(route as Href);
    };
    const launch = takeLaunchTap();
    if (launch) open(launch);
    return onNotificationTap(open);
  }, [ready, router]);
}
