/**
 * content.js — Core logic
 *
 * Responsibilities:
 *  1. Detect which platform (ChatGPT / Claude)
 *  2. Read all visible conversation messages from the DOM
 *  3. Count tokens for the current session
 *  4. Detect session resets (new chat) and zero the counter
 *  5. Inject the UI bar above the input box
 *  6. Show exhaustion popup when limit is hit
 *
 * SELECTOR STRATEGY — why we use selector arrays instead of single strings:
 *   ChatGPT and Claude both update their DOM regularly. A single hardcoded
 *   selector breaks silently. We try selectors in priority order and use the
 *   first one that returns results. Adding a new selector on top never breaks
 *   the old ones — it just takes priority.
 */

(() => {
  "use strict";

  // ─── Platform Config ──────────────────────────────────────────────────────

  const PLATFORMS = {
    chatgpt: {
      match: () =>
        location.hostname.includes("chatgpt.com") ||
        location.hostname.includes("openai.com"),

      // Each array is tried in order — first one with matching nodes wins
      messageSelectors: [
        "article[data-testid]",
        "div[data-message-id]",
        "[data-testid^='conversation-turn']",
        "div[class*='ConversationItem']",
      ],

      inputWrapperSelectors: [
        "form:has(#prompt-textarea)",
        "form:has(textarea)",
        "div[class*='composer']",
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
          "[data-testid='model-switcher-dropdown-button'], button[aria-label*='GPT'], span[class*='model-name']"
        );
        if (!btn) return "default";
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

      // Claude's DOM as of 2025-2026.
      // Strategy: we cast a wide net. Even if class names change, the
      // structural role attributes (data-testid) tend to be more stable.
      // The text-content fallback (last entries) grabs the prose containers
      // directly if all else fails.
      messageSelectors: [
        // Most stable — testid attributes
        "[data-testid='human-turn']",
        "[data-testid='ai-turn']",
        "[data-testid='human-turn-content']",
        "[data-testid='ai-turn-content']",
        // Class-based fallbacks (Claude uses Tailwind so classes are hashed,
        // but these structural markers have been consistent)
        "div[class*='humanTurn']",
        "div[class*='assistantTurn']",
        // Widest net — grab any direct child of the scrollable conversation
        // container. We identify the container first, then its children.
        // This is handled separately in getMessageNodes() below.
      ],

      // Claude's input is a contenteditable div, not a textarea.
      // The wrapper we want to insert above is the outer composer container.
      inputWrapperSelectors: [
        // Stable: the fieldset wrapping the entire composer
        "fieldset",
        // Class-based fallbacks
        "div[class*='composer']",
        "div[class*='inputArea']",
        "div[class*='InputArea']",
        // Last resort: the parent of the contenteditable
        "div[contenteditable='true']",
      ],

      limits: {
        default: 200000,
        "claude-3-5-sonnet": 200000,
        "claude-3-opus": 200000,
        "claude-3-haiku": 200000,
        "claude-sonnet-4": 200000,
        "claude-opus-4": 200000,
      },

      getActiveModel: () => "default",

      getSessionId: () => {
        // Claude URL: /chat/<uuid>
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

  // ─── Selector Resolution ───────────────────────────────────────────────────

  /**
   * Try each selector in the array. Return the NodeList from the first one
   * that actually matches something. If nothing matches, return [].
   * This is the core of our resilience strategy.
   */
  function resolveNodes(selectors) {
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) return Array.from(nodes);
      } catch (e) {
        // Invalid selector (e.g. :has() not supported) — skip silently
      }
    }
    return [];
  }

  /**
   * For Claude specifically: if the standard selectors all miss,
   * fall back to finding the scrollable conversation container and
   * reading its direct children that contain substantial text.
   * This is the "nuclear option" — works regardless of class names.
   */
  function getClaudeMessagesFallback() {
    // Claude's conversation scroll container has a large scrollHeight
    // and contains alternating human/AI turns as direct children
    const candidates = Array.from(
      document.querySelectorAll("div[class*='scroll'], main > div > div, div[class*='conversation']")
    );

    for (const container of candidates) {
      const children = Array.from(container.children);
      // A real conversation container has multiple children with text
      const textChildren = children.filter(
        (el) => (el.textContent || "").trim().length > 20
      );
      if (textChildren.length >= 2) {
        return textChildren;
      }
    }
    return [];
  }

  function resolveInputWrapper() {
    const nodes = resolveNodes(platform.inputWrapperSelectors);
    if (nodes.length > 0) return nodes[0];

    // Last-resort fallback for Claude: find the contenteditable and walk up
    // to a container that makes sense to insert above
    if (platform === PLATFORMS.claude) {
      const ce = document.querySelector("div[contenteditable='true']");
      if (ce) {
        // Walk up 3 levels to find a reasonable wrapper
        let el = ce.parentElement;
        for (let i = 0; i < 3 && el; i++) {
          if (el.tagName === "FIELDSET" || el.tagName === "FORM") return el;
          el = el.parentElement;
        }
        return ce.parentElement;
      }
    }
    return null;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    platform = Object.values(PLATFORMS).find((p) => p.match());
    if (!platform) return;

    lastSessionId = platform.getSessionId();

    injectUI();
    startObserver();
    startSessionWatcher();

    // Initial scan — retry a few times in case DOM is still hydrating
    setTimeout(scan, 800);
    setTimeout(scan, 2000);
    setTimeout(scan, 4000);
  }

  // ─── Token Scanning ────────────────────────────────────────────────────────

  function scan() {
    if (!platform) return;

    let messageNodes = resolveNodes(platform.messageSelectors);

    // Claude fallback if primary selectors found nothing
    if (messageNodes.length === 0 && platform === PLATFORMS.claude) {
      messageNodes = getClaudeMessagesFallback();
    }

    const texts = messageNodes.map((el) => el.textContent || "");
    const tokenCount = Tokenizer.estimateMessages(texts);

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
      // Re-inject UI in case SPA navigation removed it
      setTimeout(() => {
        injectUI();
        scan();
      }, 800);
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

  function injectUI() {
    // Remove stale bar if present (after SPA navigation)
    const existing = document.getElementById("tt-bar");
    if (existing) {
      // Already in DOM and attached — nothing to do
      if (document.contains(existing)) return;
      existing.remove();
    }

    uiBar = document.createElement("div");
    uiBar.id = "tt-bar";
    uiBar.innerHTML = `
      <div class="tt-inner">
        <span class="tt-label">TOKENS</span>
        <div class="tt-track">
          <div class="tt-fill" id="tt-fill"></div>
        </div>
        <span class="tt-count" id="tt-count">— / —</span>
      </div>
    `;

    const tryAnchor = () => {
      const wrapper = resolveInputWrapper();
      if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.insertBefore(uiBar, wrapper);
        uiBar.classList.add("tt-anchored");
        return true;
      }
      return false;
    };

    if (!tryAnchor()) {
      document.body.appendChild(uiBar);
      const retryTimer = setInterval(() => {
        if (tryAnchor()) clearInterval(retryTimer);
      }, 800);
      setTimeout(() => clearInterval(retryTimer), 15000);
    }
  }

  function updateUI(used, limit) {
    const fillEl = document.getElementById("tt-fill");
    const countEl = document.getElementById("tt-count");

    if (!fillEl || !countEl) {
      injectUI();
      return;
    }

    const pct = Math.min((used / limit) * 100, 100);
    const remaining = Math.max(limit - used, 0);

    fillEl.style.width = pct + "%";
    fillEl.className =
      "tt-fill" +
      (pct >= 90 ? " tt-critical" : pct >= 70 ? " tt-warn" : "");

    countEl.textContent = `${formatK(remaining)} left`;
    countEl.className =
      "tt-count" +
      (pct >= 90 ? " tt-critical" : pct >= 70 ? " tt-warn" : "");

    if (uiBar) {
      uiBar.title = `~${formatK(used)} tokens used of ~${formatK(limit)} limit`;
    }

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
    popup.innerHTML = `
      <div class="tt-popup-box">
        <div class="tt-popup-icon">⚠</div>
        <h3 class="tt-popup-title">Context Limit Reached</h3>
        <p class="tt-popup-body">
          This conversation has used approximately <strong>~${formatK(limit)} tokens</strong> —
          the full context window. The model may start forgetting earlier parts of your conversation.
        </p>
        <p class="tt-popup-tip">Start a new chat to reset the token counter and get full context.</p>
        <button class="tt-popup-close" id="tt-popup-close">Got it</button>
      </div>
    `;

    document.body.appendChild(popup);

    document.getElementById("tt-popup-close").addEventListener("click", () => {
      popup.classList.add("tt-popup-fade");
      setTimeout(() => popup.remove(), 300);
    });

    setTimeout(() => {
      const p = document.getElementById("tt-popup");
      if (p) {
        p.classList.add("tt-popup-fade");
        setTimeout(() => p.remove(), 300);
      }
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
      const p = platform;
      const model = p ? p.getActiveModel() : "default";
      const limit = p ? p.limits[model] || p.limits.default : 128000;
      const platformName = location.hostname.includes("claude.ai")
        ? "Claude"
        : "ChatGPT";

      sendResponse({ used: lastTokenCount, limit, platform: platformName, model });
    }
    return true;
  });

})();