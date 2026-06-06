importScripts(
  "../lib/constants.js",
  "../lib/storage.js"
);

// Notification icon — green square, no file dependency
const ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAuUlEQVR42u3ZUQqEMAwEUM+yB/O2nmv3SxDxw7aTSTI7gX4a5oGgTbbN5XKF1ufYv22Cjp62wUtAEMFTIBHBaRBG+DAEMzwckREehsgMD0GcTdgFAVybZAKmEa0B9wbZgGFEa8DTwxUArxGSgJEzEwz6TTDAgAUA4t8lEkBB+BUywAAD1m9nFQG0u3AJwAoiAkCdSJQBzCLQAPpcqBSg/WROYjYqMZ2W2A9IbGhkdmQyW0qZPbHrX+sHzlo+ECwx5L4AAAAASUVORK5CYII=";

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
chrome.alarms.onAlarm.addListener((alarm) => {
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
          await checkRateLimitNotifications(msg.usage);
        }
        break;
      }

      case "CONTEXT_UPDATE": {
        await Storage.saveContext(msg.platform, { used: msg.used, limit: msg.limit });
        // Context notifications fire immediately on every update — no timer delay
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
function notify(id, title, message, priority) {
  chrome.notifications.create(id, {
    type:     "basic",
    iconUrl:  ICON,
    title:    `Token Tracker — ${title}`,
    message,
    priority: priority || 1,
  });
}

// ── Threshold tracker ──────────────────────────────────────────────
// Only notifies when crossing a NEW higher threshold.
// Resets when usage drops below lowest threshold.
const THRESHOLDS = [50, 75, 90, 100];

async function shouldNotify(stateKey, currentPct, settings) {
  const enabled = THRESHOLDS.filter(t => {
    if (t === 50)  return settings.notify_50;
    if (t === 75)  return settings.notify_75;
    if (t === 90)  return settings.notify_90;
    if (t === 100) return settings.notify_100;
    return false;
  });

  if (enabled.length === 0) return null;

  const crossed     = enabled.filter(t => currentPct >= t).pop() || 0;
  const lastNotified = await Storage.getLastNotified();
  const last        = lastNotified[stateKey] || 0;

  // Reset if dropped below all thresholds
  if (crossed === 0 && last > 0) {
    lastNotified[stateKey] = 0;
    await Storage.saveLastNotified(lastNotified);
    return null;
  }

  // Only fire for a new higher threshold
  if (crossed <= 0 || crossed <= last) return null;

  lastNotified[stateKey] = crossed;
  await Storage.saveLastNotified(lastNotified);
  return crossed;
}

// ── Claude rate limit notifications ───────────────────────────────
async function checkRateLimitNotifications(usage) {
  const settings   = await Storage.getSettings();
  const sessionPct = usage.five_hour?.utilization || 0;
  const weeklyPct  = usage.seven_day?.utilization  || 0;
  const maxPct     = Math.max(sessionPct, weeklyPct);

  const threshold = await shouldNotify("claude_rate", maxPct, settings);
  if (!threshold) return;

  const isSession = sessionPct >= weeklyPct;
  const pct       = Math.round(isSession ? sessionPct : weeklyPct);
  const limitType = isSession ? "5-hour session" : "7-day weekly";
  const priority  = threshold >= 90 ? 2 : 1;

  const tips = {
    50:  "You're halfway through your Claude limit.",
    75:  "Only 25% of your Claude limit remaining.",
    90:  "Almost out — consider wrapping up soon.",
    100: "Limit reached. Usage will be restricted.",
  };

  notify(
    `tt_rate_${threshold}`,
    `Claude ${limitType} at ${pct}%`,
    tips[threshold] || `Your ${limitType} usage has reached ${pct}%.`,
    priority
  );
}

// ── Context window notifications ───────────────────────────────────
// Fires immediately on every scan — no timer delay
async function checkContextNotifications(platform, used, limit) {
  if (!used || !limit) return;
  const settings  = await Storage.getSettings();
  const pct       = Math.round((used / limit) * 100);
  const name      = platform === "claude" ? "Claude" : "ChatGPT";
  const remaining = Math.round((limit - used) / 1000);

  const threshold = await shouldNotify(`ctx_${platform}`, pct, settings);
  if (!threshold) return;

  const priority = threshold >= 90 ? 2 : 1;

  const messages = {
    50:  `~${remaining}k tokens remaining. You're halfway through this conversation's context.`,
    75:  `~${remaining}k tokens remaining. Consider starting a new chat soon.`,
    90:  `~${remaining}k tokens remaining. Context window nearly full — start a new chat.`,
    100: `Context window full. The model may lose earlier parts of your conversation.`,
  };

  notify(
    `tt_ctx_${platform}_${threshold}`,
    `${name} context at ${threshold}%`,
    messages[threshold] || `${name} context window is ${threshold}% full. ~${remaining}k tokens remaining.`,
    priority
  );
}
