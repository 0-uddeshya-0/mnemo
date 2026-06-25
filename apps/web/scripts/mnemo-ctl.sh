#!/bin/bash
# MNEMO control: status / restart / stop / start / logs. Manages the launchd services
# (web + worker) that run the production app on this Mac.
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin"
UID_NUM="$(id -u)"
GUI="gui/$UID_NUM"
WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

svc_state() { launchctl print "$GUI/$1" 2>/dev/null | grep -E "state = " | head -1 | sed 's/.*state = //'; }
port_up()   { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && { exec 3>&- 3<&- 2>/dev/null; echo up; } || echo down; }

case "${1:-status}" in
  status)
    echo "MNEMO status"
    echo "  postgres (55432): $(port_up 55432)"
    echo "  ollama   (11434): $(port_up 11434)"
    echo "  web      (3000) : $(port_up 3000)"
    echo "  service web      : $(svc_state com.mnemo.web)"
    echo "  service worker   : $(svc_state com.mnemo.worker)"
    curl -s -o /dev/null -w "  http /login      : %{http_code}\n" http://localhost:3000/login 2>/dev/null
    ;;
  deploy)
    # Safe rebuild: stop the web service FIRST so its auto-build can't race ours.
    echo "stopping web…"; launchctl bootout "$GUI/com.mnemo.web" 2>/dev/null; sleep 2
    pkill -f "next start" 2>/dev/null || true
    cd "$WEB" || exit 1
    rm -rf .next
    echo "building…"
    if pnpm build; then
      launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/com.mnemo.web.plist" && echo "✓ deployed"
    else
      echo "✗ build failed — bringing the old service back"
      launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/com.mnemo.web.plist"
      exit 1
    fi
    ;;
  restart)
    launchctl kickstart -k "$GUI/com.mnemo.web" 2>/dev/null && echo "web restarted"
    launchctl kickstart -k "$GUI/com.mnemo.worker" 2>/dev/null && echo "worker restarted"
    ;;
  stop)
    launchctl bootout "$GUI/com.mnemo.web" 2>/dev/null && echo "web stopped"
    launchctl bootout "$GUI/com.mnemo.worker" 2>/dev/null && echo "worker stopped"
    ;;
  start)
    launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/com.mnemo.web.plist" 2>/dev/null && echo "web started"
    launchctl bootstrap "$GUI" "$HOME/Library/LaunchAgents/com.mnemo.worker.plist" 2>/dev/null && echo "worker started"
    ;;
  logs)
    tail -n 40 -F "$HOME/Library/Logs/mnemo/web.log" "$HOME/Library/Logs/mnemo/worker.log"
    ;;
  backup)
    bash "$WEB/scripts/mnemo-backup.sh" backup
    ;;
  restore)
    bash "$WEB/scripts/mnemo-backup.sh" restore "${2:-}"
    ;;
  *)
    echo "usage: pnpm mnemo <status|restart|deploy|stop|start|logs|backup|restore <dir>>"
    ;;
esac
