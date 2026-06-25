#!/bin/bash
# Ensure MNEMO's dependencies are up: Postgres (docker) + Ollama (local LLM). Idempotent —
# safe to call repeatedly. Used by the launchd services and the MNEMO.app launcher.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
log() { echo "[mnemo-deps $(date '+%H:%M:%S')] $*"; }

# ── Postgres (native Homebrew postgresql@16 on 127.0.0.1:55432) ───────────────
# Native (not Docker): brew's launchd service auto-starts it at login. This is just a
# safety net + a readiness wait. Probe TCP directly (fast: open/refused, never hangs).
db_reachable() { (exec 3<>/dev/tcp/127.0.0.1/55432) 2>/dev/null && { exec 3>&- 3<&- 2>/dev/null; return 0; } || return 1; }

if ! db_reachable; then
  brew services start postgresql@16 >/dev/null 2>&1 || true
fi
db_up=0
for _ in $(seq 1 60); do
  if db_reachable; then db_up=1; break; fi
  sleep 1
done
[ "$db_up" = 1 ] && log "postgres up" || log "WARN: postgres 55432 not reachable"

# ── Ollama (local model server on 11434) ─────────────────────────────────────
if ! curl -sf http://localhost:11434/api/version >/dev/null 2>&1; then
  brew services start ollama >/dev/null 2>&1 || (ollama serve >/dev/null 2>&1 &)
  for _ in $(seq 1 30); do
    curl -sf http://localhost:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
fi
curl -sf http://localhost:11434/api/version >/dev/null 2>&1 && log "ollama up" || log "WARN: ollama not reachable"
