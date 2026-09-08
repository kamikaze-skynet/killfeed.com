#!/usr/bin/env bash
# killfeed speedtest agent (Linux)
# Runs iperf3 + ping against each target, optionally Ookla speedtest for "internet", posts JSON to the hub.
#
# Usage:  speedtest-agent.sh [config.json]
# Config: speedtest-agent.json next to this script (same keys as the Windows agent, see speedtest-agent.example.json).
# Needs:  bash 4+, jq, curl, ping (iputils); iperf3 for throughput; Ookla "speedtest" CLI for the internet test.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${1:-$SCRIPT_DIR/speedtest-agent.json}"

for dep in jq curl; do
    command -v "$dep" >/dev/null 2>&1 || { echo "missing dependency: $dep" >&2; exit 2; }
done
[[ -f "$CONFIG" ]] || { echo "config not found: $CONFIG" >&2; exit 2; }
jq -e . "$CONFIG" >/dev/null 2>&1 || { echo "config is not valid JSON: $CONFIG" >&2; exit 2; }

cfg() { jq -r "$1 // empty" "$CONFIG"; }

HUB="$(cfg .HubUrl)"; HUB="${HUB%/}"
TOKEN="$(cfg .AgentToken)"
[[ -n "$HUB" && -n "$TOKEN" ]] || { echo "config needs HubUrl and AgentToken" >&2; exit 2; }
SERVER_NAME="$(cfg .ServerName)"; [[ -n "$SERVER_NAME" ]] || SERVER_NAME="$(hostname -s 2>/dev/null || hostname)"
IPERF="$(cfg .Iperf3Path)";       [[ -n "$IPERF" ]] || IPERF="iperf3"
SECS="$(cfg .IperfSecs)";         [[ -n "$SECS" ]] || SECS=10
PING_COUNT="$(cfg .PingCount)";   [[ -n "$PING_COUNT" ]] || PING_COUNT=20
INTERNET_TEST="$(jq -r 'if .InternetTest == true then "1" else "" end' "$CONFIG")"

HAVE_IPERF=1
if ! command -v "$IPERF" >/dev/null 2>&1; then
    HAVE_IPERF=""
    [[ "$(jq '.Targets // [] | length' "$CONFIG")" -gt 0 ]] && echo "iperf3 not found ($IPERF); skipping throughput tests" >&2
fi
command -v ping >/dev/null 2>&1 || echo "ping not found; ping metrics will be reported as failed" >&2

now() { date +%s; }

# Prints "avg jitter replies" from a ping run, or nothing if no reply came back.
# Uses only successful replies so timeouts do not count as 0 ms.
ping_stats() {
    local host="$1" count="$2"
    ping -n -c "$count" -i 0.2 -W 2 "$host" 2>/dev/null \
        | sed -n 's/.*time=\([0-9.]*\) *ms.*/\1/p' \
        | awk '{ v[NR]=$1; sum+=$1 }
               END { if (NR==0) exit 0
                     j=0; for (i=2;i<=NR;i++) { d=v[i]-v[i-1]; if (d<0) d=-d; j+=d }
                     printf "%.2f %.2f %d\n", sum/NR, (NR>1 ? j/(NR-1) : 0), NR }'
}

# Prints iperf3 JSON on stdout (may be an {"error": ...} document), or nothing.
run_iperf() {
    local host="$1" port="$2" reverse="${3:-}"
    [[ -n "$HAVE_IPERF" ]] || return 0
    local args=(-c "$host" -p "$port" -t "$SECS" -J)
    [[ -n "$reverse" ]] && args+=(-R)
    "$IPERF" "${args[@]}" 2>/dev/null
}

# Reads iperf3 JSON on stdin; prints two lines: Mbps (empty on failure) and an error message (empty on success).
iperf_mbps() {
    local path="$1" json; json="$(cat)"
    if [[ -z "$json" ]]; then
        if [[ -n "$HAVE_IPERF" ]]; then printf '\nno output\n'; else printf '\niperf3 missing\n'; fi; return
    fi
    local err; err="$(jq -r '.error // empty' <<<"$json" 2>/dev/null)"
    if [[ -n "$err" ]]; then printf '\n%s\n' "$err"; return; fi
    local bps; bps="$(jq -r "$path // empty" <<<"$json" 2>/dev/null)"
    if [[ -z "$bps" ]]; then printf '\nno output\n'; return; fi
    awk -v b="$bps" 'BEGIN { printf "%.1f\n\n", b/1e6 }'
}

RESULTS=()   # one JSON object per entry

while IFS= read -r target; do
    host="$(jq -r '.Host // empty' <<<"$target")"; [[ -n "$host" ]] || continue
    port="$(jq -r '.Port // 5201' <<<"$target")"
    name="$(jq -r ".Name // \"$host\"" <<<"$target")"
    ts="$(now)"
    ping_ms=null; jitter_ms=null; loss_pct=null; down=null; up=null
    errs=()

    # ping
    stats="$(ping_stats "$host" "$PING_COUNT")"
    if [[ -n "$stats" ]]; then
        read -r ping_ms jitter_ms replies <<<"$stats"
        loss_pct="$(awk -v r="$replies" -v n="$PING_COUNT" 'BEGIN { printf "%.1f", 100*(1-r/n) }')"
    else
        loss_pct=100; errs+=("ping failed")
    fi

    # iperf3 download (reverse: server sends, we receive)
    { read -r val; read -r err; } < <(run_iperf "$host" "$port" R | iperf_mbps .end.sum_received.bits_per_second)
    if [[ -n "$val" ]]; then down="$val"; else errs+=("iperf3 down failed: $err"); fi
    sleep 1
    # iperf3 upload
    { read -r val; read -r err; } < <(run_iperf "$host" "$port" | iperf_mbps .end.sum_sent.bits_per_second)
    if [[ -n "$val" ]]; then up="$val"; else errs+=("iperf3 up failed: $err"); fi

    error=null
    if ((${#errs[@]})); then error="$(printf '%s; ' "${errs[@]}")"; error="$(jq -Rn --arg e "${error%; }" '$e')"; fi

    RESULTS+=("$(jq -cn --arg server "$SERVER_NAME" --arg target "$name" --argjson ts "$ts" \
        --argjson ping_ms "$ping_ms" --argjson jitter_ms "$jitter_ms" --argjson loss_pct "$loss_pct" \
        --argjson down_mbps "$down" --argjson up_mbps "$up" --argjson error "$error" \
        '{server:$server, target:$target, ts:$ts, ping_ms:$ping_ms, jitter_ms:$jitter_ms, loss_pct:$loss_pct, down_mbps:$down_mbps, up_mbps:$up_mbps, error:$error}')")
    echo "[$SERVER_NAME -> $name] down=$down up=$up ping=$ping_ms loss=$loss_pct ${error//\"/}"
done < <(jq -c '.Targets // [] | .[]' "$CONFIG")

if [[ -n "$INTERNET_TEST" ]]; then
    if command -v speedtest >/dev/null 2>&1; then
        ts="$(now)"
        st="$(speedtest --accept-license --accept-gdpr -f json 2>/dev/null)"
        if r="$(jq -ce --arg server "$SERVER_NAME" --argjson ts "$ts" '
                select(.download.bandwidth != null and .upload.bandwidth != null) |
                { server: $server, target: "internet", ts: $ts,
                  ping_ms: .ping.latency, jitter_ms: .ping.jitter,
                  loss_pct: (if (.packetLoss | type) == "number" then .packetLoss else 0 end),
                  down_mbps: ((.download.bandwidth * 8 / 1e6 * 10 | round) / 10),
                  up_mbps:   ((.upload.bandwidth   * 8 / 1e6 * 10 | round) / 10),
                  error: null,
                  raw: { isp: .isp, server: .server.name } }' <<<"$st" 2>/dev/null)"; then
            RESULTS+=("$r")
            echo "[$SERVER_NAME -> internet] $(jq -r '"down=\(.down_mbps) up=\(.up_mbps) ping=\(.ping_ms)"' <<<"$r")"
        else
            RESULTS+=("$(jq -cn --arg server "$SERVER_NAME" --argjson ts "$ts" '{server:$server, target:"internet", ts:$ts, error:"speedtest failed"}')")
            echo "[$SERVER_NAME -> internet] speedtest failed"
        fi
    else
        echo "InternetTest enabled but Ookla 'speedtest' CLI not on PATH; skipping" >&2
    fi
fi

((${#RESULTS[@]})) || { echo "nothing to post"; exit 0; }

BODY="$(printf '%s\n' "${RESULTS[@]}" | jq -cs .)"
if resp="$(curl -sS --fail-with-body --max-time 30 -X POST "$HUB/api/speedtest/results" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json; charset=utf-8" \
        --data-binary "$BODY" 2>&1)"; then
    echo "posted ${#RESULTS[@]} result(s) to $HUB"
else
    echo "POST failed: $resp" >&2; exit 1
fi
