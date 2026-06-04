/**
 * service-worker.js
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
    delayInMinutes:  0.1,
  });
}

// ── Alarm ──────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TT.ALARM) return;
  triggerUsageFetch();
});

function triggerUsageFetch() {
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
        await Storage.saveContext(msg.platform, { used: msg.used, limit: msg.limit });
        await checkContextNotifications(msg.platform, msg.used, msg.limit);
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

// ── Notification helper ────────────────────────────────────────────
function notify(id, title, message) {
  chrome.notifications.create(id, {
    type:    "basic",
    title:    "Test",
    message:   "Notifications working",
    iconUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  });
}

// ── Claude rate limit notifications ───────────────────────────────
async function checkNotifications(usage) {
  const settings     = await Storage.getSettings();
  const lastNotified = await Storage.getLastNotified();
  const now          = Date.now();
  const COOLDOWN     = 30 * 60 * 1000;

  const highestPct = Math.max(
    usage.five_hour?.utilization || 0,
    usage.seven_day?.utilization || 0
  );

  const checks = [
    { key: "100", threshold: 100, enabled: settings.notify_100, title: "Token limit reached",      body: "You've hit your Claude usage limit." },
    { key: "90",  threshold: 90,  enabled: settings.notify_90,  title: "Approaching limit — 90%",  body: "Claude usage is at 90%. Consider a new session." },
    { key: "75",  threshold: 75,  enabled: settings.notify_75,  title: "Token usage at 75%",       body: "Claude usage is at 75%." },
    { key: "50",  threshold: 50,  enabled: settings.notify_50,  title: "Halfway through — 50%",    body: "Claude usage is at 50%." },
  ];

  for (const check of checks) {
    if (!check.enabled) continue;
    if (highestPct < check.threshold) continue;
    if (lastNotified[check.key] && now - lastNotified[check.key] < COOLDOWN) continue;

    notify(`tt_rate_${check.key}`, check.title, check.body);
    lastNotified[check.key] = now;
    await Storage.saveLastNotified(lastNotified);
    break;
  }
}

// ── Context window notifications (both platforms) ─────────────────
async function checkContextNotifications(platform, used, limit) {
  if (!used || !limit) return;
  const settings     = await Storage.getSettings();
  const lastNotified = await Storage.getLastNotified();
  const now          = Date.now();
  const COOLDOWN     = 30 * 60 * 1000;
  const pct          = Math.round((used / limit) * 100);
  const name         = platform === "claude" ? "Claude" : "ChatGPT";

  const checks = [
    { key: `ctx_${platform}_100`, threshold: 100, enabled: settings.notify_100, title: `${name} context full`,       body: "Context window is full. Start a new chat." },
    { key: `ctx_${platform}_90`,  threshold: 90,  enabled: settings.notify_90,  title: `${name} context at 90%`,    body: `${name} context window is 90% full.` },
    { key: `ctx_${platform}_75`,  threshold: 75,  enabled: settings.notify_75,  title: `${name} context at 75%`,    body: `${name} context window is 75% full.` },
    { key: `ctx_${platform}_50`,  threshold: 50,  enabled: settings.notify_50,  title: `${name} context at 50%`,    body: `${name} context window is halfway full.` },
  ];

  for (const check of checks) {
    if (!check.enabled) continue;
    if (pct < check.threshold) continue;
    if (lastNotified[check.key] && now - lastNotified[check.key] < COOLDOWN) continue;

    notify(check.key, check.title, check.body);
    lastNotified[check.key] = now;
    await Storage.saveLastNotified(lastNotified);
    break;
  }
}