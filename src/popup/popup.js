"use strict";

const SUPPORTED = ["chatgpt.com", "openai.com", "claude.ai"];

// ── Helpers ────────────────────────────────────────────────────────
function fk(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(Math.round(n));
}

function safePct(used, limit) {
  if (!limit || used === undefined) return 0;
  const raw = (used / limit) * 100;
  if (raw <= 0) return 0;
  if (raw < 1)  return 1;
  return Math.min(Math.round(raw), 100);
}

function colorFor(pct) {
  if (pct >= TT_CONSTANTS.THRESHOLDS.DANGER) return "#ef4444";
  if (pct >= TT_CONSTANTS.THRESHOLDS.WARN)   return "#f59e0b";
  return "#22c55e";
}

function colorClass(pct) {
  if (pct >= TT_CONSTANTS.THRESHOLDS.DANGER) return "c-red";
  if (pct >= TT_CONSTANTS.THRESHOLDS.WARN)   return "c-yellow";
  return "c-green";
}

function statusLabel(pct) {
  if (pct >= 100) return "MAXED OUT";
  if (pct >= TT_CONSTANTS.THRESHOLDS.DANGER) return "CRITICAL";
  if (pct >= TT_CONSTANTS.THRESHOLDS.WARN)   return "WARNING";
  if (pct >= 1)   return "HEALTHY";
  return "IDLE";
}

function countdown(resetsAt) {
  if (!resetsAt) return null;
  const diff = new Date(resetsAt) - Date.now();
  if (diff <= 0) return "Resetting soon";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `Resets in ${h}h ${m}m` : `Resets in ${m}m`;
}

// ── Arc SVG ────────────────────────────────────────────────────────
function arcSVG(pct, color) {
  const R = 38, cx = 48, cy = 48, sw = 5;
  const C      = 2 * Math.PI * R;
  const stub   = Math.max(pct / 100, 0.02);
  const filled = stub * C;
  return `<svg width="96" height="96" viewBox="0 0 96 96" style="transform:rotate(-90deg);display:block">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#1a1a1a" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}"
      stroke-width="${sw}" stroke-dasharray="${filled.toFixed(2)} ${C.toFixed(2)}"
      stroke-linecap="round"
      style="transition:stroke-dasharray .5s ease,stroke .3s"/>
  </svg>`;
}

// ── Heatmap ────────────────────────────────────────────────────────
function buildHeatmap(history) {
  const SLOTS = 50;
  const padded = [
    ...Array(Math.max(0, SLOTS - history.length)).fill(null),
    ...history.slice(-SLOTS),
  ];
  return padded.map(h => {
    if (!h) return `<div class="heatmap-cell"></div>`;
    const p  = safePct(h.used, h.limit);
    const c  = colorFor(p);
    const op = p === 0 ? 0.1 : (0.2 + (p / 100) * 0.8).toFixed(2);
    return `<div class="heatmap-cell" style="background:${c};opacity:${op}" title="${p}% used · ${h.platform || ""}"></div>`;
  }).join("");
}

// ── Rate limit row ─────────────────────────────────────────────────
function rateRow(title, utilization, resetsAt) {
  const pct   = Math.min(utilization || 0, 100);
  const color = colorFor(pct);
  const reset = countdown(resetsAt);
  return `
    <div class="rate-row">
      <div class="rate-left">
        <div class="rate-title">${title}</div>
        ${reset ? `<div class="rate-reset">${reset}</div>` : `<div class="rate-reset">—</div>`}
      </div>
      <div class="rate-right">
        <div class="rate-pct ${colorClass(pct)}">${pct}%</div>
        <div class="rate-bar-track">
          <div class="rate-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    </div>`;
}

// ── Render ─────────────────────────────────────────────────────────
function render(state) {
  const { usage, context, history, platform, activeTab } = state;

  // Determine what to show in hero arc
  // Priority: Claude rate limit > context window
  const isClaude = platform === "claude";
  let heroPct    = 0;
  let heroUsed   = 0;
  let heroLimit  = 0;

  if (isClaude && usage) {
    heroPct  = Math.max(usage.seven_day?.utilization || 0, usage.five_hour?.utilization || 0);
    heroUsed = context?.claude?.used || 0;
    heroLimit = context?.claude?.limit || TT_CONSTANTS.CONTEXT_LIMITS["default"];
  } else if (context?.chatgpt) {
    heroUsed  = context.chatgpt.used;
    heroLimit = context.chatgpt.limit;
    heroPct   = safePct(heroUsed, heroLimit);
  } else if (context?.claude) {
    heroUsed  = context.claude.used;
    heroLimit = context.claude.limit;
    heroPct   = safePct(heroUsed, heroLimit);
  }

  const heroColor  = colorFor(heroPct);
  const pBadge     = isClaude ? "badge-claude" : platform === "chatgpt" ? "badge-chatgpt" : "badge-none";
  const pLabel     = isClaude ? "Claude" : platform === "chatgpt" ? "ChatGPT" : "—";
  const avgPct     = history.length
    ? Math.round(history.reduce((s, h) => s + safePct(h.used, h.limit), 0) / history.length)
    : 0;

  document.getElementById("root").innerHTML = `

    <!-- HEADER -->
    <div class="header">
      <div class="header-left">
        <div class="logo">T</div>
        <span class="app-name">Token Tracker</span>
      </div>
      <div class="header-right">
        <div class="status-dot" style="background:${heroColor};box-shadow:0 0 5px ${heroColor}55"></div>
        <span class="platform-badge ${pBadge}">${pLabel}</span>
        <button class="refresh-btn" id="refresh-btn" title="Refresh">↻</button>
        <button class="settings-btn" id="settings-btn" title="Settings">⚙</button>
      </div>
    </div>

    <!-- TABS -->
    <div class="tabs">
      <button class="tab ${activeTab === 'usage' ? 'active' : ''}" data-tab="usage">Usage</button>
      <button class="tab ${activeTab === 'history' ? 'active' : ''}" data-tab="history">History</button>
    </div>

    <!-- USAGE PANEL -->
    <div class="panel ${activeTab === 'usage' ? 'active' : ''}" id="panel-usage">

      <!-- Hero arc + metrics -->
      <div class="hero">
        <div class="arc-wrap">
          ${arcSVG(heroPct, heroColor)}
          <div class="arc-center">
            <span class="arc-pct ${colorClass(heroPct)}">${heroPct}%</span>
            <span class="arc-label">USED</span>
          </div>
        </div>
        <div class="metrics">
          <div class="metric-row">
            <span class="metric-label">Context Used</span>
            <span class="metric-val ${colorClass(safePct(heroUsed, heroLimit))}">~${fk(heroUsed)}</span>
          </div>
          <div class="divider-h"></div>
          <div class="metric-row">
            <span class="metric-label">Remaining</span>
            <span class="metric-val c-dim">~${fk(heroLimit - heroUsed)}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Window</span>
            <span class="metric-val sm">${fk(heroLimit)}</span>
          </div>
        </div>
      </div>

      <!-- Context bar -->
      <div class="bar-section">
        ${(() => {
          const p = safePct(heroUsed, heroLimit);
          const c = colorFor(p);
          return `
            <div class="bar-track">
              <div class="bar-fill" style="width:${p}%;background:${c}"></div>
            </div>
            <div class="bar-meta">
              <span class="bar-ends">0</span>
              <span class="bar-status ${colorClass(p)}">${statusLabel(p)}</span>
              <span class="bar-ends">${fk(heroLimit)}</span>
            </div>`;
        })()}
      </div>

      <!-- Claude rate limits -->
      ${isClaude && usage ? `
        <div class="rate-section">
          ${rateRow("5-Hour Session", usage.five_hour?.utilization, usage.five_hour?.resets_at)}
          ${rateRow("7-Day Weekly", usage.seven_day?.utilization, usage.seven_day?.resets_at)}
        </div>` : ""}

    </div>

    <!-- HISTORY PANEL -->
    <div class="panel ${activeTab === 'history' ? 'active' : ''}" id="panel-history">
      <div class="history-panel">
        <div class="history-header">
          <span class="history-title">Session History</span>
          <span class="history-meta">${history.length} sessions · avg ${avgPct}%</span>
        </div>
        <div class="heatmap">${buildHeatmap(history)}</div>
        <div class="legend">
          <span class="legend-label">less</span>
          <div class="legend-cells">
            ${["#141414","#22c55e","#22c55e","#f59e0b","#ef4444"].map((c,i) =>
              `<div class="legend-cell" style="background:${c};opacity:${[1,.3,.8,1,1][i]}"></div>`
            ).join("")}
          </div>
          <span class="legend-label">more</span>
        </div>
      </div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      <span class="footer-note">chars ÷ 4 · ±8% · v2.0.0</span>
      <button class="new-chat-btn" id="new-chat-btn">+ New chat</button>
    </div>
  `;

  // ── Event listeners ──────────────────────────────────────────────
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      render(state);
    });
  });

  document.getElementById("refresh-btn").addEventListener("click", async () => {
    const btn = document.getElementById("refresh-btn");
    btn.classList.add("spinning");
    await chrome.runtime.sendMessage({ type: "FORCE_REFRESH" });
    setTimeout(() => location.reload(), 1200);
  });

  document.getElementById("settings-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("new-chat-btn").addEventListener("click", async () => {
    // Save current session to history
    if (heroUsed > 50) {
      const h = await getHistory();
      const key = (platform || "unknown") + "_" + new Date().toDateString();
      const idx = h.findIndex(x => x.key === key);
      const rec = { used: heroUsed, limit: heroLimit, platform: pLabel, key, ts: Date.now() };
      if (idx >= 0) h[idx] = rec; else h.push(rec);
      await new Promise(res => chrome.storage.local.set({ [TT_CONSTANTS.STORAGE_KEYS.HISTORY]: h.slice(-60) }, res));
    }
    const url = isClaude ? "https://claude.ai/new" : "https://chatgpt.com/";
    chrome.tabs.update({ url });
    window.close();
  });
}

async function getHistory() {
  return new Promise(res =>
    chrome.storage.local.get([TT_CONSTANTS.STORAGE_KEYS.HISTORY], r =>
      res(r[TT_CONSTANTS.STORAGE_KEYS.HISTORY] || [])
    )
  );
}

function renderEmpty() {
  document.getElementById("root").innerHTML = `
    <div class="header">
      <div class="header-left">
        <div class="logo">T</div>
        <span class="app-name">Token Tracker</span>
      </div>
      <div class="header-right">
        <span class="platform-badge badge-none">—</span>
      </div>
    </div>
    <div class="empty">
      <div class="empty-icon">◎</div>
      <p class="empty-text">
        Open <strong>ChatGPT</strong> or <strong>Claude</strong><br>
        and start a conversation
      </p>
    </div>
    <div class="footer">
      <span class="footer-note">v2.0.0</span>
    </div>
  `;
}

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url   = tab?.url || "";
  const ok    = SUPPORTED.some(s => url.includes(s));

  if (!ok) { renderEmpty(); return; }

  const platform = url.includes("claude.ai") ? "claude" : "chatgpt";

  // Get all data from service worker
  const data = await chrome.runtime.sendMessage({ type: "GET_ALL_DATA" });

  // Also ask content script for live context state
  let contextLive = null;
  try {
    contextLive = await chrome.tabs.sendMessage(tab.id, { type: "GET_CONTEXT_STATE" });
  } catch (_) {}

  // Merge live context into storage context
  if (contextLive) {
    data.context = data.context || {};
    data.context[contextLive.platform] = {
      used:  contextLive.used,
      limit: contextLive.limit,
      ts:    Date.now(),
    };
  }

  // Auto-save to history if meaningful usage
  if (contextLive?.used > 50) {
    const key = platform + "_" + new Date().toDateString();
    const h   = data.history || [];
    const idx = h.findIndex(x => x.key === key);
    const rec = { used: contextLive.used, limit: contextLive.limit, platform, key, ts: Date.now() };
    if (idx >= 0) h[idx] = rec; else h.push(rec);
    data.history = h.slice(-60);
    chrome.storage.local.set({ [TT_CONSTANTS.STORAGE_KEYS.HISTORY]: data.history });
  }

  render({
    usage:     data.usage,
    context:   data.context || {},
    history:   data.history || [],
    settings:  data.settings,
    platform,
    activeTab: "usage",
  });
}

init();
