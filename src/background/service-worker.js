/**
 * service-worker.js
 * Responsibilities:
 *  1. On install: set up alarm, open welcome page
 *  2. On alarm: tell content script to fetch Claude usage
 *  3. Store usage data and fire notifications
 *  4. Respond to popup data requests
 */

importScripts(
  "../lib/constants.js",
  "../lib/storage.js"
);

// ── Install ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
  }
  await setupAlarm();
});

chrome.runtime.onStartup.addListener(setupAlarm);

async function setupAlarm() {
  const settings = await Storage.getSettings();
  const mins = settings.refresh_minutes || 5;
  await chrome.alarms.clearAll();
  chrome.alarms.create(TT.ALARM, {
    periodInMinutes: mins,
    delayInMinutes: 0.1,
  });
}

// ── Alarm ──────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TT.ALARM) return;
  triggerUsageFetch();
});

function triggerUsageFetch() {
  // Delegate to content script — it has cookie access for the API call
  chrome.tabs.query({ url: "https://claude.ai/*" }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "FETCH_CLAUDE_USAGE" });
    }
  });
}

// ── Messages ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case "CLAUDE_USAGE_RESULT": {
        if (msg.usage) {
          await Storage.saveUsage(msg.usage);
          await checkNotifications(msg.usage);
        }
        break;
      }

      case "CONTEXT_UPDATE": {
        await Storage.saveContext(msg.platform, {
          used:  msg.used,
          limit: msg.limit,
        });
        sendResponse({ ok: true });
        break;
      }

      case "GET_ALL_DATA": {
        const [usage, context, history, settings] = await Promise.all([
          Storage.getUsage(),
          Storage.getContext(),
          Storage.getHistory(),
          Storage.getSettings(),
        ]);
        sendResponse({ usage, context, history, settings });
        break;
      }

      case "SAVE_SETTINGS": {
        await Storage.saveSettings(msg.settings);
        await setupAlarm();
        sendResponse({ ok: true });
        break;
      }

      case "FORCE_REFRESH": {
        triggerUsageFetch();
        sendResponse({ ok: true });
        break;
      }
    }
  })();
  return true;
});

// ── Notifications ──────────────────────────────────────────────────
async function checkNotifications(usage) {
  const settings     = await Storage.getSettings();
  const lastNotified = await Storage.getLastNotified();
  const now          = Date.now();
  const COOLDOWN     = 30 * 60 * 1000; // 30 min per threshold

  const highestPct = Math.max(
    usage.five_hour?.utilization || 0,
    usage.seven_day?.utilization || 0
  );

  const checks = [
    {
      key: "100", threshold: 100, enabled: settings.notify_100,
      title: "Token limit reached",
      body:  "You've hit your Claude usage limit.",
    },
    {
      key: "90", threshold: 90, enabled: settings.notify_90,
      title: "Approaching limit — 90%",
      body:  "Claude usage is at 90%. Consider starting a new session soon.",
    },
    {
      key: "70", threshold: 70, enabled: settings.notify_70,
      title: "Token usage at 70%",
      body:  "Claude usage is at 70%.",
    },
  ];

  for (const check of checks) {
    if (!check.enabled) continue;
    if (highestPct < check.threshold) continue;
    if (lastNotified[check.key] && now - lastNotified[check.key] < COOLDOWN) continue;

    chrome.notifications.create(`tt_${check.key}`, {
      type:    "basic",
      iconUrl: chrome.runtime.getURL("icons/icon48.png"),
      title:   check.title,
      message: check.body,
    });

    lastNotified[check.key] = now;
    await Storage.saveLastNotified(lastNotified);
    break; // Only fire the highest applicable level
  }
}
