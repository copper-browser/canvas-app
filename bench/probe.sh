#!/usr/bin/env bash
# Probe Copper for the canvas bench (Linux): its own headless weston socket, world cfix, MCP :4203.
#   BENCH_COPPER=/path/to/copper ./probe.sh start|stop
# WebKit's sandbox is off because a copper outside /usr/bin is not covered by the .deb's
# AppArmor profile (bwrap cannot map uids); it is off for both sides of the A/B alike.
set -u
COPPER=${BENCH_COPPER:-$(command -v copper)}
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
case "${1:-start}" in
start)
  setsid /usr/bin/weston --backend=headless --renderer=pixman --socket=copper-bench-wl --width=1440 --height=900 --idle-time=0 </dev/null >/tmp/copper-bench-weston.log 2>&1 &
  for i in $(seq 50); do [ -S "$XDG_RUNTIME_DIR/copper-bench-wl" ] && break; sleep 0.1; done
  WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 WAYLAND_DISPLAY=copper-bench-wl GDK_BACKEND=wayland NO_AT_BRIDGE=1 GTK_A11Y=none COPPER_WORLD=cfix SEARCH_PROBE=cfix SEARCH_MCP_PORT=4203 \
    setsid /usr/bin/dbus-run-session -- "$COPPER" </dev/null >/tmp/copper-cfix.log 2>&1 &
  ;;
stop)
  for p in $(ss -ltnp 'sport = :4203' | grep -o 'pid=[0-9]*' | cut -d= -f2); do kill "$p"; done
  pkill -f -- '--socket=copper-bench-wl' ;;
esac
