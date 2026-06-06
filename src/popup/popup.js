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

function dailyHistoryHTML(history, platform) {
  const days = history
    .filter(h => h.platform === platform)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  const rows = days.length === 0
    ? `<div class="no-history">No usage recorded yet.<br>Data saves automatically as you chat.</div>`
    : days.map(d => dataRow(
        dayLabel(d.date),
        `Peak ~${fk(d.used)} of ${fk(d.limit)} tokens`,
        safePct(d.used, d.limit)
      )).join("");

  return `
    <div class="section">
      <div class="section-title">Daily Usage History</div>
      <div class="data-card">${rows}</div>
    </div>`;
}

// ── Main view ──────────────────────────────────────────────────────
function renderMain(state) {
  const { usage, context, history, platform } = state;
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
    <div class="hd">
      <div class="hd-left">
        <div class="logo"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="#0d3d42" stroke-width="1.5"/><path d="M7 1.5 a5.5 5.5 0 0 1 4.76 2.75" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="7" r="3.2" stroke="#0d3d42" stroke-width="1.2"/><path d="M7 3.8 a3.2 3.2 0 0 1 2.77 1.6 a3.2 3.2 0 0 1 0 3.2" stroke="#67e8f9" stroke-width="1.2" stroke-linecap="round"/></svg></div>
        <span class="app-name">Token Tracker</span>
      </div>
      <div class="hd-right">
        <div class="dot" style="background:${heroColor};box-shadow:0 0 6px ${heroColor}66"></div>
        <span class="badge ${badgeClass}">${badgeLabel}</span>
        <button class="icon-btn" id="refresh-btn" title="Refresh">↻</button>
        <button class="icon-btn" id="settings-btn" title="Settings">⚙</button>
      </div>
    </div>

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

    ${isClaude && usage ? rateLimitsHTML(usage) : ""}
    ${dailyHistoryHTML(history || [], platform)}

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
    renderSettings(state);
  });

  document.getElementById("new-chat-btn").addEventListener("click", () => {
    chrome.tabs.update({ url: isClaude ? "https://claude.ai/new" : "https://chatgpt.com/" });
    window.close();
  });
}

// ── Settings view ──────────────────────────────────────────────────
function renderSettings(state) {
  const root = document.getElementById("root");

  // Load current settings
  chrome.storage.local.get([TT.KEY.SETTINGS], (r) => {
    const s = { ...TT.DEFAULTS, ...(r[TT.KEY.SETTINGS] || {}) };

    root.innerHTML = `
      <div class="hd">
        <div class="hd-left">
          <button class="icon-btn" id="back-btn" style="font-size:13px;color:#555">←</button>
          <span class="app-name">Settings</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Notifications</div>
        <div class="data-card">
          ${toggleRow("n50",  "Alert at 50%",  "Early warning",    s.notify_50)}
          ${toggleRow("n75",  "Alert at 75%",  "Early warning",    s.notify_75)}
          ${toggleRow("n90",  "Alert at 90%",  "Critical warning", s.notify_90)}
          ${toggleRow("n100", "Alert at 100%", "Limit reached",    s.notify_100)}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Display</div>
        <div class="data-card">
          ${toggleRow("show_bar", "In-page token bar", "Show bar above input box", s.show_bar)}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Refresh Interval</div>
        <div class="data-card">
          <div class="data-row">
            <div class="data-left">
              <div class="data-name">Fetch Claude usage every</div>
              <div class="data-sub">Background refresh frequency</div>
            </div>
            <select id="refresh" class="sel">
              <option value="1"  ${s.refresh_minutes === 1  ? "selected" : ""}>1 min</option>
              <option value="2"  ${s.refresh_minutes === 2  ? "selected" : ""}>2 min</option>
              <option value="5"  ${s.refresh_minutes === 5  ? "selected" : ""}>5 min</option>
              <option value="10" ${s.refresh_minutes === 10 ? "selected" : ""}>10 min</option>
              <option value="15" ${s.refresh_minutes === 15 ? "selected" : ""}>15 min</option>
            </select>
          </div>
        </div>
      </div>

      <div style="padding:4px 14px 14px">
        <button class="save-btn" id="save-btn">Save Settings</button>
        <div class="saved-msg" id="saved-msg" style="opacity:0">✓ Settings saved</div>
      </div>
    `;

    document.getElementById("back-btn").addEventListener("click", () => renderMain(state));

    document.getElementById("save-btn").addEventListener("click", async () => {
      const settings = {
        notify_50:  document.getElementById("n50").checked,
        notify_75:  document.getElementById("n75").checked,
        notify_90:  document.getElementById("n90").checked,
        notify_100: document.getElementById("n100").checked,
        show_bar:   document.getElementById("show_bar").checked,
        refresh_minutes: parseInt(document.getElementById("refresh").value, 10),
      };

      await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });

      const msg = document.getElementById("saved-msg");
      msg.style.opacity = "1";
      setTimeout(() => { msg.style.opacity = "0"; }, 2000);
    });
  });
}

function toggleRow(id, label, desc, checked) {
  return `
    <div class="data-row">
      <div class="data-left">
        <div class="data-name">${label}</div>
        <div class="data-sub">${desc}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="${id}" ${checked ? "checked" : ""}>
        <div class="track"></div>
      </label>
    </div>`;
}

// ── Empty state ────────────────────────────────────────────────────
function renderEmpty() {
  document.getElementById("root").innerHTML = `
    <div class="hd">
      <div class="hd-left">
        <div class="logo"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="#0d3d42" stroke-width="1.5"/><path d="M7 1.5 a5.5 5.5 0 0 1 4.76 2.75" stroke="#06b6d4" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="7" r="3.2" stroke="#0d3d42" stroke-width="1.2"/><path d="M7 3.8 a3.2 3.2 0 0 1 2.77 1.6 a3.2 3.2 0 0 1 0 3.2" stroke="#67e8f9" stroke-width="1.2" stroke-linecap="round"/></svg></div>
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

  renderMain({
    usage:    data.usage,
    context:  data.context || {},
    history:  data.history || [],
    platform,
  });
}

init();
