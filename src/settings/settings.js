"use strict";

async function loadSettings() {
  return new Promise(res =>
    chrome.storage.local.get([TT_CONSTANTS.STORAGE_KEYS.SETTINGS], r => {
      res({ ...TT_CONSTANTS.DEFAULT_SETTINGS, ...(r[TT_CONSTANTS.STORAGE_KEYS.SETTINGS] || {}) });
    })
  );
}

async function init() {
  const s = await loadSettings();
  document.getElementById("notify_70").checked      = s.notify_at_70;
  document.getElementById("notify_90").checked      = s.notify_at_90;
  document.getElementById("notify_100").checked     = s.notify_at_100;
  document.getElementById("show_bar").checked       = s.show_context_bar;
  document.getElementById("refresh_minutes").value  = String(s.refresh_minutes);
}

document.getElementById("save-btn").addEventListener("click", async () => {
  const settings = {
    notify_at_70:     document.getElementById("notify_70").checked,
    notify_at_90:     document.getElementById("notify_90").checked,
    notify_at_100:    document.getElementById("notify_100").checked,
    show_context_bar: document.getElementById("show_bar").checked,
    refresh_minutes:  parseInt(document.getElementById("refresh_minutes").value, 10),
  };

  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });

  const msg = document.getElementById("saved-msg");
  msg.style.opacity = "1";
  setTimeout(() => { msg.style.opacity = "0"; }, 2000);
});

init();
