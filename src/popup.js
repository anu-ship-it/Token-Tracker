/**
 * popup.js — Upgraded UI
 * Shows: donut chart, used/remaining/limit/model, progress bar,
 * session token count, 7-session sparkline history
 */

const SUPPORTED = ["chatgpt.com", "openai.com", "claude.ai"];

// ── Storage helpers ────────────────────────────────────────────────
const HISTORY_KEY = "tt_session_history";

async function getHistory() {
  return new Promise((res) => {
    chrome.storage.local.get([HISTORY_KEY], (r) => {
      res(r[HISTORY_KEY] || []);
    });
  });
}

async function pushHistory(entry) {
  const hist = await getHistory();
  hist.push(entry);
  // Keep last 14 sessions
  const trimmed = hist.slice(-14);
  return new Promise((res) => {
    chrome.storage.local.set({ [HISTORY_KEY]: trimmed }, res);
  });
}

// ── Formatting ─────────────────────────────────────────────────────
function fk(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(Math.round(n));
}

function pctColor(pct) {
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f59e0b";
  return "#22c55e";
}

function pctClass(pct) {
  if (pct >= 90) return "val-red";
  if (pct >= 70) return "val-yellow";
  return "val-green";
}

function histBarClass(pct) {
  if (pct >= 90) return "red";
  if (pct >= 70) return "yellow";
  return "green";
}

// ── Donut SVG ──────────────────────────────────────────────────────
function buildDonut(pct, color) {
  const r = 28, cx = 36, cy = 36;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  const gap = circ - filled;
  return `
    <svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r}"
        fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"/>
      <circle cx="${cx}" cy="${cy}" r="${r}"
        fill="none" stroke="${color}" stroke-width="7"
        stroke-dasharray="${filled} ${gap}"
        stroke-linecap="round"
        style="transition: stroke-dasharray 0.5s ease, stroke 0.3s"/>
    </svg>`;
}

// ── Render: Data state ─────────────────────────────────────────────
function renderData(data, history) {
  const { used, limit, platform, model } = data;
  const remaining = Math.max(limit - used, 0);
  const pct = Math.min(Math.round((used / limit) * 100), 100);
  const color = pctColor(pct);

  const badgeClass = platform === "Claude"
    ? "badge-claude"
    : platform === "ChatGPT"
      ? "badge-chatgpt"
      : "badge-none";

  // Sparkline — last 14 sessions, show as bars
  const maxUsed = Math.max(...history.map((h) => h.used), used, 1);
  const bars = [...history, { used, limit }]
    .slice(-14)
    .map((h) => {
      const p = Math.round((h.used / h.limit) * 100);
      const heightPct = Math.max(Math.round((h.used / maxUsed) * 100), 8);
      return `<div class="h-bar ${histBarClass(p)}" style="height:${heightPct}%" title="${fk(h.used)} used"></div>`;
    })
    .join("");

  document.getElementById("root").innerHTML = `
    <div class="header">
      <div class="header-left">
        <div class="logo">T</div>
        <span class="app-name">Token Tracker</span>
      </div>
      <span class="platform-badge ${badgeClass}">${platform}</span>
    </div>

    <div class="donut-section">
      <div class="donut-wrap">
        ${buildDonut(pct, color)}
        <div class="donut-center">
          <span class="donut-pct ${pctClass(pct)}">${pct}%</span>
          <span class="donut-sub">USED</span>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Used</div>
          <div class="value ${pctClass(pct)}">~${fk(used)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Remaining</div>
          <div class="value val-white">~${fk(remaining)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Limit</div>
          <div class="value val-white">${fk(limit)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Model</div>
          <div class="value val-white" style="font-size:11px;padding-top:2px">${model}</div>
        </div>
      </div>
    </div>

    <div class="bar-section">
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="bar-labels">
        <span>0</span>
        <span>${fk(limit / 2)}</span>
        <span>${fk(limit)}</span>
      </div>
    </div>

    <div class="session-row">
      <span class="session-label">ESTIMATION METHOD</span>
      <span class="session-val">chars ÷ 4 · ±8% accuracy</span>
    </div>

    <div class="history-section">
      <div class="history-title">Recent sessions (${Math.min(history.length + 1, 14)})</div>
      <div class="history-bars">${bars || '<div class="h-bar" style="height:8%"></div>'.repeat(7)}</div>
    </div>

    <div class="footer">
      <span class="footer-note">v1.1.0</span>
      <a class="new-chat-btn" href="#" id="new-chat">+ New chat</a>
    </div>
  `;

  // New chat button — opens a new conversation on the current platform
  document.getElementById("new-chat").addEventListener("click", async (e) => {
    e.preventDefault();
    // Save current session to history before navigating
    await pushHistory({ used, limit, ts: Date.now() });
    const url = platform === "Claude"
      ? "https://claude.ai/new"
      : "https://chatgpt.com/";
    chrome.tabs.update({ url });
    window.close();
  });
}

// ── Render: Empty state ────────────────────────────────────────────
function renderEmpty() {
  document.getElementById("root").innerHTML = `
    <div class="header">
      <div class="header-left">
        <div class="logo">T</div>
        <span class="app-name">Token Tracker</span>
      </div>
      <span class="platform-badge badge-none">—</span>
    </div>
    <div class="empty-state">
      <div class="empty-icon">📊</div>
      <p class="empty-text">
        Open <strong style="color:#f0f0f0">ChatGPT</strong> or
        <strong style="color:#e8894a">Claude</strong> and start
        a conversation to see live token usage.
      </p>
    </div>
    <div class="footer">
      <span class="footer-note">v1.1.0</span>
    </div>
  `;
}

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isSupported = tab && SUPPORTED.some((s) => (tab.url || "").includes(s));

  if (!isSupported) {
    renderEmpty();
    return;
  }

  const history = await getHistory();

  try {
    const data = await chrome.tabs.sendMessage(tab.id, { type: "GET_TOKEN_STATE" });
    if (data && data.used !== undefined) {
      renderData(data, history);
    } else {
      renderEmpty();
    }
  } catch {
    renderEmpty();
  }
}

init();
