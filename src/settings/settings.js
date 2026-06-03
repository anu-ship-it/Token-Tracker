"use strict";

async function load() {
  return new Promise(res =>
    chrome.storage.local.get([TT.KEY.SETTINGS], r => {
      res({ ...TT.DEFAULTS, ...(r[TT.KEY.SETTINGS] || {}) });
    })
  );
}

async function init() {
  const s = await load();
  document.getElementById("n70").checked      = s.notify_70;
  document.getElementById("n90").checked      = s.notify_90;
  document.getElementById("n100").checked     = s.notify_100;
  document.getElementById("show_bar").checked = s.show_bar;
  document.getElementById("refresh").value    = String(s.refresh_minutes);

  document.getElementById("back-btn").addEventListener("click", () => window.close());

  document.getElementById("save-btn").addEventListener("click", async () => {
    const settings = {
      notify_70:       document.getElementById("n70").checked,
      notify_90:       document.getElementById("n90").checked,
      notify_100:      document.getElementById("n100").checked,
      show_bar:        document.getElementById("show_bar").checked,
      refresh_minutes: parseInt(document.getElementById("refresh").value, 10),
    };

    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });

    const el = document.getElementById("saved");
    el.style.opacity = "1";
    setTimeout(() => { el.style.opacity = "0"; }, 2000);
  });
}

init();
