/**
 * content.js
 *
 * ARCHITECTURE NOTE — why we abandoned selector-based message detection for Claude:
 *
 * Claude's DOM uses hashed Tailwind class names that change every deployment,
 * and they removed all data-testid attributes. No selector is stable.
 *
 * New strategy for Claude: TEXT LENGTH TRACKING
 *   We read document.body.innerText (the full visible text of the page),
 *   subtract known UI chrome text (nav, buttons, footer), and estimate tokens
 *   from the remainder. This works regardless of DOM structure changes.
 *
 *   It overcounts slightly (includes sidebar text if visible) but errs in the
 *   safe direction — shows less remaining than actual — which is fine for UX.
 *
 * For ChatGPT: selector-based still works fine, kept as-is.
 */

(() => {
  "use strict";

  // ─── Platform Config ──────────────────────────────────────────────────────

  const PLATFORMS = {
    chatgpt: {
      match: () =>
        location.hostname.includes("chatgpt.com") ||
        location.hostname.includes("openai.com"),

      // Selector-based — ChatGPT's DOM is stable
      getTokens: () => {
        const selectors = [
          "article[data-testid]",
          "div[data-message-id]",
          "[data-testid^='conversation-turn']",
        ];
        for (const sel of selectors) {
          try {
            const nodes = document.querySelectorAll(sel);
            if (nodes.length > 0) {
              const texts = Array.from(nodes).map((n) => n.textContent || "");
              return Tokenizer.estimateMessages(texts);
            }
          } catch (_) { }
        }
        return 0;
      },

      inputWrapperSelectors: [
        "form:has(#prompt-textarea)",
        "form:has(textarea)",
        "div[class*='stretch']",
      ],

      limits: {
        default: 128000,
        "gpt-4o": 128000,
        "gpt-4": 128000,
        "gpt-3.5": 16385,
        o1: 200000,
        o3: 200000,
      },

      getActiveModel: () => {
        const btn = document.querySelector(
          "[data-testid='model-switcher-dropdown-button'], button[aria-label*='GPT']"
        );
        if (!btn) return "gpt-4o";
        const txt = btn.textContent.toLowerCase();
        if (txt.includes("o3")) return "o3";
        if (txt.includes("o1")) return "o1";
        if (txt.includes("4o")) return "gpt-4o";
        if (txt.includes("3.5")) return "gpt-3.5";
        return "gpt-4o";
      },

      getSessionId: () => {
        const m = location.pathname.match(/\/c\/([a-z0-9-]+)/i);
        return m ? m[1] : "home";
      },
    },

    claude: {
      match: () => location.hostname.includes("claude.ai"),

      /**
       * DOM-structure-independent token counting for Claude.
       *
       * Strategy: find the scrollable conversation container by
       * looking for the element with the largest scrollHeight that
       * is a child of <main>. Read its innerText. This captures all
       * message content regardless of class name changes.
       *
       * We then subtract the input box text so a half-typed message
       * doesn't inflate the count.
       */
      getTokens: () => {
        // Conversation lives in a classless div directly under body, outside <main>
        // Find it by getting the body child with the most text content
        const bodyChildren = Array.from(document.body.children);

        let bestEl = null;
        let bestLen = 0;

        for (const el of bodyChildren) {
          // Skip our own injected bar and popup
          if (el.id === 'tt-bar' || el.id === 'tt-popup') continue;
          const len = (el.textContent || '').trim().length;
          if (len > bestLen) {
            bestLen = len;
            bestEl = el;
          }
        }

        if (!bestEl || bestLen < 100) return 0;

        // Subtract the input box text to avoid counting half-typed messages
        const inputEl = document.querySelector("div[contenteditable='true']");
        const inputText = inputEl ? (inputEl.textContent || '').trim() : '';

        let text = (bestEl.textContent || '').trim();
        if (inputText && text.includes(inputText)) {
          text = text.replace(inputText, '');
        }

        return Tokenizer.estimate(text);
      },

      inputWrapperSelectors: [
        "fieldset",
        "div[contenteditable='true']",
      ],

      limits: {
        default: 200000,
      },

      getActiveModel: () => "default",

      getSessionId: () => {
        const m = location.pathname.match(/\/chat\/([a-z0-9-]+)/i);
        return m ? m[1] : location.pathname;
      },
    },
  };

  // ─── State ─────────────────────────────────────────────────────────────────

  let platform = null;
  let uiBar = null;
  let observer = null;
  let popupShown = false;
  let lastSessionId = null;
  let lastTokenCount = 0;
  let rafPending = false;

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    platform = Object.values(PLATFORMS).find((p) => p.match());
    if (!platform) return;

    lastSessionId = platform.getSessionId();

    injectUI();
    startObserver();
    startSessionWatcher();

    setTimeout(scan, 1000);
    setTimeout(scan, 2500);
    setTimeout(scan, 5000);
  }

  // ─── Token Scanning ────────────────────────────────────────────────────────

  function scan() {
    if (!platform) return;

    const tokenCount = platform.getTokens();
    const model = platform.getActiveModel();
    const limit = platform.limits[model] || platform.limits.default;

    lastTokenCount = tokenCount;
    updateUI(tokenCount, limit);
  }

  function scheduleScan() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      scan();
    });
  }

  // ─── Session Reset Detection ───────────────────────────────────────────────

  function startSessionWatcher() {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handlePotentialReset();
      }
    }, 500);
    window.addEventListener("popstate", handlePotentialReset);
  }

  function handlePotentialReset() {
    const currentSessionId = platform.getSessionId();
    if (currentSessionId !== lastSessionId) {
      lastSessionId = currentSessionId;
      lastTokenCount = 0;
      popupShown = false;
      setTimeout(() => { injectUI(); scan(); }, 800);
    }
  }

  // ─── MutationObserver ──────────────────────────────────────────────────────

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => m.addedNodes.length > 0);
      if (relevant) scheduleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false,
    });
  }

  // ─── UI Injection ──────────────────────────────────────────────────────────

  function resolveInputWrapper() {
    for (const sel of platform.inputWrapperSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) { }
    }
    return null;
  }

  function injectUI() {
    const existing = document.getElementById("tt-bar");
    if (existing && document.contains(existing)) return;
    if (existing) existing.remove();

    uiBar = document.createElement("div");
    uiBar.id = "tt-bar";

    // Build DOM manually — no innerHTML with dynamic content
    const inner = document.createElement("div");
    inner.className = "tt-inner";

    const label = document.createElement("span");
    label.className = "tt-label";
    label.textContent = "TOKENS";

    const track = document.createElement("div");
    track.className = "tt-track";
    const fill = document.createElement("div");
    fill.className = "tt-fill";
    fill.id = "tt-fill";
    track.appendChild(fill);

    const count = document.createElement("span");
    count.className = "tt-count";
    count.id = "tt-count";
    count.textContent = "— / —";

    inner.appendChild(label);
    inner.appendChild(track);
    inner.appendChild(count);
    uiBar.appendChild(inner);

    const tryAnchor = () => {
      const wrapper = resolveInputWrapper();
      if (wrapper && wrapper.parentNode) {
        const parent = wrapper.parentNode;
        if (!parent.contains(uiBar)) {
          parent.insertBefore(uiBar, wrapper);
        }
        return true;
      }
      return false;
    };

    if (!tryAnchor()) {
      document.body.appendChild(uiBar);
      const t = setInterval(() => { if (tryAnchor()) clearInterval(t); }, 800);
      setTimeout(() => clearInterval(t), 15000);
    }
  }

  function updateUI(used, limit) {
    const fillEl = document.getElementById("tt-fill");
    const countEl = document.getElementById("tt-count");

    if (!fillEl || !countEl) { injectUI(); return; }

    const pct = Math.min((used / limit) * 100, 100);
    const remaining = Math.max(limit - used, 0);

    fillEl.style.width = pct + "%";
    fillEl.className = "tt-fill" +
      (pct >= 90 ? " tt-critical" : pct >= 70 ? " tt-warn" : "");

    countEl.textContent = formatK(remaining) + " left";
    countEl.className = "tt-count" +
      (pct >= 90 ? " tt-critical" : pct >= 70 ? " tt-warn" : "");

    if (uiBar) uiBar.title = "~" + formatK(used) + " used of ~" + formatK(limit);

    if (remaining === 0 && !popupShown) {
      popupShown = true;
      showExhaustedPopup(limit);
    }
  }

  function formatK(n) {
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  // ─── Exhaustion Popup ──────────────────────────────────────────────────────

  function showExhaustedPopup(limit) {
    if (document.getElementById("tt-popup")) return;

    const popup = document.createElement("div");
    popup.id = "tt-popup";

    const box = document.createElement("div");
    box.className = "tt-popup-box";

    const icon = document.createElement("div");
    icon.className = "tt-popup-icon";
    icon.textContent = "⚠";

    const title = document.createElement("h3");
    title.className = "tt-popup-title";
    title.textContent = "Context Limit Reached";

    const body = document.createElement("p");
    body.className = "tt-popup-body";
    body.textContent = "This conversation has used approximately ~" +
      formatK(limit) + " tokens — the full context window. " +
      "The model may start forgetting earlier parts of your conversation.";

    const tip = document.createElement("p");
    tip.className = "tt-popup-tip";
    tip.textContent = "Start a new chat to reset the token counter and get full context.";

    const btn = document.createElement("button");
    btn.className = "tt-popup-close";
    btn.textContent = "Got it";
    btn.addEventListener("click", () => {
      popup.classList.add("tt-popup-fade");
      setTimeout(() => popup.remove(), 300);
    });

    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(tip);
    box.appendChild(btn);
    popup.appendChild(box);
    document.body.appendChild(popup);

    setTimeout(() => {
      const p = document.getElementById("tt-popup");
      if (p) { p.classList.add("tt-popup-fade"); setTimeout(() => p.remove(), 300); }
    }, 12000);
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ─── Popup Query Handler ──────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_TOKEN_STATE") {
      const model = platform ? platform.getActiveModel() : "default";
      const limit = platform
        ? platform.limits[model] || platform.limits.default
        : 128000;
      sendResponse({
        used: lastTokenCount,
        limit,
        platform: location.hostname.includes("claude.ai") ? "Claude" : "ChatGPT",
        model,
      });
    }
    return true;
  });

})();
