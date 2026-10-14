#!/usr/bin/env bash
# Clean, credential-free source export of one commit for a worker deploy (`railway up`), with the commit recorded in worker/BUILD_INFO.json
# (the upload has no .git). Usage: scripts/export-worker-source.sh <commit> <empty-dir>
set -euo pipefail
commit=$(git rev-parse --verify "$1^{commit}"); dir=$2
[ -z "$(ls -A "$dir" 2>/dev/null || true)" ] || { echo "target dir must be empty: $dir" >&2; exit 1; }
mkdir -p "$dir"; git archive "$commit" | tar -x -C "$dir"
printf '{ "commit": "%s", "exportedAt": "%s" }\n' "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/worker/BUILD_INFO.json"
echo "exported $commit to $dir ($(find "$dir" -type f | wc -l) files); env-like files:"; find "$dir" -maxdepth 3 \( -name '.env*' -o -name '*.pem' -o -name '*.key' \) -print
