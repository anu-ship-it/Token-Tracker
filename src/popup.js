"use strict";

const SUPPORTED = ["chatgpt.com", "openai.com", "claude.ai"];
const HISTORY_KEY = "tt_session_history";

// ── Storage ────────────────────────────────────────────────────────
async function getHistory() {
  return new Promise(res =>
    chrome.storage.local.get([HISTORY_KEY], r => res(r[HISTORY_KEY] || []))
  );
}

async function upsertHistory(entry) {
  // Save current session — keyed by date+platform so repeated opens update, not append
  const h = await getHistory();
  const key = entry.platform + "_" + new Date().toDateString();
  const idx = h.findIndex(x => x.key === key);
  const record = { ...entry, key, ts: Date.now() };
  if (idx >= 0) h[idx] = record;
  else h.push(record);
  return new Promise(res => chrome.storage.local.set({ [HISTORY_KEY]: h.slice(-60) }, res));
}

// ── Helpers ────────────────────────────────────────────────────────
function fk(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(Math.round(n));
}

function safePct(used, limit) {
  if (!limit) return 0;
  const raw = (used / limit) * 100;
  if (raw <= 0) return 0;
  if (raw < 1) return 1; // show at least 1% for any non-zero usage
  return Math.min(Math.round(raw), 100);
}

function colorFor(pct) {
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f59e0b";
  return "#22c55e";
}

function statusFor(pct) {
  if (pct >= 90) return "CRITICAL";
  if (pct >= 70) return "WARNING";
  if (pct >= 1)  return "HEALTHY";
  return "IDLE";
}

// ── Arc SVG ────────────────────────────────────────────────────────
function arc(pct, color) {
  const R = 38, cx = 48, cy = 48, sw = 6;
  const C = 2 * Math.PI * R;
  const filled = (pct / 100) * C;
  // Always show a tiny arc stub so the ring doesn't look broken at 0%
  const stub = pct === 0 ? 2 : filled;
  return `<svg width="96" height="96" viewBox="0 0 96 96" style="transform:rotate(-90deg);display:block">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#1c1c1c" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}"
      stroke-width="${sw}" stroke-dasharray="${stub.toFixed(2)} ${C.toFixed(2)}"
      stroke-linecap="round" style="transition:stroke-dasharray .5s ease,stroke .3s"/>
  </svg>`;
}

// ── Heatmap ────────────────────────────────────────────────────────
function heatmap(history) {
  // 5 rows × 10 cols = 50 slots, newest at bottom-right
  const SLOTS = 50;
  const padded = [...Array(Math.max(0, SLOTS - history.length)).fill(null), ...history.slice(-SLOTS)];

  const cells = padded.map(h => {
    if (!h) return `<div style="width:12px;height:12px;border-radius:2px;background:#141414;flex-shrink:0"></div>`;
    const p = safePct(h.used, h.limit);
    const c = colorFor(p);
    const op = p === 0 ? 0.15 : (0.25 + (p / 100) * 0.75).toFixed(2);
    return `<div style="width:12px;height:12px;border-radius:2px;background:${c};opacity:${op};flex-shrink:0" title="${p}% used"></div>`;
  }).join("");

  return `<div style="display:flex;flex-wrap:wrap;gap:3px">${cells}</div>`;
}

// ── Empty state ────────────────────────────────────────────────────
function renderEmpty() {
  document.getElementById("root").innerHTML = `
    <div style="padding:20px 18px 14px;border-bottom:1px solid #111">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#22c55e,#15803d);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff">T</div>
        <span style="font-size:13px;font-weight:600;color:#d0d0d0">Token Tracker</span>
      </div>
    </div>
    <div style="padding:36px 20px;text-align:center">
      <div style="font-size:30px;margin-bottom:14px;opacity:.4">◎</div>
      <p style="font-size:12px;color:#444;line-height:1.7">
        Open <strong style="color:#ccc">ChatGPT</strong> or <strong style="color:#e8894a">Claude</strong><br>
        and start a conversation
      </p>
    </div>
    <div style="padding:10px 18px;border-top:1px solid #0f0f0f">
      <span style="font-size:9px;color:#222;letter-spacing:.04em">v1.2.0</span>
    </div>
  `;
}

// ── Main render ────────────────────────────────────────────────────
function renderData(data, history) {
  const { used, limit, platform } = data;
  const remaining  = Math.max(limit - used, 0);
  const pct        = safePct(used, limit);
  const color      = colorFor(pct);
  const status     = statusFor(pct);
  const avgPct     = history.length
    ? Math.round(history.reduce((s, h) => s + safePct(h.used, h.limit), 0) / history.length)
    : 0;

  const isClaude   = platform === "Claude";
  const pColor     = isClaude ? "#e8894a" : "#19c37d";
  const pBg        = isClaude ? "rgba(232,137,74,.1)" : "rgba(25,195,125,.1)";

  document.getElementById("root").innerHTML = `

    <!-- ── HEADER ── -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 12px;border-bottom:1px solid #111">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#22c55e,#15803d);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff">T</div>
        <span style="font-size:13px;font-weight:600;color:#d0d0d0;letter-spacing:.01em">Token Tracker</span>
      </div>
      <div style="display:flex;align-items:center;gap:7px">
        <div style="width:6px;height:6px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color}66"></div>
        <span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:20px;background:${pBg};color:${pColor};letter-spacing:.02em">${platform}</span>
      </div>
    </div>

    <!-- ── HERO ── -->
    <div style="padding:20px 16px 16px;display:flex;align-items:center;gap:18px">

      <!-- Arc -->
      <div style="position:relative;flex-shrink:0;width:96px;height:96px">
        ${arc(pct, color)}
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <span style="font-size:20px;font-weight:800;color:${color};line-height:1;letter-spacing:-.02em">${pct}%</span>
          <span style="font-size:8px;color:#333;margin-top:3px;letter-spacing:.1em">USED</span>
        </div>
      </div>

      <!-- Metrics -->
      <div style="flex:1;display:flex;flex-direction:column;gap:10px">

        <div>
          <div style="font-size:9px;color:#444;letter-spacing:.08em;margin-bottom:2px">USED</div>
          <div style="font-size:22px;font-weight:800;color:${color};letter-spacing:-.03em;line-height:1">~${fk(used)}</div>
        </div>

        <div style="height:1px;background:#111"></div>

        <div style="display:flex;justify-content:space-between">
          <div>
            <div style="font-size:9px;color:#444;letter-spacing:.08em;margin-bottom:1px">REMAINING</div>
            <div style="font-size:14px;font-weight:700;color:#888">${fk(remaining)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:9px;color:#444;letter-spacing:.08em;margin-bottom:1px">LIMIT</div>
            <div style="font-size:14px;font-weight:700;color:#444">${fk(limit)}</div>
          </div>
        </div>

      </div>
    </div>

    <!-- ── PROGRESS BAR ── -->
    <div style="padding:0 16px 16px">
      <div style="width:100%;height:2px;background:#141414;border-radius:1px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:1px;transition:width .5s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <span style="font-size:9px;color:#2a2a2a">0</span>
        <span style="font-size:9px;font-weight:700;letter-spacing:.1em;color:${color}">${status}</span>
        <span style="font-size:9px;color:#2a2a2a">${fk(limit)}</span>
      </div>
    </div>

    <!-- ── DIVIDER ── -->
    <div style="height:1px;background:#0f0f0f;margin:0 16px"></div>

    <!-- ── SESSION HISTORY ── -->
    <div style="padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:9px;font-weight:700;letter-spacing:.1em;color:#333">SESSION HISTORY</span>
        <span style="font-size:9px;color:#2a2a2a">${history.length} saved · avg ${avgPct}%</span>
      </div>
      ${heatmap(history)}
      <!-- Legend -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <span style="font-size:9px;color:#222">less</span>
        <div style="display:flex;gap:3px;align-items:center">
          ${["#141414","#22c55e","#22c55e","#f59e0b","#ef4444"].map((c,i)=>`<div style="width:9px;height:9px;border-radius:2px;background:${c};opacity:${[1,.3,.7,1,1][i]}"></div>`).join("")}
        </div>
        <span style="font-size:9px;color:#222">more</span>
      </div>
    </div>

    <!-- ── FOOTER ── -->
    <div style="height:1px;background:#0f0f0f;margin:0 16px"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 16px">
      <span style="font-size:9px;color:#222;letter-spacing:.03em">chars ÷ 4 · ±8% · v1.2.0</span>
      <button id="nc" style="font-size:10px;font-weight:700;padding:6px 14px;border-radius:8px;background:rgba(34,197,94,.08);color:#22c55e;border:1px solid rgba(34,197,94,.18);letter-spacing:.02em;transition:background .15s">
        + New chat
      </button>
    </div>
  `;

  document.getElementById("nc").addEventListener("mouseenter", e => e.target.style.background = "rgba(34,197,94,.16)");
  document.getElementById("nc").addEventListener("mouseleave", e => e.target.style.background = "rgba(34,197,94,.08)");
  document.getElementById("nc").addEventListener("click", async () => {
    await upsertHistory({ used, limit, platform });
    chrome.tabs.update({ url: isClaude ? "https://claude.ai/new" : "https://chatgpt.com/" });
    window.close();
  });
}

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = tab && SUPPORTED.some(s => (tab.url || "").includes(s));
  if (!ok) { renderEmpty(); return; }

  const history = await getHistory();

  try {
    const data = await chrome.tabs.sendMessage(tab.id, { type: "GET_TOKEN_STATE" });
    if (data?.used !== undefined) {
      // Auto-save session on every popup open if usage is meaningful
      if (data.used > 50) await upsertHistory({ used: data.used, limit: data.limit, platform: data.platform });
      const fresh = await getHistory();
      renderData(data, fresh);
    } else {
      renderEmpty();
    }
  } catch {
    renderEmpty();
  }
}

init();