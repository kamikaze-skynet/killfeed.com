# Killfeed.com  
**The Best FREE DayZ Killfeed for Console Servers on Discord**

Killfeed.com provides a **free, reliable, and community-driven DayZ killfeed** built specifically for **Xbox and PlayStation DayZ servers**. Designed for **server owners, admins, and players**, Killfeed.com delivers fast kill notifications, detailed player stats, and modern tools — all without paywalls.

## What Is Killfeed.com?

Killfeed.com is a **DayZ Discord killfeed platform** that tracks in-game events and sends them directly to your Discord server. It is optimized for **DayZ console servers** and built by experienced DayZ server owners who understand the limitations and needs of console communities.

Unlike outdated or paid alternatives, Killfeed.com focuses on **speed, stability, and transparency**, while remaining completely free to use.

## Key Features

- ✅ **100% Free DayZ Killfeed**
- 🎮 Built for **Xbox & PlayStation DayZ servers**
- ⚡ Fast, reliable Discord kill notifications
- 📊 Player stats, K/D tracking, and analytics
- 🔄 Multi-server support
- 🧠 Built by DayZ players & server owners
- 🔒 No paywalls, no locked features, no upsells
- 🌐 Modern web dashboard & tools
- 🤖 Discord bot integration

## Why Choose Killfeed.com?

Many DayZ killfeeds focus on drama, monetization, or outdated systems. Killfeed.com focuses on **features, performance, and the community**.

- No subscriptions  
- No hidden limits  
- No artificial restrictions  
- No “premium only” features  

If you’re running a DayZ server and want a **professional-grade Discord killfeed without paying monthly fees**, Killfeed.com is built for you.

## Who Is This For?

- DayZ **console server owners**
- Discord **admins and moderators**
- Competitive PvP servers
- Community-driven DayZ servers
- Players who want transparent stats and logs

## Technologies & Platform

Killfeed.com is powered by modern backend services, scalable infrastructure, and custom Discord bot integrations designed specifically for **DayZ console log processing**.

This GitHub repository exists to:
- Provide transparency
- Improve discoverability
- Document the Killfeed.com platform
- Host small open tooling for server owners

## Tools in this repository

- [`agents/speedtest/windows`](agents/speedtest/windows/README.md) — Windows PowerShell agent that measures ping, jitter, loss and iperf3 throughput between servers (plus an optional Ookla internet test) and posts the results to the Killfeed hub.
- [`agents/speedtest/linux`](agents/speedtest/linux/README.md) — the same agent for Linux hosts (bash + jq + curl), with systemd timer units. Both share one config format and payload.
- [`hub/skynet-website`](hub/skynet-website/README.md) — the receiving side: a **Speedtest** tab for the SkyNet website admin panel that stores agent results in MySQL, manages agent tokens, and charts latency, loss and throughput per link.

## Feature guides

Server-owner guides for features that ship with the SkyNet Killfeed bot and dashboard:

- [Self-service whitelist panel](docs/whitelist-panel.md) — a button panel per server; players enter their gamertag in a pop-up and are added to the Nitrado whitelist.
- [Map control](docs/map-control.md) — switch between Chernarus, Livonia and Sakhal with `/map change` or the dashboard **Map** tab, gated by Discord roles you choose.

## Official Website

🌐 **https://killfeed.com**

## Related Keywords

DayZ killfeed  
DayZ Discord killfeed  
Free DayZ killfeed  
DayZ console killfeed  
Xbox DayZ killfeed  
PlayStation DayZ killfeed  
DayZ server Discord bot  
DayZ PvP killfeed  
DayZ stats tracker  
