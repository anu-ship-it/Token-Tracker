/**
 * service-worker.js
 * Central orchestrator. Responsibilities:
 *  1. On install: set up alarms, open welcome page
 *  2. On alarm: fetch Claude usage, update icon, fire notifications
 *  3. On message from content/popup: respond with latest data
 *  4. Icon rendering via offscreen document (MV3 requirement)
 */

importScripts(
  "../lib/constants.js",
  "../lib/storage.js",
  "../lib/claude-api.js",
);

// ── Install ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("../welcome/welcome.html") });
  }
  await setupAlarm();
});

chrome.runtime.onStartup.addListener(setupAlarm);

async function setupAlarm() {
  const settings = await Storage.getSettings();
  const mins = settings.refresh_minutes || TT_CONSTANTS.ALARMS.FETCH_INTERVAL_MINUTES;
  await chrome.alarms.clearAll();
  chrome.alarms.create(TT_CONSTANTS.ALARMS.FETCH_USAGE, {
    periodInMinutes: mins,
    delayInMinutes: 0.1,
  });
}

// ── Alarm handler ──────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TT_CONSTANTS.ALARMS.FETCH_USAGE) return;
  await refreshAll();
});

async function refreshAll() {
  // Fetch Claude usage (runs from background — needs active claude.ai tab for cookies)
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  if (tabs.length > 0) {
    // Delegate fetch to content script which has cookie access
    chrome.tabs.sendMessage(tabs[0].id, { type: "FETCH_CLAUDE_USAGE" });
  }
  await updateIcon();
}

// ── Icon update ────────────────────────────────────────────────────
async function updateIcon() {
  try {
    const usage = await Storage.getClaudeUsage();
    const context = await Storage.getContext();

    let outerPct = 0;
    let innerPct = 0;

    if (usage) {
      outerPct = usage.seven_day?.utilization ?? 0;
      innerPct = usage.five_hour?.utilization ?? 0;
    } else {
      // Fall back to context window % from whichever platform was last active
      const claude = context["claude"];
      const gpt    = context["chatgpt"];
      const active = claude || gpt;
      if (active) outerPct = Math.round((active.used / active.limit) * 100);
    }

    await setIcon(outerPct, innerPct);
  } catch (e) {
    console.error("[TT] Icon update failed:", e);
  }
}

async function setIcon(outerPct, innerPct) {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL("lib/offscreen.html"),
      reasons: ["CANVAS"],
      justification: "Render token usage rings onto toolbar icon",
    });
  }

  // Small delay to ensure the document is ready to receive messages
  await new Promise(res => setTimeout(res, 100));

  try {
    chrome.runtime.sendMessage({
      type:  "RENDER_ICON",
      outer: outerPct,
      inner: innerPct,
    });
  } catch (_) {
    // Offscreen doc not ready — skip this render cycle, next alarm will retry
  }
}

// ── Message handler ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case "CLAUDE_USAGE_RESULT": {
        // Content script fetched usage and sends it back
        if (msg.usage) {
          await Storage.saveClaudeUsage(msg.usage);
          await updateIcon();
          await checkNotifications(msg.usage);
        }
        break;
      }

      case "CONTEXT_UPDATE": {
        // Content script reports context window usage
        await Storage.saveContext(msg.platform, { used: msg.used, limit: msg.limit });
        await updateIcon();
        sendResponse({ ok: true });
        break;
      }

      case "GET_ALL_DATA": {
        // Popup requesting full data
        const [usage, context, history, settings] = await Promise.all([
          Storage.getClaudeUsage(),
          Storage.getContext(),
          Storage.getHistory(),
          Storage.getSettings(),
        ]);
        sendResponse({ usage, context, history, settings });
        break;
      }

      case "SAVE_SETTINGS": {
        await Storage.saveSettings(msg.settings);
        await setupAlarm(); // re-schedule with new interval
        sendResponse({ ok: true });
        break;
      }

      case "ICON_RENDERED": {
        // Offscreen doc finished rendering — apply to toolbar
        if (msg.imageData) {
          const imgData = new ImageData(
            new Uint8ClampedArray(msg.imageData),
            msg.width,
            msg.height
          );
          // Convert to object chrome.action.setIcon accepts
          chrome.action.setIcon({ imageData: { 32: imgData } });
        }
        break;
      }

      case "FORCE_REFRESH": {
        await refreshAll();
        sendResponse({ ok: true });
        break;
      }
    }
  })();
  return true;
});

// ── Notifications ──────────────────────────────────────────────────
async function checkNotifications(usage) {
  const settings = await Storage.getSettings();
  const lastNotified = await Storage.getLastNotified();
  const now = Date.now();
  const COOLDOWN = 30 * 60 * 1000; // 30 min between same-level notifications

  const checks = [
    { key: "100", pct: Math.max(usage.five_hour.utilization, usage.seven_day.utilization), threshold: 100, enabled: settings.notify_at_100, title: "Token limit reached", body: "You've hit your usage limit on Claude." },
    { key: "90",  pct: Math.max(usage.five_hour.utilization, usage.seven_day.utilization), threshold: 90,  enabled: settings.notify_at_90,  title: "Approaching token limit", body: "Claude usage is at 90%. Consider starting a new session." },
    { key: "70",  pct: Math.max(usage.five_hour.utilization, usage.seven_day.utilization), threshold: 70,  enabled: settings.notify_at_70,  title: "Token usage at 70%", body: "Claude usage is at 70%." },
  ];

  for (const check of checks) {
    if (!check.enabled) continue;
    if (check.pct < check.threshold) continue;
    if (lastNotified[check.key] && now - lastNotified[check.key] < COOLDOWN) continue;

    chrome.notifications.create(`tt_notif_${check.key}`, {
      type:    "basic",
      iconUrl: chrome.runtime.getURL("../icons/icon48.png"),
      title:   check.title,
      message: check.body,
    });

    lastNotified[check.key] = now;
    await Storage.saveLastNotified(lastNotified);
    break; // Only fire highest applicable notification
  }
}
