#!/bin/bash
# Expose MNEMO to your other devices (iPhone/iPad) over Tailscale. Prefers a private HTTPS
# URL (needed for the installable PWA + offline). If HTTPS certs aren't enabled on the
# tailnet yet, it falls back to the tailnet HTTP address and tells you the one toggle to flip.
set -e

TS=""
for cand in "$(command -v tailscale 2>/dev/null)" \
  /usr/local/bin/tailscale /opt/homebrew/bin/tailscale \
  /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  [ -n "$cand" ] && [ -x "$cand" ] && { TS="$cand"; break; }
done
[ -z "$TS" ] && { echo "Tailscale CLI not found. Install: brew install --cask tailscale (then sign in)."; exit 1; }

"$TS" status >/dev/null 2>&1 || { echo "Tailscale isn't connected — open the Tailscale app and sign in, then re-run."; exit 1; }

NAME=$("$TS" status --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write((JSON.parse(d).Self.DNSName||'').replace(/\.$/,''))}catch(e){}})")
IP=$("$TS" ip -4 2>/dev/null | head -1)

echo "Setting up HTTPS for $NAME …"
( "$TS" serve --bg 3000 >/dev/null 2>&1 ) & sp=$!
disown "$sp" 2>/dev/null || true
ok=0
for _ in $(seq 1 20); do
  "$TS" serve status 2>/dev/null | grep -q "https://" && { ok=1; break; }
  sleep 1
done
kill "$sp" 2>/dev/null || true

if [ "$ok" = 1 ]; then
  echo
  echo "✅ MNEMO is live for all your devices at:"
  echo "      https://$NAME"
  echo
  echo "On your iPhone (Tailscale signed in, same account): open that URL in Safari,"
  echo "log in, then Share → Add to Home Screen. Full-screen app + offline."
else
  "$TS" serve reset 2>/dev/null || true
  echo
  echo "⚠️  HTTPS certificates aren't enabled on your tailnet yet (required for the installable,"
  echo "    offline app icon). Enable them once — it's a single click:"
  echo
  echo "      1. Open: https://login.tailscale.com/admin/dns"
  echo "      2. Under 'HTTPS Certificates', click 'Enable HTTPS'."
  echo "      3. Re-run:  pnpm mnemo:expose"
  echo
  echo "    Want to use MNEMO on your iPhone RIGHT NOW (no offline) — open this in Safari"
  echo "    and Add to Home Screen:"
  echo "      http://$IP:3000"
fi
