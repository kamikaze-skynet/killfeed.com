/**
 * Speedtest Admin Tab JavaScript
 * Renders the server-to-server network measurements posted by the speedtest agents.
 * Entry point: initSpeedtestAdmin() (called from switchTab in admin-panel.js).
 */

let stOverview = null;
let stCharts = { latency: null, throughput: null };
let stRefreshTimer = null;
let stInitialised = false;
const ST_REFRESH_MS = 60 * 1000;

// =====================================================
// HELPERS
// =====================================================

function stEscape(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stFmt(value, digits = 1, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '<span class="text-gray-600">-</span>';
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function stAge(tsSecs) {
  if (!tsSecs) return '-';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - Number(tsSecs));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function stAgeFromDate(dateString) {
  if (!dateString) return '<span class="text-gray-600">never</span>';
  const ms = new Date(dateString).getTime();
  if (Number.isNaN(ms)) return '-';
  return stAge(Math.floor(ms / 1000));
}

function stStatusPill(status, labelOverride) {
  const map = {
    healthy: ['bg-green-500/20 text-green-400', 'fa-check-circle', 'Healthy'],
    degraded: ['bg-yellow-500/20 text-yellow-400', 'fa-exclamation-triangle', 'Degraded'],
    down: ['bg-red-500/20 text-red-400', 'fa-times-circle', 'Down'],
    stale: ['bg-gray-500/20 text-gray-400', 'fa-clock', 'Stale'],
  };
  const [cls, icon, label] = map[status] || map.stale;
  return `<span class="px-2 py-1 rounded-full text-xs font-semibold ${cls}"><i class="fas ${icon} mr-1"></i>${labelOverride || label}</span>`;
}

function stNotify(message, type) {
  if (typeof showStatus === 'function') showStatus(message, type);
  else console.log(`[Speedtest] ${type}: ${message}`);
}

async function stConfirm(message) {
  if (typeof showConfirmModal === 'function') return showConfirmModal(message);
  return window.confirm(message);
}

async function stFetch(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function stLinkKey(server, target) {
  return `${server}\t${target}`;
}

function stTabIsActive() {
  const panel = document.querySelector('.tab-panel[data-tab="speedtest"]');
  return !!(panel && panel.classList.contains('active'));
}

// =====================================================
// OVERVIEW: stats, links matrix, selectors
// =====================================================

async function loadSpeedtestOverview() {
  try {
    const data = await stFetch('/api/admin/speedtest/overview');
    stOverview = data;
    renderSpeedtestStats(data.summary);
    renderSpeedtestSelectors(data);
    renderSpeedtestLinks();
    renderSpeedtestAgents(data.agents);
  } catch (error) {
    console.error('[Speedtest] overview error:', error);
    stNotify(`Speedtest: ${error.message}`, 'error');
  }
}

function renderSpeedtestStats(summary) {
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('st-stat-links', summary.links);
  set('st-stat-servers', summary.servers);
  set('st-stat-healthy', summary.healthy);
  set('st-stat-issues', summary.degraded + summary.down + summary.stale);
  set('st-stat-degraded', summary.degraded);
  set('st-stat-down', summary.down);
  set('st-stat-stale', summary.stale);
  set('st-stat-agents', `${summary.agents_online} / ${summary.agents}`);
  set('st-stat-results-24h', summary.results_24h);
  const dot = document.getElementById('st-stat-agents-dot');
  if (dot) {
    let state = 'offline';
    if (summary.agents > 0 && summary.agents_online === summary.agents) state = 'online';
    else if (summary.agents_online > 0) state = 'degraded';
    dot.className = `status-dot ${state}`;
  }
}

function renderSpeedtestSelectors(data) {
  const serverSel = document.getElementById('st-filter-server');
  if (serverSel) {
    const current = serverSel.value;
    serverSel.innerHTML = '<option value="">All servers</option>' +
      data.servers.map(s => `<option value="${stEscape(s)}">${stEscape(s)}</option>`).join('');
    if (data.servers.includes(current)) serverSel.value = current;
  }

  const linkSel = document.getElementById('st-history-link');
  if (linkSel) {
    const current = linkSel.value;
    linkSel.innerHTML = '<option value="">Select link...</option>' +
      data.links.map(l => {
        const key = stLinkKey(l.server, l.target);
        return `<option value="${stEscape(key)}">${stEscape(l.server)} to ${stEscape(l.target)}</option>`;
      }).join('');
    if (current && data.links.some(l => stLinkKey(l.server, l.target) === current)) {
      linkSel.value = current;
    } else if (!current && data.links.length) {
      linkSel.value = stLinkKey(data.links[0].server, data.links[0].target);
      loadSpeedtestHistory();
    }
  }
}

function renderSpeedtestLinks() {
  const body = document.getElementById('st-links-body');
  if (!body || !stOverview) return;
  const filter = (document.getElementById('st-filter-server') || {}).value || '';
  const links = stOverview.links.filter(l => !filter || l.server === filter);

  if (!links.length) {
    body.innerHTML = '<tr><td colspan="10" class="py-6 text-center text-gray-500">No results yet. Add an agent below and point it at this site.</td></tr>';
    return;
  }

  body.innerHTML = links.map(l => `
    <tr class="border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer" onclick="selectSpeedtestLink(this.dataset.server, this.dataset.target)" data-server="${stEscape(l.server)}" data-target="${stEscape(l.target)}">
      <td class="py-2 pr-3">${stStatusPill(l.status)}</td>
      <td class="py-2 pr-3 font-semibold text-white">${stEscape(l.server)}</td>
      <td class="py-2 pr-3 text-gray-300">${stEscape(l.target)}</td>
      <td class="py-2 pr-3 text-right font-mono">${stFmt(l.ping_ms, 1, ' ms')}</td>
      <td class="py-2 pr-3 text-right font-mono">${stFmt(l.jitter_ms, 1, ' ms')}</td>
      <td class="py-2 pr-3 text-right font-mono ${l.loss_pct > 0 ? 'text-yellow-400' : ''}">${stFmt(l.loss_pct, 1, '%')}</td>
      <td class="py-2 pr-3 text-right font-mono">${stFmt(l.down_mbps, 0)}</td>
      <td class="py-2 pr-3 text-right font-mono">${stFmt(l.up_mbps, 0)}</td>
      <td class="py-2 pr-3 text-gray-400 text-xs">${stAge(l.ts)}</td>
      <td class="py-2 text-xs text-red-400/80 max-w-xs truncate" title="${stEscape(l.error || '')}">${stEscape(l.error || '')}</td>
    </tr>`).join('');
}

function selectSpeedtestLink(server, target) {
  const sel = document.getElementById('st-history-link');
  if (!sel) return;
  sel.value = stLinkKey(server, target);
  loadSpeedtestHistory();
  const card = document.getElementById('st-chart-latency');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// =====================================================
// HISTORY CHARTS
// =====================================================

async function loadSpeedtestHistory() {
  const sel = document.getElementById('st-history-link');
  const hoursSel = document.getElementById('st-history-hours');
  const title = document.getElementById('st-history-title');
  if (!sel || !sel.value) return;
  const [server, target] = sel.value.split('\t');
  const hours = hoursSel ? hoursSel.value : 24;

  try {
    const data = await stFetch(`/api/admin/speedtest/history?server=${encodeURIComponent(server)}&target=${encodeURIComponent(target)}&hours=${encodeURIComponent(hours)}`);
    if (title) title.textContent = `${server} to ${target} - ${data.points.length} samples over ${hours}h`;
    renderSpeedtestCharts(data.points);
  } catch (error) {
    console.error('[Speedtest] history error:', error);
    stNotify(`Speedtest history: ${error.message}`, 'error');
  }
}

function stChartOptions(yTitle, y1Title) {
  const scales = {
    x: { ticks: { color: '#9ca3af', maxTicksLimit: 8 }, grid: { color: 'rgba(148,163,184,0.1)' } },
    y: { beginAtZero: true, title: { display: true, text: yTitle, color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { color: 'rgba(148,163,184,0.1)' } },
  };
  if (y1Title) {
    scales.y1 = { position: 'right', beginAtZero: true, max: 100, title: { display: true, text: y1Title, color: '#9ca3af' }, ticks: { color: '#9ca3af' }, grid: { drawOnChartArea: false } };
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: '#d1d5db' } } },
    scales,
  };
}

function renderSpeedtestCharts(points) {
  if (typeof Chart === 'undefined') return;
  const labels = points.map(p => {
    const d = new Date(p.ts * 1000);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  });
  const series = key => points.map(p => (p[key] === null ? null : p[key]));

  const latencyCtx = document.getElementById('st-chart-latency');
  const throughputCtx = document.getElementById('st-chart-throughput');
  if (!latencyCtx || !throughputCtx) return;

  if (stCharts.latency) stCharts.latency.destroy();
  if (stCharts.throughput) stCharts.throughput.destroy();

  stCharts.latency = new Chart(latencyCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Ping (ms)', data: series('ping_ms'), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.15)', tension: 0.25, pointRadius: 2, spanGaps: false, yAxisID: 'y' },
        { label: 'Jitter (ms)', data: series('jitter_ms'), borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.15)', tension: 0.25, pointRadius: 2, spanGaps: false, yAxisID: 'y' },
        { label: 'Loss (%)', data: series('loss_pct'), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.2)', tension: 0.1, pointRadius: 2, stepped: true, yAxisID: 'y1' },
      ],
    },
    options: stChartOptions('ms', '% loss'),
  });

  stCharts.throughput = new Chart(throughputCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Download (Mbps)', data: series('down_mbps'), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.15)', tension: 0.25, pointRadius: 2, fill: true },
        { label: 'Upload (Mbps)', data: series('up_mbps'), borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.15)', tension: 0.25, pointRadius: 2, fill: true },
      ],
    },
    options: stChartOptions('Mbps'),
  });
}

// =====================================================
// AGENTS & TOKENS
// =====================================================

function renderSpeedtestAgents(agents) {
  const body = document.getElementById('st-agents-body');
  if (!body) return;
  if (!agents || !agents.length) {
    body.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-500">No agents yet. Add one above to get a token.</td></tr>';
    return;
  }
  const staleMs = ((stOverview && stOverview.summary && stOverview.summary.stale_after_secs) || 3600) * 1000;
  body.innerHTML = agents.map(a => {
    const seenMs = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0;
    const online = a.enabled && seenMs && (Date.now() - seenMs) < staleMs;
    let status;
    if (!a.enabled) status = stStatusPill('stale', 'Disabled');
    else if (online) status = stStatusPill('healthy', 'Online');
    else status = stStatusPill('down', 'Offline');
    const reportsAs = a.last_server && a.last_server !== a.name
      ? `<div class="text-xs text-gray-500">reports as ${stEscape(a.last_server)}</div>` : '';
    return `
      <tr class="border-b border-slate-800" data-id="${a.id}" data-name="${stEscape(a.name)}">
        <td class="py-2 pr-3 font-semibold text-white">${stEscape(a.name)}${reportsAs}</td>
        <td class="py-2 pr-3 font-mono text-xs text-gray-400">${stEscape(a.token_prefix)}...</td>
        <td class="py-2 pr-3">${status}</td>
        <td class="py-2 pr-3 text-xs text-gray-400">${stAgeFromDate(a.last_seen_at)}</td>
        <td class="py-2 pr-3 font-mono text-xs text-gray-400">${stEscape(a.last_ip || '-')}</td>
        <td class="py-2 pr-3 text-right font-mono">${a.results_count}</td>
        <td class="py-2 text-right whitespace-nowrap">
          <button onclick="toggleSpeedtestAgent(${a.id}, ${a.enabled ? 'false' : 'true'})" class="action-btn bg-slate-700 hover:bg-slate-600 text-white text-xs" title="${a.enabled ? 'Disable' : 'Enable'}">
            <i class="fas ${a.enabled ? 'fa-pause' : 'fa-play'}"></i>
          </button>
          <button onclick="rotateSpeedtestAgent(${a.id}, this.closest('tr').dataset.name)" class="action-btn bg-slate-700 hover:bg-slate-600 text-white text-xs" title="Rotate token">
            <i class="fas fa-key"></i>
          </button>
          <button onclick="deleteSpeedtestAgent(${a.id}, this.closest('tr').dataset.name)" class="action-btn bg-red-600/70 hover:bg-red-600 text-white text-xs" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>`;
  }).join('');
}

function showSpeedtestToken(agentName, token) {
  const box = document.getElementById('st-token-reveal');
  const nameEl = document.getElementById('st-token-agent');
  const valueEl = document.getElementById('st-token-value');
  if (!box || !nameEl || !valueEl) return;
  nameEl.textContent = agentName;
  valueEl.textContent = token;
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideSpeedtestToken() {
  const box = document.getElementById('st-token-reveal');
  const valueEl = document.getElementById('st-token-value');
  if (valueEl) valueEl.textContent = '';
  if (box) box.classList.add('hidden');
}

async function copySpeedtestToken() {
  const valueEl = document.getElementById('st-token-value');
  if (!valueEl || !valueEl.textContent) return;
  try {
    await navigator.clipboard.writeText(valueEl.textContent);
    stNotify('Token copied to clipboard', 'success');
  } catch {
    stNotify('Copy failed. Select the token and copy it manually.', 'error');
  }
}

async function createSpeedtestAgent(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('st-agent-name');
  const name = input ? input.value.trim() : '';
  if (!name) return;
  try {
    const data = await stFetch('/api/admin/speedtest/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (input) input.value = '';
    showSpeedtestToken(data.agent.name, data.token);
    stNotify(`Agent "${data.agent.name}" created`, 'success');
    await loadSpeedtestOverview();
  } catch (error) {
    stNotify(`Create agent failed: ${error.message}`, 'error');
  }
}

async function rotateSpeedtestAgent(id, name) {
  if (!(await stConfirm(`Issue a new token for "${name}"? The current token stops working immediately.`))) return;
  try {
    const data = await stFetch(`/api/admin/speedtest/agents/${id}/rotate`, { method: 'POST' });
    showSpeedtestToken(name, data.token);
    stNotify(`Token rotated for "${name}"`, 'success');
    await loadSpeedtestOverview();
  } catch (error) {
    stNotify(`Rotate failed: ${error.message}`, 'error');
  }
}

async function toggleSpeedtestAgent(id, enabled) {
  try {
    await stFetch(`/api/admin/speedtest/agents/${id}/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    stNotify(enabled ? 'Agent enabled' : 'Agent disabled', 'success');
    await loadSpeedtestOverview();
  } catch (error) {
    stNotify(`Update failed: ${error.message}`, 'error');
  }
}

async function deleteSpeedtestAgent(id, name) {
  if (!(await stConfirm(`Delete agent "${name}"? Its results are kept, but it can no longer post.`))) return;
  try {
    await stFetch(`/api/admin/speedtest/agents/${id}`, { method: 'DELETE' });
    stNotify(`Agent "${name}" deleted`, 'success');
    await loadSpeedtestOverview();
  } catch (error) {
    stNotify(`Delete failed: ${error.message}`, 'error');
  }
}

// =====================================================
// RECENT RESULTS & CLEANUP
// =====================================================

async function loadSpeedtestResults() {
  const body = document.getElementById('st-results-body');
  if (!body) return;
  const limit = (document.getElementById('st-results-limit') || {}).value || 100;
  const errorsOnly = (document.getElementById('st-results-errors') || {}).checked ? '1' : '0';
  try {
    const data = await stFetch(`/api/admin/speedtest/results?limit=${encodeURIComponent(limit)}&errors=${errorsOnly}`);
    if (!data.results.length) {
      body.innerHTML = '<tr><td colspan="9" class="py-6 text-center text-gray-500">No results</td></tr>';
      return;
    }
    body.innerHTML = data.results.map(r => `
      <tr class="border-b border-slate-800">
        <td class="py-1.5 pr-3 text-xs text-gray-400 whitespace-nowrap" title="${new Date(r.ts * 1000).toISOString()}">${new Date(r.ts * 1000).toLocaleString()}</td>
        <td class="py-1.5 pr-3 text-white">${stEscape(r.server)}</td>
        <td class="py-1.5 pr-3 text-gray-300">${stEscape(r.target)}</td>
        <td class="py-1.5 pr-3 text-right font-mono">${stFmt(r.ping_ms, 1)}</td>
        <td class="py-1.5 pr-3 text-right font-mono">${stFmt(r.jitter_ms, 1)}</td>
        <td class="py-1.5 pr-3 text-right font-mono ${r.loss_pct > 0 ? 'text-yellow-400' : ''}">${stFmt(r.loss_pct, 1)}</td>
        <td class="py-1.5 pr-3 text-right font-mono">${stFmt(r.down_mbps, 0)}</td>
        <td class="py-1.5 pr-3 text-right font-mono">${stFmt(r.up_mbps, 0)}</td>
        <td class="py-1.5 text-xs text-red-400/80 max-w-xs truncate" title="${stEscape(r.error || '')}">${stEscape(r.error || '')}</td>
      </tr>`).join('');
  } catch (error) {
    console.error('[Speedtest] results error:', error);
    body.innerHTML = `<tr><td colspan="9" class="py-6 text-center text-red-400">${stEscape(error.message)}</td></tr>`;
  }
}

async function cleanupSpeedtestResults() {
  const days = parseInt((document.getElementById('st-cleanup-days') || {}).value, 10) || 30;
  if (!(await stConfirm(`Delete all speedtest results older than ${days} days?`))) return;
  try {
    const data = await stFetch('/api/admin/speedtest/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days }),
    });
    stNotify(`Deleted ${data.deleted} old results`, 'success');
    await Promise.all([loadSpeedtestOverview(), loadSpeedtestResults()]);
  } catch (error) {
    stNotify(`Cleanup failed: ${error.message}`, 'error');
  }
}

// =====================================================
// INIT
// =====================================================

async function initSpeedtestAdmin() {
  await Promise.all([loadSpeedtestOverview(), loadSpeedtestResults()]);
  if (!stInitialised) {
    stInitialised = true;
    stRefreshTimer = setInterval(() => {
      if (stTabIsActive()) {
        loadSpeedtestOverview();
        loadSpeedtestHistory();
      }
    }, ST_REFRESH_MS);
  }
}

window.initSpeedtestAdmin = initSpeedtestAdmin;
window.loadSpeedtestOverview = loadSpeedtestOverview;
window.loadSpeedtestHistory = loadSpeedtestHistory;
window.loadSpeedtestResults = loadSpeedtestResults;
window.renderSpeedtestLinks = renderSpeedtestLinks;
window.selectSpeedtestLink = selectSpeedtestLink;
window.createSpeedtestAgent = createSpeedtestAgent;
window.rotateSpeedtestAgent = rotateSpeedtestAgent;
window.toggleSpeedtestAgent = toggleSpeedtestAgent;
window.deleteSpeedtestAgent = deleteSpeedtestAgent;
window.copySpeedtestToken = copySpeedtestToken;
window.hideSpeedtestToken = hideSpeedtestToken;
window.cleanupSpeedtestResults = cleanupSpeedtestResults;
