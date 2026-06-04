/**
 * content.js
 * Runs on ChatGPT and Claude pages.
 *
 * Responsibilities:
 *  1. Count context window tokens (both platforms)
 *  2. Fetch Claude API usage and send to service worker
 *  3. Inject token bar above input box
 *  4. Detect session resets and zero the counter
 *  5. Show exhaustion popup at 100%
 *  6. Auto-save daily usage totals on every scan
 */

(() => {
  "use strict";

  const IS_CLAUDE = location.hostname.includes("claude.ai");
  const IS_GPT    = location.hostname.includes("chatgpt.com") ||
                    location.hostname.includes("openai.com");
  if (!IS_CLAUDE && !IS_GPT) return;

  const PLATFORM = IS_CLAUDE ? "claude" : "chatgpt";

  // ── State ──────────────────────────────────────────────────────
  let lastTokenCount = 0;
  let lastSessionId  = getSessionId();
  let popupShown     = false;
  let rafPending     = false;

  // ── Session ID ─────────────────────────────────────────────────
  function getSessionId() {
    if (IS_CLAUDE) {
      const m = location.pathname.match(/\/chat\/([a-z0-9-]+)/i);
      return m ? m[1] : location.pathname;
    }
    const m = location.pathname.match(/\/c\/([a-z0-9-]+)/i);
    return m ? m[1] : "home";
  }

  // ── Context limit ──────────────────────────────────────────────
  function getLimit() {
    if (IS_CLAUDE) return TT.LIMITS["default"];
    const btn = document.querySelector(
      "[data-testid='model-switcher-dropdown-button'], button[aria-label*='GPT']"
    );
    const txt = btn ? btn.textContent.toLowerCase() : "";
    if (txt.includes("o3"))  return TT.LIMITS["o3"];
    if (txt.includes("o1"))  return TT.LIMITS["o1"];
    if (txt.includes("4o"))  return TT.LIMITS["gpt-4o"];
    if (txt.includes("3.5")) return TT.LIMITS["gpt-3.5"];
    return TT.LIMITS["gpt-4o"];
  }

  // ── Token counting ─────────────────────────────────────────────
  function countTokens() {
    return IS_CLAUDE ? countClaude() : countGPT();
  }

  function countClaude() {
    let best = null, bestLen = 0;
    for (const el of document.body.children) {
      if (el.id === "tt-bar" || el.id === "tt-popup") continue;
      const len = (el.textContent || "").trim().length;
      if (len > bestLen) { bestLen = len; best = el; }
    }
    if (!best || bestLen < 50) return 0;

    const inputEl   = document.querySelector("div[contenteditable='true']");
    const inputText = inputEl ? (inputEl.textContent || "").trim() : "";
    let text        = (best.textContent || "").trim();
    if (inputText && text.includes(inputText)) {
      text = text.replace(inputText, "");
    }
    return Tokenizer.estimate(text);
  }

  function countGPT() {
    const selectors = [
      "article[data-testid]",
      "div[data-message-id]",
      "[data-testid^='conversation-turn']",
    ];
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) {
          return Tokenizer.estimateMessages(
            Array.from(nodes).map(n => n.textContent || "")
          );
        }
      } catch (_) {}
    }
    return 0;
  }

  // ── Auto-save daily usage ──────────────────────────────────────
  // Called on every scan. Saves the PEAK token count seen today
  // per platform. This way even if you never open the popup,
  // your usage is recorded.
  function saveDailyUsage(tokens, limit) {
    if (tokens < 50) return; // ignore noise
    const today = new Date().toDateString();
    const key   = TT.KEY.HISTORY;

    chrome.storage.local.get([key], (r) => {
      const history = r[key] || [];
      const recKey  = PLATFORM + "_" + today;
      const idx     = history.findIndex(x => x.key === recKey);
      const existing = idx >= 0 ? history[idx] : null;

      // Only update if tokens increased — tracks peak usage of the day
      if (existing && existing.used >= tokens) return;

      const rec = {
        key:      recKey,
        platform: PLATFORM,
        used:     tokens,
        limit,
        ts:       Date.now(),
        date:     today,
      };

      if (idx >= 0) history[idx] = rec;
      else history.push(rec);

      chrome.storage.local.set({ [key]: history.slice(-60) });
    });
  }

  // ── Claude API fetch ───────────────────────────────────────────
  async function fetchClaudeUsage() {
    try {
      const orgsRes = await fetch(TT.API.ORGS, { credentials: "include" });
      if (!orgsRes.ok) return null;
      const orgs    = await orgsRes.json();
      const chatOrg = orgs.find(
        o => Array.isArray(o.capabilities) && o.capabilities.includes("chat")
      );
      if (!chatOrg) return null;

      const usageRes = await fetch(TT.API.USAGE(chatOrg.uuid), { credentials: "include" });
      if (!usageRes.ok) return null;
      const data = await usageRes.json();

      return {
        five_hour: {
          utilization: data.five_hour?.utilization ?? 0,
          resets_at:   data.five_hour?.resets_at   ?? null,
        },
        seven_day: {
          utilization: data.seven_day?.utilization ?? 0,
          resets_at:   data.seven_day?.resets_at   ?? null,
        },
      };
    } catch {
      return null;
    }
  }

  // ── Session watcher ────────────────────────────────────────────
  function watchSession() {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      const newId = getSessionId();
      if (newId !== lastSessionId) {
        lastSessionId  = newId;
        lastTokenCount = 0;
        popupShown     = false;
        setTimeout(() => { injectBar(); scan(); }, 800);
      }
    }, 500);
    window.addEventListener("popstate", () => setTimeout(scan, 800));
  }

  // ── Scan ───────────────────────────────────────────────────────
  function scan() {
    const tokens = countTokens();
    const limit  = getLimit();
    lastTokenCount = tokens;
    updateBar(tokens, limit);

    // Auto-save daily peak usage — runs silently on every scan
    saveDailyUsage(tokens, limit);

    // Report to service worker
    try {
      chrome.runtime.sendMessage({
        type:     "CONTEXT_UPDATE",
        platform: PLATFORM,
        used:     tokens,
        limit,
      });
    } catch (_) {}
  }

  function scheduleScan() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; scan(); });
  }

  // ── MutationObserver ───────────────────────────────────────────
  function startObserver() {
    const obs = new MutationObserver(muts => {
      if (muts.some(m => m.addedNodes.length > 0)) scheduleScan();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ── Bar injection ──────────────────────────────────────────────
  function resolveWrapper() {
    const selectors = IS_CLAUDE
      ? ["fieldset", "div[contenteditable='true']"]
      : ["form:has(#prompt-textarea)", "form:has(textarea)", "div[class*='stretch']"];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function injectBar() {
    const existing = document.getElementById("tt-bar");
    if (existing && document.contains(existing)) return;
    if (existing) existing.remove();

    const bar   = document.createElement("div");
    bar.id      = "tt-bar";

    const inner = document.createElement("div");
    inner.className = "tt-inner";

    const label       = document.createElement("span");
    label.className   = "tt-label";
    label.textContent = "TOKENS";

    const track     = document.createElement("div");
    track.className = "tt-track";
    const fill      = document.createElement("div");
    fill.className  = "tt-fill";
    fill.id         = "tt-fill";
    track.appendChild(fill);

    const count       = document.createElement("span");
    count.className   = "tt-count";
    count.id          = "tt-count";
    count.textContent = "—";

    inner.append(label, track, count);
    bar.appendChild(inner);

    const anchor = () => {
      const w = resolveWrapper();
      if (w?.parentNode) {
        w.parentNode.insertBefore(bar, w);
        return true;
      }
      return false;
    };

    if (!anchor()) {
      document.body.appendChild(bar);
      const t = setInterval(() => { if (anchor()) clearInterval(t); }, 800);
      setTimeout(() => clearInterval(t), 15000);
    }
  }

  // ── Bar update ─────────────────────────────────────────────────
  function updateBar(used, limit) {
    const fill  = document.getElementById("tt-fill");
    const count = document.getElementById("tt-count");
    if (!fill || !count) { injectBar(); return; }

    const pct       = Math.min((used / limit) * 100, 100);
    const remaining = Math.max(limit - used, 0);

    fill.style.width = pct + "%";
    fill.className   = "tt-fill" +
      (pct >= TT.DANGER ? " tt-red" : pct >= TT.WARN ? " tt-yellow" : "");

    count.textContent = formatK(remaining) + " left";
    count.className   = "tt-count" +
      (pct >= TT.DANGER ? " tt-red" : pct >= TT.WARN ? " tt-yellow" : "");

    if (pct >= 100 && !popupShown) {
      popupShown = true;
      showPopup(limit);
    }
  }

  function formatK(n) {
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  // ── Exhaustion popup ───────────────────────────────────────────
  function showPopup(limit) {
    if (document.getElementById("tt-popup")) return;

    const popup = document.createElement("div");
    popup.id    = "tt-popup";

    const box   = document.createElement("div");
    box.className = "tt-popup-box";

    const icon        = document.createElement("div");
    icon.className    = "tt-popup-icon";
    icon.textContent  = "⚠";

    const title       = document.createElement("div");
    title.className   = "tt-popup-title";
    title.textContent = "Context Limit Reached";

    const body        = document.createElement("div");
    body.className    = "tt-popup-body";
    body.textContent  = `This conversation has used ~${formatK(limit)} tokens — the full context window. The model may start losing earlier context.`;

    const tip         = document.createElement("div");
    tip.className     = "tt-popup-tip";
    tip.textContent   = "Start a new chat to reset.";

    const btn         = document.createElement("button");
    btn.className     = "tt-popup-btn";
    btn.textContent   = "Got it";
    btn.addEventListener("click", () => {
      popup.style.opacity = "0";
      setTimeout(() => popup.remove(), 300);
    });

    box.append(icon, title, body, tip, btn);
    popup.appendChild(box);
    document.body.appendChild(popup);

    setTimeout(() => {
      if (document.getElementById("tt-popup")) {
        popup.style.opacity = "0";
        setTimeout(() => popup.remove(), 300);
      }
    }, 12000);
  }

  // ── Message listener ───────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === "FETCH_CLAUDE_USAGE" && IS_CLAUDE) {
      fetchClaudeUsage().then(usage => {
        try {
          chrome.runtime.sendMessage({ type: "CLAUDE_USAGE_RESULT", usage });
        } catch (_) {}
      });
    }
    if (msg.type === "GET_CONTEXT_STATE") {
      sendResponse({ used: lastTokenCount, limit: getLimit(), platform: PLATFORM });
    }
    return true;
  });

  // ── Boot ───────────────────────────────────────────────────────
  function init() {
    injectBar();
    startObserver();
    watchSession();
    setTimeout(scan, 800);
    setTimeout(scan, 2500);

    if (IS_CLAUDE) {
      fetchClaudeUsage().then(usage => {
        if (usage) {
          try {
            chrome.runtime.sendMessage({ type: "CLAUDE_USAGE_RESULT", usage });
          } catch (_) {}
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
