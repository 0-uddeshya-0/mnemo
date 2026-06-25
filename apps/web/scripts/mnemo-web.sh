#!/bin/bash
# MNEMO production web server (Next.js). Run/kept-alive by launchd (com.mnemo.web).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export NODE_ENV=production
export PORT=3000
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$DIR/scripts/mnemo-deps.sh"
cd "$DIR" || exit 1

# Build on first run (or if the build was cleared).
[ -d .next ] || pnpm build

exec pnpm start
