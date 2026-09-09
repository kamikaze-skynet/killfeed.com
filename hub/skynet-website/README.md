# Speedtest hub for the SkyNet website admin panel

This folder adds a **Speedtest** tab to the admin panel of the SkyNet website
(`SkyNet-Killfeed/website`, the Express + EJS app) and the endpoint the
[Windows](../../agents/speedtest/windows/README.md) and
[Linux](../../agents/speedtest/linux/README.md) agents post to. Results are
stored in the site's main MySQL database (the `DB_NAME` pool, default `skynet`).

What you get in the admin panel:

- Stat cards: links, healthy / degraded / down / stale, agents online, results in 24h.
- **Latest per link** table: newest ping, jitter, loss, download and upload for every
  server-to-target pair, with a status pill. Click a row to chart it.
- **History** charts (Chart.js, already on the page): latency + loss, and throughput,
  for 6h to 30d.
- **Agents**: create an agent and get its bearer token (shown once), rotate, disable,
  delete. Shows last seen time, source IP and result count per agent.
- **Recent results** table with an errors-only filter and a "delete older than N days"
  cleanup.

## Files

| file | copy to (inside `website/`) | purpose |
|------|-----------------------------|---------|
| `speedtestRoutes.js` | `speedtestRoutes.js` | `POST /api/speedtest/results` for agents, `/api/admin/speedtest/*` for the tab |
| `views/partials/speedtest-admin-tab.ejs` | `views/partials/` | the tab's HTML |
| `public/js/speedtest-admin.js` | `public/js/` | the tab's JavaScript |
| `migrations/create_speedtest_tables.js` | `migrations/` | optional explicit schema + `dashboard_tabs` row |
| `skynet-killfeed.patch` | repo root | all of the above plus the 4 wiring edits below, as one `git apply` |

## Install

From the `SkyNet-Killfeed` checkout:

```bash
git apply path/to/killfeed.com/hub/skynet-website/skynet-killfeed.patch
```

Or copy the four files per the table and make these edits by hand:

1. `server.js`, right after `app.use(logEventRoutes);`:
   ```js
   const speedtestRoutes = require('./speedtestRoutes');
   app.use(speedtestRoutes);
   ```
2. `public/js/admin-panel.js`, inside `switchTab()` next to the other tab loaders:
   ```js
   if (tabName === 'speedtest' && typeof initSpeedtestAdmin === 'function') {
     initSpeedtestAdmin();
   }
   ```
3. `views/admin-panel.ejs`: add a desktop tab button and a mobile nav item with
   `data-tab="speedtest"`, a panel
   `<div class="tab-panel" data-tab="speedtest"><%- include('partials/speedtest-admin-tab') %></div>`,
   and `<script src="/js/speedtest-admin.js"></script>` after `status-admin.js`.

Then restart the site. The two tables are created automatically on the first
request that touches them. To create them up front and register the tab in
`dashboard_tabs`, run:

```bash
node migrations/create_speedtest_tables.js
```

No new environment variables are required. Optionally set
`SPEEDTEST_AGENT_TOKEN` to a shared secret that every agent may use instead of a
per-agent token (results posted with it have no `agent_id`).

## Connect an agent

1. Admin Panel → **Speedtest** → **Agents** → enter a name (use the host's
   `ServerName`) → **Add agent**. Copy the token; it is shown once.
2. On the game host, in `speedtest-agent.json`:
   ```json
   "HubUrl": "https://dayzskynet.com",
   "AgentToken": "kfst_..."
   ```
3. Run the agent once by hand. The agent row shows **Online** with a last-seen time
   and the link table fills in.

## Schema

```sql
speedtest_agents  (id, name UNIQUE, token_hash CHAR(64) UNIQUE, token_prefix, enabled,
                   last_seen_at, last_ip, last_server, results_count, created_by, created_at)
speedtest_results (id, agent_id, server, target, ts INT UNSIGNED, ping_ms, jitter_ms,
                   loss_pct, down_mbps, up_mbps, error, raw JSON, created_at)
                   INDEX (server, target, ts), INDEX (ts), INDEX (agent_id)
```

Tokens are stored as SHA-256 hashes; the plaintext never touches the database.

## Endpoints

| method | path | auth | purpose |
|--------|------|------|---------|
| POST | `/api/speedtest/results` | `Authorization: Bearer <agent token>` | ingest a JSON array (max 500 rows) |
| GET | `/api/admin/speedtest/overview` | admin session | latest per link, agents, counts |
| GET | `/api/admin/speedtest/history?server=&target=&hours=` | admin session | series for charts (max 30d, 5000 points) |
| GET | `/api/admin/speedtest/results?limit=&offset=&server=&target=&errors=1` | admin session | raw rows, newest first |
| POST | `/api/admin/speedtest/cleanup` `{days}` | admin session | delete rows older than N days |
| GET / POST | `/api/admin/speedtest/agents` | admin session | list / create (returns token once) |
| POST | `/api/admin/speedtest/agents/:id/rotate` | admin session | new token, old one dies |
| POST | `/api/admin/speedtest/agents/:id/enabled` `{enabled}` | admin session | enable / disable |
| DELETE | `/api/admin/speedtest/agents/:id` | admin session | delete agent (results are kept) |

Link status: **down** when there is no ping reply, **degraded** when loss is 1% or
more or the agent reported an error, **stale** when the newest result is over an
hour old, otherwise **healthy**. Ingest validation clamps numbers to sane ranges,
truncates strings, replaces timestamps from the future with "now", and skips rows
without `server` and `target` (reported back as `rejected`).

## Tested

`speedtestRoutes.js` was exercised end to end with Express and an in-memory
stand-in for the mysql2 pool: admin auth (401/403), agent creation with hashed
tokens, duplicate and invalid names, bearer auth failures, the exact agent payload
including null metrics and error rows, clamping of bad values, single-object
bodies, status classification, history, filters and limit clamps, token
rotation, disable, the shared env token, cleanup, deletes and 404s, and the
500-row cap. The EJS partial and the full patched `admin-panel.ejs` render
cleanly with the tab, panel and script present.
