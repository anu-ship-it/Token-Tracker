"use strict";

const SUPPORTED = ["chatgpt.com", "openai.com", "claude.ai"];

// ── Helpers ────────────────────────────────────────────────────────
function fk(n) {
  if (n === null || n === undefined) return "—";
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
  if (pct >= TT.DANGER) return TT.COLOR.RED;
  if (pct >= TT.WARN)   return TT.COLOR.YELLOW;
  return TT.COLOR.GREEN;
}

function colorClass(pct) {
  if (pct >= TT.DANGER) return "red";
  if (pct >= TT.WARN)   return "yellow";
  return "green";
}

function statusLabel(pct) {
  if (pct >= 100)       return "MAXED OUT";
  if (pct >= TT.DANGER) return "CRITICAL";
  if (pct >= TT.WARN)   return "WARNING";
  if (pct >= 1)         return "HEALTHY";
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

function dayLabel(dateStr) {
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (dateStr === today)     return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric"
  });
}

// ── Data row builder ───────────────────────────────────────────────
function dataRow(name, sub, pct) {
  const color = colorFor(pct);
  return `
    <div class="data-row">
      <div class="data-left">
        <div class="data-name">${name}</div>
        <div class="data-sub">${sub || "—"}</div>
      </div>
      <div class="data-right">
        <span class="data-pct ${colorClass(pct)}">${pct}%</span>
        <div class="mini-track">
          <div class="mini-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    </div>`;
}

// ── Rate limits (Claude) ───────────────────────────────────────────
function rateLimitsHTML(usage) {
  const fhPct = Math.min(usage.five_hour?.utilization || 0, 100);
  const sdPct = Math.min(usage.seven_day?.utilization || 0, 100);
  return `
    <div class="section">
      <div class="section-title">Rate Limits</div>
      <div class="data-card">
        ${dataRow("5-Hour Session", countdown(usage.five_hour?.resets_at), fhPct)}
        ${dataRow("7-Day Weekly",   countdown(usage.seven_day?.resets_at), sdPct)}
      </div>
    </div>`;
}

// ── Daily history ──────────────────────────────────────────────────
function dailyHistoryHTML(history, platform) {
  const days = history
    .filter(h => h.platform === platform)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  const rows = days.length === 0
    ? `<div class="no-history">No usage recorded yet.<br>Data saves automatically as you chat.</div>`
    : days.map(d => {
        const pct = safePct(d.used, d.limit);
        return dataRow(
          dayLabel(d.date),
          `Peak ~${fk(d.used)} of ${fk(d.limit)} tokens`,
          pct
        );
      }).join("");

  return `
    <div class="section">
      <div class="section-title">Daily Usage History</div>
      <div class="data-card">${rows}</div>
    </div>`;
}

// ── Render ─────────────────────────────────────────────────────────
function render({ usage, context, history, platform }) {
  const root     = document.getElementById("root");
  const isClaude = platform === "claude";
  const ctx      = context?.[platform] || {};
  const used     = ctx.used  || 0;
  const limit    = ctx.limit || (isClaude ? TT.LIMITS["default"] : TT.LIMITS["gpt-4o"]);
  const ctxPct   = safePct(used, limit);
  const ctxColor = colorFor(ctxPct);

  const badgeClass = isClaude ? "badge-claude" : platform === "chatgpt" ? "badge-chatgpt" : "badge-none";
  const badgeLabel = isClaude ? "Claude" : platform === "chatgpt" ? "ChatGPT" : "—";

  let heroPct = ctxPct;
  if (isClaude && usage) {
    heroPct = Math.max(ctxPct, usage.five_hour?.utilization || 0, usage.seven_day?.utilization || 0);
  }
  const heroColor = colorFor(heroPct);

  root.innerHTML = `

    <!-- Header -->
    <div class="hd">
      <div class="hd-left">
        <div class="logo">T</div>
        <span class="app-name">Token Tracker</span>
      </div>
      <div class="hd-right">
        <div class="dot" style="background:${heroColor};box-shadow:0 0 6px ${heroColor}66"></div>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
        <button class="icon-btn" id="refresh-btn" title="Refresh">↻</button>
        <button class="icon-btn" id="settings-btn" title="Settings">⚙</button>
      </div>
    </div>

    <!-- Context window -->
    <div class="section">
      <div class="section-title">Context Window</div>
      <div class="ctx-used-label">TOKENS USED</div>
      <div class="ctx-hero">
        <span class="ctx-used-val ${colorClass(ctxPct)}">~${fk(used)}</span>
        <span style="font-size:11px;color:#333;padding-bottom:5px">${fk(limit)} limit</span>
      </div>
      <div class="ctx-meta">
        <span class="remaining">~${fk(Math.max(limit - used, 0))} remaining</span>
        <span>${ctxPct}% used</span>
      </div>
      <div class="bar-wrap">
        <div class="bar-track">
          <div class="bar-fill" style="width:${ctxPct}%;background:${ctxColor}"></div>
        </div>
        <div class="bar-footer">
          <span class="bar-end">0</span>
          <span class="bar-status ${colorClass(ctxPct)}">${statusLabel(ctxPct)}</span>
          <span class="bar-end">${fk(limit)}</span>
        </div>
      </div>
    </div>

    <!-- Rate limits (Claude only) -->
    ${isClaude && usage ? rateLimitsHTML(usage) : ""}

    <!-- Daily history (both platforms) -->
    ${dailyHistoryHTML(history || [], platform)}

    <!-- Footer -->
    <div class="footer">
      <span class="footer-note">chars ÷ 4 · ±8% · v2.0.0</span>
      <button class="new-chat" id="new-chat-btn">+ New chat</button>
    </div>
  `;

  document.getElementById("refresh-btn").addEventListener("click", () => {
    document.getElementById("refresh-btn").classList.add("spin");
    chrome.runtime.sendMessage({ type: "FORCE_REFRESH" });
    setTimeout(() => location.reload(), 1500);
  });

  document.getElementById("settings-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById("new-chat-btn").addEventListener("click", () => {
    const url = isClaude ? "https://claude.ai/new" : "https://chatgpt.com/";
    chrome.tabs.update({ url });
    window.close();
  });
}

function renderEmpty() {
  document.getElementById("root").innerHTML = `
    <div class="hd">
      <div class="hd-left">
        <div class="logo">T</div>
        <span class="app-name">Token Tracker</span>
      </div>
      <div class="hd-right">
        <span class="badge badge-none">—</span>
      </div>
    </div>
    <div class="empty">
      <div class="empty-icon">◎</div>
      <p class="empty-text">
        Open <strong>ChatGPT</strong> or
        <strong>Claude</strong> and start chatting
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
  const data     = await chrome.runtime.sendMessage({ type: "GET_ALL_DATA" });

  try {
    const live = await chrome.tabs.sendMessage(tab.id, { type: "GET_CONTEXT_STATE" });
    if (live?.used !== undefined) {
      data.context           = data.context || {};
      data.context[platform] = { used: live.used, limit: live.limit };
    }
  } catch (_) {}

  render({
    usage:    data.usage,
    context:  data.context || {},
    history:  data.history || [],
    platform,
  });
}

init();
