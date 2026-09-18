// Deployment-migration shim (2026-09-18).
//
// The platform-hosted Convex deployment `successful-iguana-419` (team
// "freebuff", service account) was PAUSED by the platform and the account
// owner has no dashboard access to resume it. The project now runs on the
// owner-controlled deployment `trustworthy-clownfish-652`
// (dashboard.convex.dev/t/afra-batool/onyxtranslate/trustworthy-clownfish-652).
//
// VITE_CONVEX_URL is baked into the frontend at dev/build process START, and
// the platform env pipeline had not propagated the new value at migration
// time, so a stale URL pointing at the paused deployment is overridden here.
//
// REMOVE THIS SHIM once VITE_CONVEX_URL resolves correctly at the source
// (Frontend env var = https://trustworthy-clownfish-652.convex.cloud).

const MIGRATED_CLOUD_URL = "https://trustworthy-clownfish-652.convex.cloud";
const STALE_PREFIX = "https://successful-iguana-419.convex.cloud";

/**
 * Resolve the effective Convex cloud URL. Falls back to the migrated
 * deployment when the injected env var is missing, empty, or still pinned
 * to the retired paused deployment.
 */
export function resolveConvexUrl(raw: string | undefined | null): string {
  const url = (raw ?? "").trim();
  if (!url || url.startsWith(STALE_PREFIX)) return MIGRATED_CLOUD_URL;
  return url;
}
