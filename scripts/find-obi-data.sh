#!/bin/sh
# Lists every Docker volume on this host that contains an Obi database,
# newest first, with its user/workspace counts.
#
# Use it to recover data after deploying without a persistent /data mount:
# each redeploy left the previous data behind in an unnamed volume.
#
#   sh scripts/find-obi-data.sh
#
# Read-only: volumes are mounted :ro and the database is inspected from a copy.

IMAGE="${IMAGE:-node:24-alpine}"

out=$(
  for vol in $(docker volume ls -q); do
    docker run --rm -v "$vol":/v:ro -e VOL="$vol" "$IMAGE" sh -c '
      [ -f /v/obi.db ] || exit 0
      mkdir -p /tmp/o && cp /v/obi.db* /tmp/o/ 2>/dev/null
      node --disable-warning=ExperimentalWarning -e "
        const fs = require(\"fs\")
        const { DatabaseSync } = require(\"node:sqlite\")
        let users = \"?\", workspaces = \"?\", names = \"\"
        try {
          const db = new DatabaseSync(\"/tmp/o/obi.db\")
          users = db.prepare(\"SELECT COUNT(*) AS n FROM users\").get().n
          workspaces = db.prepare(\"SELECT COUNT(*) AS n FROM workspaces\").get().n
          names = db.prepare(\"SELECT username FROM users ORDER BY created_at\").all().map((r) => r.username).join(\",\")
        } catch (e) { names = \"(unreadable: \" + e.message + \")\" }
        const mtime = [\"obi.db\", \"obi.db-wal\"].filter((f) => fs.existsSync(\"/v/\" + f))
          .map((f) => fs.statSync(\"/v/\" + f).mtimeMs).reduce((a, b) => Math.max(a, b), 0)
        console.log([new Date(mtime).toISOString(), process.env.VOL, \"users=\" + users, \"workspaces=\" + workspaces, names].join(\"  \"))
      "
    ' 2>/dev/null
  done | sort -r
)

if [ -z "$out" ]; then
  echo "No volumes containing an Obi database were found."
  exit 1
fi
echo "LAST WRITE                VOLUME  USERS  WORKSPACES  USERNAMES"
echo "$out"
