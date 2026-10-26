#!/usr/bin/env bash
# Frees the dev ports (5000 backend, 8080 frontend) by killing the WHOLE process
# group of whatever holds them — so the npm -> nest/vite -> node watcher trees
# are torn down too, not just the leaf server. Used as the launch config's
# postDebugTask so stopping the run never leaves stale servers behind.
for port in 5000 8080; do
  for pid in $(lsof -ti:"$port" 2>/dev/null); do
    pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -n "$pgid" ] && kill -TERM "-$pgid" 2>/dev/null
  done
done
true
