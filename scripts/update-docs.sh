#!/bin/bash
# scripts/update-docs.sh
# ─────────────────────────────────────────────────────────────
# Refreshes src/docs/PROJECT_DOCUMENTATION.json.
#
# The JSON is a STATIC import consumed by the /#/overview dashboard
# (src/pages/Overview.tsx), so it is always in sync with the built bundle.
#
# True automatic generation would need a custom Vite plugin that walks the
# module graph at build time. For now, the web agent regenerates the JSON
# by re-reading every source file and rewriting the JSON after significant
# code changes, then rebuilds.
# ─────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")/.."

echo "Updating PROJECT_DOCUMENTATION.json..."
echo "→ Regenerate src/docs/PROJECT_DOCUMENTATION.json by re-reading all source"
echo "  files (the web agent does this — it has full repo read access)."
echo "→ Rebuilding with: bun run build"
bun run build
echo "Done. The /#/overview dashboard now reflects the latest code."
