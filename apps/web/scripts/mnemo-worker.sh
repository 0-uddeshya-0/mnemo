#!/bin/bash
# MNEMO background worker (ingest, nightly synthesis, daily digest). Kept alive by launchd
# (com.mnemo.worker). This is what makes the proactive companion run on its own.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV=production
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$DIR/scripts/mnemo-deps.sh"
cd "$DIR" || exit 1

exec pnpm worker
