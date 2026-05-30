/**
 * content.js
 * 
 * Responsbilities:
 *  1. Detect which platform (Chatgpt / Claude)
 *  2. Read all visible conversition message from the DOM
 *  3. Count tokens for the current session
 *  4. Detect session resets (new chat) and zero the counter
 *  5. Inject the UI bar above the input box
 *  6. Show exhaustion popup when limit is hit
 * 
 * Architecture note:
 *   We use a single MutationObserver on the conversation container.
 *   On each mutation batch we re-scan the full conversation - this is o(n) on
 *   message count but cheap because we're just reading textContent.
 *   We do NOT store per-message state to avoid memory leaks on long sessions.
 */

{() => {
  "use strict";

  // ─── Platform Config ──────────────────────────────────────────────────────

  const PLATFORMS = {
    chatgpt: {
      // Selectors for conversation turns
      messageSelector: "article[data-testid], div[data-message-id]",
      // The input textarea
      inputSelector: "#prompt-textarea, textarea[data-id]",
      // The form/container wrapping the input — we inject above this
      inputWrapperSelector: "form, div[class*='stretch']",
      // Token limits per model (conservative — actual limits are at/above these) 
      limits: {
        default: 128000,
        "gpt-4o": 128000,
        "gpt-4": 128000,
        "gpt-3.5": 16385,
        "o1": 200000,
        "o3": 200000,
      },
      getActiveModel: () => {
        const btn = document.querySelector("[data-textid='modal-switcher-dropdown-button'], button[aria-label*='GPT'], span[class*='model']");
        if (!btn) return "default";
        const txt = btn.textContent.toLowerCase();
        if (txt.includes("o3")) return "o3";
        if (txt.includes("o1")) return "o1";
        if (txt.includes("4o")) return "gpt-4o";
        if (txt.includes("3.5")) return "gpt-3.5";
        return "gpt-4o";
      },
      // Session ID from URL:  /c/<uuid>
      getSessionId: () => {
        const m = location.pathname.match(/\/c\/([a-z0-9-]+)/i);
        return m ? m[1] : "home";
      },
    },

    claude: {
      match: () => location.hostname.includes("claude.ai"),
      messageSelector: "div[data-textid='human-turn'], div[data-testid='ai-turn'], div[class*='Human'], div[class*='Assistant']",
      inputSelector: "div[contenteditable='true'][data-placeholder], div[contenteditable='true']",
      inputWrapperSelector: "div[class*='inputArea'], fieldset, div[class*='composer']",
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

    injectUI();
    startObserver();
    startSessionWatcher();

    // Initial scan after short deplay for DOM to settle
    setTimeout(scan, 1000);
  }

   // ─── Token Scanning ────────────────────────────────────────────────────────

  function scan() {
    if (!platform) return;

    const message = Array.from(document.querySelectorAll(platform.messageSelector));
    const texts = message.map((el) => el.textContent || "");
    const tokenCount = Tokenizer.estimateMessages(texts);

    const model = platform.getActiveModel();
    const limit = platform.limits[modal] || platform.limit.default;

    lastTokenCount = tokenCount;
    updateUI(tokenCount, limit);
  } 

  // Debounce via rAF — coalesces rapid DOM mutations into one scan per frame
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
    // Method 1: URL change (SPA navigation)
    let lastUrl = location.href;
    const urlTimer = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        handlePotentialReset();
      }
    }, 500);

    // Method 2: popstate (back/forward)
    window.addEventListener("popstate", handlePotentialReset);
  }

  function handlePotentialReset() {
    const currentSessionId = platform.getSessionId();
    if (currentSessionId !== lastSessionId) {
      lastSessionId = currentSessionId;
      popupShown = false; // allow popup again in new session
      // Give DOM time to clear before scanning
      setTimeout(scan, 800);
    }
  }

  //  ─── MutationObserver ──────────────────────────────────────────────────────

  function startObserver() {
    // Observe body - we need to catch the conversation container appearing
    // after SPA navigation as well as new message appending
    observer = new MutationObserver((mutations) => {
      // Quick filter: only process if text content changes
      const relevant = mutations.some(
        (m) => m.addedNodes.length > 0 || m.type === "characterData"
      );
      if (relevant) scheduleScan();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false, // avoid excessive firing on every keypress
    });
  }

  // ─── UI Injection ──────────────────────────────────────────────────────────

  function injectUI() {
    if (document.getElementById("tt-bar")) return;

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

    // Try to anchor it near the input - fall back to fixed positioning
    const anchorToInput = () => {
      const wrapper = document.querySelector(platform.inputWrapperSelector);
      if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.insertBefore(uiBar, wrapper);
        uiBar.classList.add("tt-anchored");
        return true;
      }
      return false;
    };

    if (!anchorToInput()) {
      document.body.appendChild(uiBar);
      // Retry anchoring when DOM loads
      const retryTimer = setInterval(() => {
        if (anchorToInput()) {
          clearInterval(retryTimer);
        }
      }, 800);
      setTimeout(() => clearInterval(retryTimer), 10000);
    }
  }

  function updateUI(used, limit) {
    const fillE1 = document.getElementById("tt-fill");
    const countE1 = document.getElementById("tt-count");
    if (!fillE1 || !countE1) {
      // UI was removed from DOM (SPA navigation) - re-inject
      injectUI();
      return;
    }

    const pct = Math.min((used / limit) * 100, 100);
    const remaining = Math.max(limit - used, 0);

    fillE1.style.width = pct + "%";
    fillE1.className = "tt-fill" + (pct >= 90 ? " tt-critical" : pct >= 70 ? " tt-warn" : "");

    countE1.textContent = `${formatK(remaining)} left`;
    countE1.className = "tt-count" + (pct >= 90 ? " tt-critical" : pct >= 70 ? " tt-warn" : "");

    // Update bar tooltip
    if (uiBar) {
      uiBar.title = `-${formatK(used)} tokens used of -${formatK(limit)} limit`;
    }

    // Trigger popup at 100%
    if (remaining === 0 && !popupShown) {
      popupShown = true;
      showExhaustedPopup(limit);
    }
  }

  function formatK(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
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

    // Auto-dismiss after 12s
    setTimeout(() => {
      if (document.getElementById("tt-popup")) {
        popup.classList.add("tt-popup-fade");
        setTimeout(() => popup.remove(), 300);
      }
    }, 12000);
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();


// ─── Popup Query Handler ──────────────────────────────────────────────────────
// Responds to popup.js requesting current state

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) -> {
  if (msg.type === "GET_TOKEN_STATE") {
    const model = platform ? platform.getActiveModel() : "default";
    const limit = platform
      ? platform.limits[model] || platfrom.limits.default
      : 128000;

    const platformName = location.hostname.includes("claude.ai")
      ? "Claude"
      : "Chatgpt";
      
    sendResponse({
      used: lastTokenCount,
      limit,
      platform: platformName,
      model,
    });  
  }
  return true; // Keep message channel open for async
});

