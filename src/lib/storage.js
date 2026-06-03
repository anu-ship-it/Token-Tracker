/**
 * storage.js
 * Every chrome.storage read/write goes through here. Nowhere else.
 */

const Storage = {

  async get(key) {
    return new Promise(res =>
      chrome.storage.local.get([key], r => res(r[key] ?? null))
    );
  },

  async set(key, value) {
    return new Promise(res =>
      chrome.storage.local.set({ [key]: value }, res)
    );
  },

  // ── Settings ─────────────────────────────────────────────────
  async getSettings() {
    const s = await Storage.get(TT.KEY.SETTINGS);
    return { ...TT.DEFAULTS, ...(s || {}) };
  },
  async saveSettings(s) {
    return Storage.set(TT.KEY.SETTINGS, s);
  },

  // ── Claude org ID ─────────────────────────────────────────────
  async getOrgId() {
    return Storage.get(TT.KEY.ORG_ID);
  },
  async saveOrgId(id) {
    return Storage.set(TT.KEY.ORG_ID, id);
  },

  // ── Claude usage (rate limits) ────────────────────────────────
  async getUsage() {
    return Storage.get(TT.KEY.USAGE);
  },
  async saveUsage(usage) {
    return Storage.set(TT.KEY.USAGE, { ...usage, fetched_at: Date.now() });
  },

  // ── Context window (both platforms) ──────────────────────────
  async getContext() {
    return (await Storage.get(TT.KEY.CONTEXT)) || {};
  },
  async saveContext(platform, data) {
    const all = await Storage.getContext();
    all[platform] = { ...data, ts: Date.now() };
    return Storage.set(TT.KEY.CONTEXT, all);
  },

  // ── Session history ───────────────────────────────────────────
  async getHistory() {
    return (await Storage.get(TT.KEY.HISTORY)) || [];
  },
  async pushHistory(entry) {
    const h   = await Storage.getHistory();
    const key = entry.platform + "_" + new Date().toDateString();
    const idx = h.findIndex(x => x.key === key);
    const rec = { ...entry, key, ts: Date.now() };
    if (idx >= 0) h[idx] = rec; else h.push(rec);
    return Storage.set(TT.KEY.HISTORY, h.slice(-60));
  },

  // ── Notification cooldown ─────────────────────────────────────
  async getLastNotified() {
    return (await Storage.get(TT.KEY.NOTIFIED)) || {};
  },
  async saveLastNotified(data) {
    return Storage.set(TT.KEY.NOTIFIED, data);
  },
};
