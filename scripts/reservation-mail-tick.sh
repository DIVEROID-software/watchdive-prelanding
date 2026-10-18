#!/bin/sh
# Office Mac mini periodic reservation-mail tick.
# Dry-run unless the gate file's entire contents equal the campaign id.
# This file does not install launchd and does not send by itself.
# The lock is a directory. This shell removes it on exit, including when node
# fails. Replacing the shell would skip that cleanup and leave tick.lock
# behind. A dead pid left by kill -9 or an older stuck run is reclaimed. A
# live pid is not stolen. PID reuse can let a later tick remove a lock whose
# pid number now belongs to an unrelated process; root checks the tick log if
# a run looks stuck. This shell does not source the env file.
set -eu

CAMPAIGN="wd-reservation-invite-v1"
ROOT="${WATCHDIVE_RESERVATION_MAIL_ROOT:-/Users/macm4/OrcaProjects/watchdive-marketing/ads/autopilot/reservation-20261018/implementation}"
PRIVATE="${WATCHDIVE_RESERVATION_MAIL_HOME:-$HOME/.config/watchdive-autopilot/reservation-mail}"
ENV_FILE="${WATCHDIVE_RESERVATION_MAIL_ENV:-$HOME/.config/watchdive-autopilot/reservation-mail.env}"
LOCK="$PRIVATE/tick.lock"
GATE="$PRIVATE/send-enabled"
RECEIPTS="$PRIVATE/receipts"

mkdir -p "$PRIVATE" "$RECEIPTS"
chmod 700 "$PRIVATE" "$RECEIPTS"

# Exit 0 when the recorded pid still exists. Empty or non-numeric pid is
# treated as held so a corrupt lock is not deleted out from under a live run.
lock_pid_alive() {
  if [ ! -f "$LOCK/pid" ]; then
    return 1
  fi
  pid=$(tr -cd '0-9' < "$LOCK/pid" || true)
  if [ -z "$pid" ]; then
    return 0
  fi
  kill -0 "$pid" 2>/dev/null
}

if ! mkdir "$LOCK" 2>/dev/null; then
  if lock_pid_alive; then
    echo "lock held; nothing sent"
    exit 0
  fi
  rm -rf "$LOCK"
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "lock held; nothing sent"
    exit 0
  fi
fi
cleanup() {
  rm -rf "$LOCK"
}
trap cleanup EXIT INT TERM
printf '%s\n' "$$" > "$LOCK/pid"

cd "$ROOT"

set -- \
  --experimental-strip-types \
  --env-file="$ENV_FILE" \
  scripts/reservation-mail.ts \
  --receipt-dir "$RECEIPTS" \
  --out-dir "$PRIVATE/preview"

if [ -f "$GATE" ]; then
  gate=$(tr -d '[:space:]' < "$GATE")
  if [ "$gate" = "$CAMPAIGN" ]; then
    set -- "$@" --send --confirm-campaign "$CAMPAIGN"
  fi
fi

node "$@"
