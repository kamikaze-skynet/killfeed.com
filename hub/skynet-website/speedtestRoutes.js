/**
 * Speedtest Routes
 * - POST /api/speedtest/results  : agents (Windows/Linux speedtest-agent) post measurements, bearer-token auth
 * - /api/admin/speedtest/*        : admin panel JSON APIs (Discord-admin session), used by the Speedtest tab
 *
 * Tables (created on first use, see ensureSpeedtestTables):
 *   speedtest_agents  - one row per agent, token stored as SHA-256 hash
 *   speedtest_results - one row per (server -> target) measurement
 */

const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "").split(",").filter(id => id.trim());
const MAX_ROWS_PER_POST = 500;
const TOKEN_PREFIX = "kfst_";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS speedtest_agents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    token_prefix CHAR(12) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at DATETIME NULL,
    last_ip VARCHAR(45) NULL,
    last_server VARCHAR(64) NULL,
    results_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_by VARCHAR(32) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_name (name),
    UNIQUE KEY uq_token_hash (token_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS speedtest_results (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    agent_id INT NULL,
    server VARCHAR(64) NOT NULL,
    target VARCHAR(64) NOT NULL,
    ts INT UNSIGNED NOT NULL,
    ping_ms DECIMAL(9,2) NULL,
    jitter_ms DECIMAL(9,2) NULL,
    loss_pct DECIMAL(5,1) NULL,
    down_mbps DECIMAL(10,1) NULL,
    up_mbps DECIMAL(10,1) NULL,
    error VARCHAR(512) NULL,
    raw JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_link_ts (server, target, ts),
    INDEX idx_ts (ts),
    INDEX idx_agent (agent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let schemaReady = null;
function ensureSpeedtestTables(pool) {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of SCHEMA) await pool.query(sql);
      console.log("[Speedtest] tables ready");
    })().catch(err => {
      schemaReady = null; // retry on next request
      throw err;
    });
  }
  return schemaReady;
}

async function withSchema(req, res, next) {
  const pool = req.app.get("pool");
  if (!pool) return res.status(503).json({ success: false, error: "Database unavailable" });
  try {
    await ensureSpeedtestTables(pool);
    req.speedtestPool = pool;
    next();
  } catch (error) {
    console.error("[Speedtest] schema init failed:", error.message);
    res.status(503).json({ success: false, error: "Database unavailable" });
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function isAdmin(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  if (!ADMIN_DISCORD_IDS.includes(String(req.user.id))) {
    return res.status(403).json({ success: false, error: "Unauthorized - Admin access required" });
  }
  next();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function generateToken() {
  return TOKEN_PREFIX + crypto.randomBytes(24).toString("hex");
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (typeof fwd === "string" && fwd.split(",")[0].trim()) || req.ip || req.socket?.remoteAddress || null;
  return ip ? String(ip).slice(0, 45) : null;
}

/** Bearer token of a registered, enabled agent; SPEEDTEST_AGENT_TOKEN env works as a shared fallback. */
async function authenticateAgent(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ success: false, error: "Missing bearer token" });
  }
  const token = match[1];

  const shared = process.env.SPEEDTEST_AGENT_TOKEN;
  if (shared && token.length === shared.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(shared))) {
    req.speedtestAgent = null;
    return next();
  }

  try {
    const [rows] = await req.speedtestPool.query(
      "SELECT id, name, enabled FROM speedtest_agents WHERE token_hash = ? LIMIT 1",
      [hashToken(token)]
    );
    if (!rows.length) return res.status(401).json({ success: false, error: "Invalid token" });
    if (!rows[0].enabled) return res.status(403).json({ success: false, error: "Agent disabled" });
    req.speedtestAgent = rows[0];
    next();
  } catch (error) {
    console.error("[Speedtest] agent auth failed:", error.message);
    res.status(500).json({ success: false, error: "Auth lookup failed" });
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function str(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function num(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

function intParam(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Normalise one agent payload object into a DB row, or return null if unusable. */
function normaliseResult(item, agent) {
  if (!item || typeof item !== "object") return null;
  const server = str(item.server, 64);
  const target = str(item.target, 64);
  if (!server || !target) return null;

  const now = Math.floor(Date.now() / 1000);
  let ts = num(item.ts, 0, 4294967295);
  ts = ts === null ? now : Math.round(ts);
  if (ts > now + 300) ts = now; // reject clocks far in the future

  let raw = null;
  if (item.raw && typeof item.raw === "object") {
    try {
      raw = JSON.stringify(item.raw).slice(0, 4000);
      JSON.parse(raw);
    } catch {
      raw = null;
    }
  }

  return [
    agent ? agent.id : null,
    server,
    target,
    ts,
    num(item.ping_ms, 0, 9999999),
    num(item.jitter_ms, 0, 9999999),
    num(item.loss_pct, 0, 100),
    num(item.down_mbps, 0, 999999999),
    num(item.up_mbps, 0, 999999999),
    str(item.error, 512),
    raw,
  ];
}

// ---------------------------------------------------------------------------
// Agent ingest
// ---------------------------------------------------------------------------

router.post("/api/speedtest/results", withSchema, authenticateAgent, async (req, res) => {
  const pool = req.speedtestPool;
  const body = Array.isArray(req.body) ? req.body : req.body && typeof req.body === "object" ? [req.body] : null;
  if (!body) return res.status(400).json({ success: false, error: "Body must be a JSON array of results" });
  if (body.length > MAX_ROWS_PER_POST) {
    return res.status(413).json({ success: false, error: `Too many rows (max ${MAX_ROWS_PER_POST})` });
  }

  const rows = body.map(item => normaliseResult(item, req.speedtestAgent)).filter(Boolean);
  const rejected = body.length - rows.length;
  if (!rows.length) return res.status(400).json({ success: false, error: "No valid results in body", rejected });

  try {
    await pool.query(
      `INSERT INTO speedtest_results
        (agent_id, server, target, ts, ping_ms, jitter_ms, loss_pct, down_mbps, up_mbps, error, raw)
       VALUES ?`,
      [rows]
    );
    if (req.speedtestAgent) {
      await pool.query(
        `UPDATE speedtest_agents
           SET last_seen_at = NOW(), last_ip = ?, last_server = ?, results_count = results_count + ?
         WHERE id = ?`,
        [clientIp(req), rows[0][1], rows.length, req.speedtestAgent.id]
      );
    }
    res.json({ success: true, inserted: rows.length, rejected });
  } catch (error) {
    console.error("[Speedtest] insert failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to store results" });
  }
});

// ---------------------------------------------------------------------------
// Admin: overview / history / results
// ---------------------------------------------------------------------------

const STALE_AFTER_SECS = 60 * 60; // no result in an hour = agent probably stopped

function classify(row, nowSecs) {
  if (nowSecs - row.ts > STALE_AFTER_SECS) return "stale";
  if (row.ping_ms === null) return "down";
  if (row.error || (row.loss_pct !== null && row.loss_pct >= 1)) return "degraded";
  return "healthy";
}

function toNumber(v) {
  return v === null || v === undefined ? null : Number(v);
}

function shapeRow(row) {
  return {
    id: Number(row.id),
    agent_id: row.agent_id === null ? null : Number(row.agent_id),
    server: row.server,
    target: row.target,
    ts: Number(row.ts),
    ping_ms: toNumber(row.ping_ms),
    jitter_ms: toNumber(row.jitter_ms),
    loss_pct: toNumber(row.loss_pct),
    down_mbps: toNumber(row.down_mbps),
    up_mbps: toNumber(row.up_mbps),
    error: row.error,
    raw: typeof row.raw === "string" ? safeJson(row.raw) : row.raw ?? null,
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Latest result per (server, target) link, agent list, and headline counts
router.get("/api/admin/speedtest/overview", isAdmin, withSchema, async (req, res) => {
  const pool = req.speedtestPool;
  try {
    const [latest] = await pool.query(
      `SELECT r.* FROM speedtest_results r
         JOIN (SELECT server, target, MAX(id) AS id FROM speedtest_results GROUP BY server, target) m
           ON m.id = r.id
        ORDER BY r.server, r.target`
    );
    const [agents] = await pool.query(
      `SELECT id, name, token_prefix, enabled, last_seen_at, last_ip, last_server, results_count, created_at
         FROM speedtest_agents ORDER BY name`
    );
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const [[counts]] = await pool.query(
      `SELECT COUNT(*) AS results_24h,
              SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors_24h,
              COUNT(DISTINCT server) AS servers
         FROM speedtest_results WHERE ts >= ?`,
      [dayAgo]
    );

    const now = Math.floor(Date.now() / 1000);
    const links = latest.map(r => ({ ...shapeRow(r), status: classify(shapeRow(r), now) }));
    const summary = { healthy: 0, degraded: 0, down: 0, stale: 0 };
    links.forEach(l => { summary[l.status] += 1; });

    const servers = [...new Set(links.map(l => l.server))].sort();
    const targets = [...new Set(links.map(l => l.target))].sort();
    const agentsOnline = agents.filter(a => a.enabled && a.last_seen_at && (Date.now() - new Date(a.last_seen_at).getTime()) < STALE_AFTER_SECS * 1000).length;

    res.json({
      success: true,
      links,
      servers,
      targets,
      agents: agents.map(a => ({ ...a, enabled: !!a.enabled, results_count: Number(a.results_count) })),
      summary: {
        ...summary,
        links: links.length,
        servers: Number(counts.servers || 0),
        results_24h: Number(counts.results_24h || 0),
        errors_24h: Number(counts.errors_24h || 0),
        agents: agents.length,
        agents_online: agentsOnline,
        stale_after_secs: STALE_AFTER_SECS,
      },
    });
  } catch (error) {
    console.error("[Speedtest] overview failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to load overview" });
  }
});

// Time series for one link (chart)
router.get("/api/admin/speedtest/history", isAdmin, withSchema, async (req, res) => {
  const server = str(req.query.server, 64);
  const target = str(req.query.target, 64);
  if (!server || !target) return res.status(400).json({ success: false, error: "server and target are required" });
  const hours = intParam(req.query.hours, 24, 1, 24 * 30);
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  try {
    const [rows] = await req.speedtestPool.query(
      `SELECT id, agent_id, server, target, ts, ping_ms, jitter_ms, loss_pct, down_mbps, up_mbps, error
         FROM speedtest_results
        WHERE server = ? AND target = ? AND ts >= ?
        ORDER BY ts ASC
        LIMIT 5000`,
      [server, target, since]
    );
    res.json({ success: true, server, target, hours, points: rows.map(shapeRow) });
  } catch (error) {
    console.error("[Speedtest] history failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to load history" });
  }
});

// Recent raw results with optional filters
router.get("/api/admin/speedtest/results", isAdmin, withSchema, async (req, res) => {
  const limit = intParam(req.query.limit, 100, 1, 500);
  const offset = intParam(req.query.offset, 0, 0, 1000000);
  const where = [];
  const params = [];
  const server = str(req.query.server, 64);
  const target = str(req.query.target, 64);
  if (server) { where.push("server = ?"); params.push(server); }
  if (target) { where.push("target = ?"); params.push(target); }
  if (req.query.errors === "1") where.push("error IS NOT NULL");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const [rows] = await req.speedtestPool.query(
      `SELECT * FROM speedtest_results ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ success: true, results: rows.map(shapeRow), limit, offset });
  } catch (error) {
    console.error("[Speedtest] results failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to load results" });
  }
});

// Delete results older than N days
router.post("/api/admin/speedtest/cleanup", isAdmin, withSchema, async (req, res) => {
  const days = intParam(req.body && req.body.days, 30, 1, 3650);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  try {
    const [result] = await req.speedtestPool.query("DELETE FROM speedtest_results WHERE ts < ?", [cutoff]);
    res.json({ success: true, deleted: result.affectedRows || 0, days });
  } catch (error) {
    console.error("[Speedtest] cleanup failed:", error.message);
    res.status(500).json({ success: false, error: "Cleanup failed" });
  }
});

// ---------------------------------------------------------------------------
// Admin: agents & tokens
// ---------------------------------------------------------------------------

router.get("/api/admin/speedtest/agents", isAdmin, withSchema, async (req, res) => {
  try {
    const [agents] = await req.speedtestPool.query(
      `SELECT id, name, token_prefix, enabled, last_seen_at, last_ip, last_server, results_count, created_by, created_at
         FROM speedtest_agents ORDER BY name`
    );
    res.json({ success: true, agents: agents.map(a => ({ ...a, enabled: !!a.enabled, results_count: Number(a.results_count) })) });
  } catch (error) {
    console.error("[Speedtest] agents failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to load agents" });
  }
});

// Create an agent; the plaintext token is returned exactly once
router.post("/api/admin/speedtest/agents", isAdmin, withSchema, async (req, res) => {
  const name = str(req.body && req.body.name, 64);
  if (!name || !/^[\w .\-]+$/.test(name)) {
    return res.status(400).json({ success: false, error: "Name is required (letters, digits, space, . _ -)" });
  }
  const token = generateToken();
  try {
    const [result] = await req.speedtestPool.query(
      `INSERT INTO speedtest_agents (name, token_hash, token_prefix, created_by) VALUES (?, ?, ?, ?)`,
      [name, hashToken(token), token.slice(0, 12), String(req.user.id)]
    );
    res.json({ success: true, agent: { id: result.insertId, name, token_prefix: token.slice(0, 12), enabled: true }, token });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, error: "An agent with that name already exists" });
    }
    console.error("[Speedtest] create agent failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to create agent" });
  }
});

// Issue a new token for an existing agent (old token stops working immediately)
router.post("/api/admin/speedtest/agents/:id/rotate", isAdmin, withSchema, async (req, res) => {
  const id = intParam(req.params.id, 0, 1, 2147483647);
  if (!id) return res.status(400).json({ success: false, error: "Invalid agent id" });
  const token = generateToken();
  try {
    const [result] = await req.speedtestPool.query(
      "UPDATE speedtest_agents SET token_hash = ?, token_prefix = ? WHERE id = ?",
      [hashToken(token), token.slice(0, 12), id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: "Agent not found" });
    res.json({ success: true, id, token, token_prefix: token.slice(0, 12) });
  } catch (error) {
    console.error("[Speedtest] rotate token failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to rotate token" });
  }
});

router.post("/api/admin/speedtest/agents/:id/enabled", isAdmin, withSchema, async (req, res) => {
  const id = intParam(req.params.id, 0, 1, 2147483647);
  if (!id) return res.status(400).json({ success: false, error: "Invalid agent id" });
  const enabled = !!(req.body && (req.body.enabled === true || req.body.enabled === "true"));
  try {
    const [result] = await req.speedtestPool.query("UPDATE speedtest_agents SET enabled = ? WHERE id = ?", [enabled, id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, error: "Agent not found" });
    res.json({ success: true, id, enabled });
  } catch (error) {
    console.error("[Speedtest] toggle agent failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to update agent" });
  }
});

router.delete("/api/admin/speedtest/agents/:id", isAdmin, withSchema, async (req, res) => {
  const id = intParam(req.params.id, 0, 1, 2147483647);
  if (!id) return res.status(400).json({ success: false, error: "Invalid agent id" });
  try {
    const [result] = await req.speedtestPool.query("DELETE FROM speedtest_agents WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, error: "Agent not found" });
    res.json({ success: true, id });
  } catch (error) {
    console.error("[Speedtest] delete agent failed:", error.message);
    res.status(500).json({ success: false, error: "Failed to delete agent" });
  }
});

module.exports = router;
module.exports.ensureSpeedtestTables = ensureSpeedtestTables;
module.exports.SCHEMA = SCHEMA;
