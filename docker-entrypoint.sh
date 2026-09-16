#!/bin/sh
set -e

# Make sure the data volume is writable by the unprivileged "node" user.
if [ -d /data ]; then
  owner="$(stat -c %u /data 2>/dev/null || echo 0)"
  if [ "$owner" != "$(id -u node)" ]; then
    chown node:node /data 2>/dev/null || true
    # only deep-chown when the volume is small or clearly not ours yet
    if [ ! -f /data/.obi-owned ]; then
      chown -R node:node /data 2>/dev/null || true
      su-exec node touch /data/.obi-owned 2>/dev/null || true
    fi
  fi
fi

if [ "$(id -u)" = "0" ]; then
  exec su-exec node "$@"
fi
exec "$@"
