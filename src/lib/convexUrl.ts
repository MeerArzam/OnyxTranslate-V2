// Deployment-migration shim (updated 2026-09-26).
//
// Migration chain: successful-iguana-419 (platform, paused 2026-09-18) →
// trustworthy-clownfish-652 (owner, plan-disabled 2026-09-26) →
// quixotic-tapir-141 (current owner deployment, verified live 2026-09-26).
//
// VITE_CONVEX_URL is baked into the frontend at dev/build process START, and
// the platform env pipeline had not propagated the new value at migration
// time, so a stale URL pointing at the paused deployment is overridden here.
//
// REMOVE THIS SHIM once VITE_CONVEX_URL resolves correctly at the source
// (Frontend env var = https://trustworthy-clownfish-652.convex.cloud).

const MIGRATED_CLOUD_URL = "https://quixotic-tapir-141.convex.cloud";
const STALE_PREFIXES = [
  "https://successful-iguana-419.convex.cloud",
  "https://trustworthy-clownfish-652.convex.cloud",
];

/**
 * Resolve the effective Convex cloud URL. Falls back to the current
 * deployment when the injected env var is missing, empty, or still pinned
 * to a retired deployment (iguana: paused; clownfish: plan-disabled).
 */
export function resolveConvexUrl(raw: string | undefined | null): string {
  const url = (raw ?? "").trim();
  if (!url || STALE_PREFIXES.some((p) => url.startsWith(p))) return MIGRATED_CLOUD_URL;
  return url;
}
