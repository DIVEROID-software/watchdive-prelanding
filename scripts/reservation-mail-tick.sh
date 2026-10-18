#!/bin/sh
# Office Mac mini periodic reservation-mail tick.
# Dry-run unless the gate file's entire contents equal the campaign id.
# This file does not install launchd and does not send by itself.
# A kill -9 can leave tick.lock behind. Root removes that directory only
# after confirming the recorded pid is dead.
set -eu

CAMPAIGN="wd-reservation-invite-v1"
ROOT="/Users/macm4/OrcaProjects/watchdive-marketing/ads/autopilot/reservation-20261018/implementation"
PRIVATE="${WATCHDIVE_RESERVATION_MAIL_HOME:-$HOME/.config/watchdive-autopilot/reservation-mail}"
ENV_FILE="${WATCHDIVE_RESERVATION_MAIL_ENV:-$HOME/.config/watchdive-autopilot/reservation-mail.env}"
LOCK="$PRIVATE/tick.lock"
GATE="$PRIVATE/send-enabled"
RECEIPTS="$PRIVATE/receipts"

mkdir -p "$PRIVATE" "$RECEIPTS"
chmod 700 "$PRIVATE" "$RECEIPTS"

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "lock held; nothing sent"
  exit 0
fi
printf '%s\n' "$$" > "$LOCK/pid"
cleanup() {
  rm -rf "$LOCK"
}
trap cleanup EXIT INT TERM

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

exec node "$@"
