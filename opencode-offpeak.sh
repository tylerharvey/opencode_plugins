#!/usr/bin/env bash
# Release a prompt to opencode when DeepSeek off-peak hours begin.
# Off-peak: 00-01, 04-06, 10-24 UTC (cheap)
# On-peak:  01-04, 06-10 UTC (expensive)
#
# Usage:
#   opencode-offpeak "your prompt here"
#   opencode-offpeak -w 300 "your prompt"   # override wait window (seconds)
#   opencode-offpeak -f prompt.txt           # read prompt from file
#   echo "prompt" | opencode-offpeak -       # read from stdin

set -euo pipefail

WAIT_OVERRIDE=""
PROMPT_FILE=""
PROMPT=""

usage() {
  echo "Usage: opencode-offpeak [-w seconds] [-f file | - | prompt] [-m model]" >&2
  echo "  -w SEC    override: wait at most SEC seconds, then release anyway" >&2
  echo "  -f FILE   read prompt from FILE" >&2
  echo "  -m MODEL  Flash | Pro" >&2
  echo "  -         read prompt from stdin" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -w) WAIT_OVERRIDE="$2"; shift 2 ;;
    -f) PROMPT_FILE="$2"; shift 2 ;;
    -m) MODEL="$2"; shift 2 ;;
    -)  PROMPT="$(cat)"; shift ;;
    -h|--help) usage ;;
    *)  PROMPT="$1"; shift ;;
  esac
done

if [[ -n "$PROMPT_FILE" ]]; then
  PROMPT="$(cat "$PROMPT_FILE")"
fi

if [[ -z "$PROMPT" ]]; then
  echo "Error: no prompt provided" >&2
  usage
fi

if [[ -z "$MODEL" ]]; then
  MODEL="Flash"
fi

case "$MODEL" in
  Flash) MODELSTRING="-m \"DeepSeek V4 Flash\"";;
  Pro) MODELSTRING="-m \"DeepSeek V4 Pro\"";;
  *) echo "Error: invalid model string" >&2 && usage;;
esac

# --- peak/off-peak logic ---

off_peak_start_hours=(0 4 10)  # UTC hours when off-peak begins

current_utc_hour() {
  date -u +%H
}

current_utc_minute() {
  date -u +%M
}

# Returns 0 if off-peak, 1 if on-peak.
is_off_peak() {
  local h
  h=$(current_utc_hour)
  case "$h" in
    00|04|05|10|11|12|13|14|15|16|17|18|19|20|21|22|23) return 0 ;;
    *) return 1 ;;
  esac
}

# Seconds until next off-peak window (00, 04, or 10 UTC).
seconds_until_offpeak() {
  local h m next_h offset
  h=$(current_utc_hour)
  m=$(current_utc_minute)
  h=$((10#$h))  # strip leading zero
  m=$((10#$m))
  local now_secs=$(( h * 3600 + m * 60 ))

  # Off-peak starts at 0:00, 4:00, 10:00 UTC each day
  # Find the next one
  local candidates=(0 4 10)
  local best_offset=999999

  for next_h in "${candidates[@]}"; do
    offset=$(( next_h * 3600 - now_secs ))
    if [[ $offset -le 0 ]]; then
      offset=$(( offset + 86400 ))  # next day
    fi
    if [[ $offset -lt $best_offset ]]; then
      best_offset=$offset
    fi
  done

  echo "$best_offset"
}

human_duration() {
  local secs=$1
  local h=$(( secs / 3600 ))
  local m=$(( (secs % 3600) / 60 ))
  local parts=()
  [[ $h -gt 0 ]] && parts+=("${h}h")
  [[ $m -gt 0 ]] && parts+=("${m}m")
  local s=$(( secs % 60 ))
  [[ ${#parts[@]} -eq 0 ]] && parts+=("${s}s")
  echo "${parts[*]}"
}

# --- main ---

if is_off_peak; then
  echo "Off-peak active. Releasing now."
  opencode run "$PROMPT" "$MODELSTRING"
  exit $?
fi

wait_secs=$(seconds_until_offpeak)
max_wait="${WAIT_OVERRIDE:-}"

if [[ -n "$max_wait" ]] && [[ $wait_secs -gt $max_wait ]]; then
  echo "On-peak. Next off-peak in $(human_duration $wait_secs), but max wait is ${max_wait}s." >&2
  echo "Releasing now anyway." >&2
  opencode run "$PROMPT" "$MODELSTRING"
  exit $?
fi

echo "On-peak. Waiting $(human_duration $wait_secs) for off-peak to begin..."
sleep "$wait_secs"

echo "Off-peak started. Releasing prompt."
opencode run "$PROMPT" "$MODELSTRING"
