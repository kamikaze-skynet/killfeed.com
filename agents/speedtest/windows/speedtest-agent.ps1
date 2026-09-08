# killfeed speedtest agent (Windows)
# Runs iperf3 + ping against each target, optionally Ookla speedtest for "internet", posts JSON to the hub.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File speedtest-agent.ps1 [-ConfigPath <path>]
# Config: speedtest-agent.json next to this script (see speedtest-agent.example.json).
# Works on Windows PowerShell 5.1 and PowerShell 7+.
param([string]$ConfigPath = "$PSScriptRoot\speedtest-agent.json")

$ErrorActionPreference = "Continue"

if (-not (Test-Path $ConfigPath)) { Write-Host "config not found: $ConfigPath"; exit 2 }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if (-not $cfg.HubUrl -or -not $cfg.AgentToken) { Write-Host "config needs HubUrl and AgentToken"; exit 2 }

$hub        = $cfg.HubUrl.TrimEnd("/")
$token      = $cfg.AgentToken
$serverName = if ($cfg.ServerName) { $cfg.ServerName } else { $env:COMPUTERNAME }
$iperf      = if ($cfg.Iperf3Path) { $cfg.Iperf3Path } else { "$PSScriptRoot\iperf3\iperf3.exe" }
$secs       = if ($cfg.IperfSecs) { [int]$cfg.IperfSecs } else { 10 }
$pingCount  = if ($cfg.PingCount) { [int]$cfg.PingCount } else { 20 }
$targets    = @($cfg.Targets)

# Windows PowerShell 5.1 defaults to TLS 1.0 on older builds; the hub needs TLS 1.2.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$haveIperf = Test-Path $iperf
if ($targets.Count -and -not $haveIperf) { Write-Host "iperf3 not found at $iperf (set Iperf3Path in config); skipping throughput tests" }

$results = @()
function Now { [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }

function Run-Iperf([string]$h, [int]$p, [switch]$Reverse) {
    if (-not $haveIperf) { return $null }
    $iperfArgs = @("-c", $h, "-p", $p, "-t", $secs, "-J")
    if ($Reverse) { $iperfArgs += "-R" }
    $out = & $iperf @iperfArgs 2>$null | Out-String
    if (-not $out) { return $null }
    try { return $out | ConvertFrom-Json } catch { return $null }
}

# Returns the round-trip times (ms) of successful replies only.
# PS 5.1 (Win32_PingStatus): StatusCode 0 = success, ResponseTime.  PS 7+: Status "Success", Latency.
function Get-PingRtts([string]$h, [int]$count) {
    $pings = @(Test-Connection -ComputerName $h -Count $count -ErrorAction SilentlyContinue)
    $rtts = foreach ($x in $pings) {
        if ($null -eq $x) { continue }
        if ($x.PSObject.Properties["Status"]) {
            if ("$($x.Status)" -eq "Success") { $x.Latency }
        } elseif ($x.PSObject.Properties["StatusCode"]) {
            if ($x.StatusCode -eq 0) { $x.ResponseTime }
        } elseif ($x.PSObject.Properties["ResponseTime"]) {
            $x.ResponseTime
        }
    }
    return @($rtts | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ })
}

foreach ($t in $targets) {
    if (-not $t.Host) { continue }
    $h = $t.Host
    $p = if ($t.Port) { [int]$t.Port } else { 5201 }
    $name = if ($t.Name) { $t.Name } else { $h }
    $r = [ordered]@{ server = $serverName; target = $name; ts = (Now); ping_ms = $null; jitter_ms = $null; loss_pct = $null; down_mbps = $null; up_mbps = $null; error = $null }
    $errs = @()

    # ping
    try {
        $rtts = Get-PingRtts $h $pingCount
        if ($rtts.Count -gt 0) {
            $r.ping_ms  = [math]::Round(($rtts | Measure-Object -Average).Average, 2)
            $r.loss_pct = [math]::Round(100 * (1 - $rtts.Count / $pingCount), 1)
            if ($rtts.Count -gt 1) {
                $diffs = for ($i = 1; $i -lt $rtts.Count; $i++) { [math]::Abs($rtts[$i] - $rtts[$i-1]) }
                $r.jitter_ms = [math]::Round(($diffs | Measure-Object -Average).Average, 2)
            } else { $r.jitter_ms = 0 }
        } else { $r.loss_pct = 100; $errs += "ping failed" }
    } catch { $errs += "ping failed" }

    # iperf3 download (reverse: server sends, we receive)
    $j = Run-Iperf $h $p -Reverse
    if ($j -and -not $j.error -and $j.end.sum_received) { $r.down_mbps = [math]::Round($j.end.sum_received.bits_per_second / 1e6, 1) }
    else { $errs += "iperf3 down failed: " + $(if ($j -and $j.error) { $j.error } elseif (-not $haveIperf) { "iperf3 missing" } else { "no output" }) }
    Start-Sleep 1
    # iperf3 upload
    $j = Run-Iperf $h $p
    if ($j -and -not $j.error -and $j.end.sum_sent) { $r.up_mbps = [math]::Round($j.end.sum_sent.bits_per_second / 1e6, 1) }
    else { $errs += "iperf3 up failed: " + $(if ($j -and $j.error) { $j.error } elseif (-not $haveIperf) { "iperf3 missing" } else { "no output" }) }

    if ($errs.Count) { $r.error = ($errs -join "; ") }
    $results += [pscustomobject]$r
    Write-Host "[$serverName -> $name] down=$($r.down_mbps) up=$($r.up_mbps) ping=$($r.ping_ms) loss=$($r.loss_pct) $($r.error)"
}

if ($cfg.InternetTest) {
    if (Get-Command speedtest -ErrorAction SilentlyContinue) {
        $out = speedtest --accept-license --accept-gdpr -f json 2>$null | Out-String
        try {
            $s = $out | ConvertFrom-Json
            if (-not $s.download -or -not $s.upload) { throw "unexpected speedtest output" }
            $loss = 0
            if ($null -ne $s.packetLoss -and "$($s.packetLoss)" -match '^[0-9.]+$') { $loss = [double]$s.packetLoss }
            $results += [pscustomobject]@{
                server = $serverName; target = "internet"; ts = (Now)
                ping_ms = $s.ping.latency; jitter_ms = $s.ping.jitter; loss_pct = $loss
                down_mbps = [math]::Round($s.download.bandwidth * 8 / 1e6, 1); up_mbps = [math]::Round($s.upload.bandwidth * 8 / 1e6, 1)
                error = $null
                raw = @{ isp = $s.isp; server = $s.server.name }
            }
            Write-Host "[$serverName -> internet] down=$($results[-1].down_mbps) up=$($results[-1].up_mbps) ping=$($results[-1].ping_ms)"
        } catch {
            $results += [pscustomobject]@{ server = $serverName; target = "internet"; ts = (Now); error = "speedtest failed" }
            Write-Host "[$serverName -> internet] speedtest failed"
        }
    } else {
        Write-Host "InternetTest enabled but Ookla 'speedtest' CLI not on PATH; skipping"
    }
}

if (-not $results.Count) { Write-Host "nothing to post"; exit 0 }

$body = ConvertTo-Json -InputObject @($results) -Depth 5 -Compress
try {
    Invoke-RestMethod -Method Post -Uri "$hub/api/speedtest/results" -ContentType "application/json; charset=utf-8" `
        -Headers @{ Authorization = "Bearer $token" } -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
    Write-Host "posted $($results.Count) result(s) to $hub"
} catch { Write-Host "POST failed: $_"; exit 1 }
