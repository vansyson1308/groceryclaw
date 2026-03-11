#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORKFLOW_DIR="n8n/workflows"
if [[ ! -d "$WORKFLOW_DIR" ]]; then
  echo "[validate_workflows] missing directory: $WORKFLOW_DIR" >&2
  exit 1
fi

EXIT_CODE=0

echo "[validate_workflows] JSON validation"
while IFS= read -r file; do
  if ! python -m json.tool "$file" >/dev/null; then
    echo "[validate_workflows] invalid JSON: $file" >&2
    EXIT_CODE=1
  fi
done < <(find "$WORKFLOW_DIR" -maxdepth 1 -type f -name '*.json' | sort)

echo "[validate_workflows] secret-pattern scan"
# Allow env variable placeholders like {{$env.X}} and generic field names, but block concrete token-like assignments.
if rg -n "Bearer\s+[A-Za-z0-9._-]{20,}|Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}|(api[_-]?key|refresh[_-]?token|access[_-]?token|client[_-]?secret)\s*[:=]\s*['\"][A-Za-z0-9._-]{16,}['\"]" "$WORKFLOW_DIR"; then
  echo "[validate_workflows] suspicious token-like string detected" >&2
  EXIT_CODE=1
fi

if [[ "$EXIT_CODE" -ne 0 ]]; then
  exit "$EXIT_CODE"
fi

echo "[validate_workflows] all checks passed"
