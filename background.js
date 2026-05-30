/**
 * background.js — Service Worker
 *
 * Minimal by design. The token counting logic lives in content.js
 * to avoid message-passing latency on every DOM mutation.
 *
 * This worker only handles:
 *  - Extension install / update housekeeping
 *  - Tab URL change events (for session reset signaling)
 *
 * Future hooks you can add here:
 *  - Syncing token usage history to chrome.storage
 *  - Cross-tab session tracking
 *  - Model limit overrides from a settings page
 */

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    console.log("[TokenTracker] Extension installed.");
  }
});

// Keep service worker alive minimally — no persistent state needed right now
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ping") {
    sendResponse({ alive: true });
  }
});
