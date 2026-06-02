/**
 * constants.js
 * Single source of truth. Nothing is hardcoded anywhere else.
 */

const TT = {

  // ── Claude API ─────────────────────────────────────────────────
  API: {
    ORGS:       "https://claude.ai/api/organizations",
    USAGE:      (id) => `https://claude.ai/api/organizations/${id}/usage`,
  },

  // ── Context window limits per model ───────────────────────────
  LIMITS: {
    "default":         200000,
    "claude-sonnet-4": 200000,
    "claude-opus-4":   200000,
    "claude-haiku-4":  200000,
    "gpt-4o":          128000,
    "gpt-4":           128000,
    "gpt-3.5":         16385,
    "o1":              200000,
    "o3":              200000,
  },

  // ── Thresholds ─────────────────────────────────────────────────
  WARN:     70,
  DANGER:   90,

  // ── Colors ────────────────────────────────────────────────────
  COLOR: {
    GREEN:  "#22c55e",
    YELLOW: "#f59e0b",
    RED:    "#ef4444",
  },

  // ── Storage keys ──────────────────────────────────────────────
  KEY: {
    ORG_ID:    "tt_org_id",
    USAGE:     "tt_claude_usage",
    CONTEXT:   "tt_context",
    HISTORY:   "tt_history",
    SETTINGS:  "tt_settings",
    NOTIFIED:  "tt_last_notified",
  },

  // ── Alarm ─────────────────────────────────────────────────────
  ALARM: "tt_fetch",

  // ── Default settings ──────────────────────────────────────────
  DEFAULTS: {
    notify_70:       true,
    notify_90:       true,
    notify_100:      true,
    refresh_minutes: 5,
    show_bar:        true,
  },
};
