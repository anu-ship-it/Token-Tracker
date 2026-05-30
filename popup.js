/**
 * popup.js
 * Queries the active tab's content script for current token state.
 * Falls back gracefully if the tab isn't a supported platform.
 */

const SUPPORTED = ["chatgpt.com", "openai.com", "claude.ai"];

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupportedTab(tab) {
  return tab && SUPPORTED.some((s) => (tab.url || "").includes(s));
}

function renderData(data) {
  const content = document.getElementById("content");
  const dot = document.getElementById("status-dot");

  if (!data) {
    content.innerHTML = `<p class="no-data">No token data yet — send a message first.</p>`;
    dot.style.background = "#555";
    return;
  }

  const { used, limit, platform, model } = data;
  const remaining = Math.max(limit - used, 0);
  const pct = Math.min((used / limit) * 100, 100);
  const fillColor = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#22c55e";
  dot.style.background = fillColor;

  function fk(n) {
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  content.innerHTML = `
    <p class="site-label">${platform} · ${model}</p>

    <div class="stat-row">
      <span class="stat-label">Tokens Used</span>
      <span class="stat-val">~${fk(used)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Remaining</span>
      <span class="stat-val" style="color:${fillColor}">~${fk(remaining)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Context Window</span>
      <span class="stat-val">${fk(limit)}</span>
    </div>

    <div class="track">
      <div class="fill" style="width:${pct}%;background:${fillColor}"></div>
    </div>

    <div class="divider"></div>
    <p class="note">
      Estimated via character count (÷4 chars/token).<br>
      Accuracy: ±5–10%. Resets on new conversation.
    </p>
  `;
}

async function init() {
  const tab = await getActiveTab();

  if (!isSupportedTab(tab)) {
    return; // default "open ChatGPT or Claude" message stays
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_TOKEN_STATE" });
    renderData(response);
  } catch {
    // Content script not ready yet
    renderData(null);
  }
}

init();
