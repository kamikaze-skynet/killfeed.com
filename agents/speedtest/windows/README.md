# Killfeed speedtest agent (Windows)

A small PowerShell agent that measures network quality from a Windows game host to
other Killfeed servers and (optionally) the public internet, then posts the results
to the Killfeed hub. Run it on a schedule to get a history of latency, jitter, loss
and throughput between servers.

Per target it collects:

| field       | source                     | notes                              |
|-------------|----------------------------|------------------------------------|
| `ping_ms`   | `Test-Connection`          | mean RTT of successful replies     |
| `jitter_ms` | `Test-Connection`          | mean absolute RTT delta            |
| `loss_pct`  | `Test-Connection`          | `100 * (1 - replies / PingCount)`  |
| `down_mbps` | `iperf3 -R` (reverse)      | server sends, this host receives   |
| `up_mbps`   | `iperf3`                   | this host sends                    |

With `InternetTest: true` and the Ookla `speedtest` CLI on `PATH`, one extra
result with `target = "internet"` is added.

Works on Windows PowerShell 5.1 and PowerShell 7+.

## Files

- `speedtest-agent.ps1` — the agent.
- `speedtest-agent.example.json` — config template. Copy to `speedtest-agent.json`
  next to the script (or pass `-ConfigPath`).

## Install

1. Create a folder, e.g. `C:\killfeed\speedtest-agent`, and copy both files into it.
2. Download the Windows build of [iperf3](https://iperf.fr/iperf-download.php) and
   unpack it to `C:\killfeed\speedtest-agent\iperf3\` so `iperf3.exe` is there
   (or set `Iperf3Path` in the config). `cygwin1.dll` must stay next to the exe.
3. Optional, for the internet test: install the
   [Ookla Speedtest CLI](https://www.speedtest.net/apps/cli) and make sure
   `speedtest.exe` is on `PATH`.
4. Every target must run an iperf3 server: `iperf3 -s -p 5201` (open the port in
   the firewall for the agent hosts only).
5. Copy `speedtest-agent.example.json` to `speedtest-agent.json` and fill in
   `HubUrl`, `AgentToken`, `ServerName` and `Targets`.
6. Test it once by hand:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\killfeed\speedtest-agent\speedtest-agent.ps1
   ```

   You should see one line per target and `posted N result(s) to <hub>`.

## Config

| key            | required | default                        | meaning                                   |
|----------------|----------|--------------------------------|-------------------------------------------|
| `HubUrl`       | yes      |                                | hub base URL, results go to `/api/results` |
| `AgentToken`   | yes      |                                | bearer token for this agent               |
| `ServerName`   | no       | `$env:COMPUTERNAME`            | name reported as `server`                 |
| `Iperf3Path`   | no       | `<script dir>\iperf3\iperf3.exe` | path to `iperf3.exe`                    |
| `IperfSecs`    | no       | `10`                           | seconds per iperf3 run (one per direction) |
| `PingCount`    | no       | `20`                           | pings per target                          |
| `InternetTest` | no       | `false`                        | run Ookla speedtest too                   |
| `Targets`      | no       | `[]`                           | list of `{ Name, Host, Port }` (Port default 5201) |

## Schedule it

Run as a scheduled task every 15 minutes (adjust the path and interval):

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\killfeed\speedtest-agent\speedtest-agent.ps1"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "Killfeed Speedtest Agent" -Action $action -Trigger $trigger `
  -User "SYSTEM" -RunLevel Highest -Description "Posts network measurements to the Killfeed hub"
```

Each run takes roughly `Targets * (2 * IperfSecs + PingCount) + ~40s` for the
internet test, so keep the interval well above that. Throughput tests saturate the
link for `IperfSecs` seconds per direction, so schedule them outside peak hours if
the host is serving players.

## Payload

The agent POSTs a JSON array to `POST {HubUrl}/api/results` with
`Authorization: Bearer {AgentToken}`:

```json
[
  {
    "server": "dayz-eu-1", "target": "dayz-us-1", "ts": 1757347200,
    "ping_ms": 92.4, "jitter_ms": 1.3, "loss_pct": 0,
    "down_mbps": 941.2, "up_mbps": 902.7, "error": null
  },
  {
    "server": "dayz-eu-1", "target": "internet", "ts": 1757347260,
    "ping_ms": 4.1, "jitter_ms": 0.4, "loss_pct": 0,
    "down_mbps": 955.0, "up_mbps": 930.3, "error": null,
    "raw": { "isp": "Example ISP", "server": "Example Speedtest Server" }
  }
]
```

Metric fields are `null` and `error` is filled when a measurement failed
(e.g. `"iperf3 down failed: unable to connect to server"`).

## Exit codes

| code | meaning                                    |
|------|--------------------------------------------|
| 0    | posted, or nothing to post                 |
| 1    | measurements ran but the POST to the hub failed |
| 2    | config missing or missing `HubUrl`/`AgentToken` |
