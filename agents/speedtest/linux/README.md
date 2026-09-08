# Killfeed speedtest agent (Linux)

Linux port of the [Windows agent](../windows/README.md). Same config file, same
payload, same hub endpoint, so a mixed fleet reports into one place. Per target it
collects ping (mean RTT, jitter, loss), iperf3 download and upload, and optionally
one Ookla `speedtest` run reported as target `internet`.

## Requirements

- bash 4+, `jq`, `curl`, `ping` (iputils)
- `iperf3` for throughput (throughput fields are `null` with an error otherwise)
- optional: [Ookla Speedtest CLI](https://www.speedtest.net/apps/cli) on `PATH` for
  `InternetTest`

```bash
# Debian / Ubuntu
sudo apt install -y jq curl iputils-ping iperf3
```

Every target must run an iperf3 server: `iperf3 -s -p 5201` (open the port to
the agent hosts only).

## Install

```bash
sudo mkdir -p /opt/killfeed/speedtest-agent
sudo cp speedtest-agent.sh /opt/killfeed/speedtest-agent/
sudo cp speedtest-agent.example.json /opt/killfeed/speedtest-agent/speedtest-agent.json
sudo chmod 600 /opt/killfeed/speedtest-agent/speedtest-agent.json   # holds the agent token
sudo nano /opt/killfeed/speedtest-agent/speedtest-agent.json        # HubUrl, AgentToken, ServerName, Targets
sudo /opt/killfeed/speedtest-agent/speedtest-agent.sh               # run once by hand
```

You should see one line per target and `posted N result(s) to <hub>`.

## Config

Identical to the Windows agent; see the
[config table](../windows/README.md#config). The only difference is `Iperf3Path`,
which defaults to `iperf3` found on `PATH`.

## Schedule it

Install the systemd units and enable the timer (every 15 minutes, with a random
delay of up to a minute so hosts don't all test each other at once):

```bash
sudo cp killfeed-speedtest.service killfeed-speedtest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now killfeed-speedtest.timer
systemctl list-timers killfeed-speedtest.timer     # next run
journalctl -u killfeed-speedtest.service -n 50     # output of the last runs
```

The service runs as root so it can read the mode-600 config and send ICMP. To
run it unprivileged, create a dedicated user that owns the config, set `User=`
in the service, and add `AmbientCapabilities=CAP_NET_RAW` if `ping` then reports
`ping failed` for every target under systemd but works from a shell.

Alternatively, a cron entry:

```
*/15 * * * * /opt/killfeed/speedtest-agent/speedtest-agent.sh >> /var/log/killfeed-speedtest.log 2>&1
```

Throughput tests saturate the link for `IperfSecs` seconds per direction, so
schedule outside peak hours if the host is serving players.

## Payload and exit codes

Same as the Windows agent: a JSON array POSTed to `{HubUrl}/api/results` with a
bearer token, see the [payload example](../windows/README.md#payload).

| code | meaning                                    |
|------|--------------------------------------------|
| 0    | posted, or nothing to post                 |
| 1    | measurements ran but the POST to the hub failed |
| 2    | config missing or invalid, missing `HubUrl`/`AgentToken`, or `jq`/`curl` not installed |
