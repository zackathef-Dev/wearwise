/* Every link the system hands the app (wearwise://…) passes through here before Expo
 * Router reads it. Expo Router decodes percent-escapes, and a malformed one
 * ("%E0%A4%A") throws during launch, so a crafted link could stop the app opening at
 * all. A link that long is never one of ours either. Either way, open the app normally
 * instead. Android does the same check natively (plugins/with-release-security.js).
 */
const MAX_LINK = 2048;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (typeof path !== 'string' || path.length > MAX_LINK) return '/';
    decodeURIComponent(path);
    return path;
  } catch {
    return '/';
  }
}
