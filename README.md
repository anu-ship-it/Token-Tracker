# Token Tracker — Chrome Extension

Live token counter for ChatGPT and Claude. Shows remaining context window tokens directly above the input box.

---

## Install (Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `token-tracker-extension` folder
5. Open ChatGPT or Claude — the bar appears above the input

---

## How It Works

| Step | Mechanism |
|------|-----------|
| Token counting | Character count ÷ 4 (OpenAI's documented approximation) |
| Session reset | URL change detection + MutationObserver on conversation container |
| Model detection | Reads the active model button text from the DOM |
| Context limits | Hardcoded per model (GPT-4o: 128k, Claude: 200k) |

**Accuracy:** ±5–10%. The estimator errs conservative (shows slightly more remaining than actual), which is the safe direction — no false urgency.

---

## UI States

| Fill Color | Meaning |
|------------|---------|
| 🟢 Green | < 70% used |
| 🟡 Yellow | 70–90% used |
| 🔴 Red (pulsing) | > 90% used |
| Popup | 100% reached — context window full |

---

## File Structure

```
manifest.json      — Extension config (MV3)
tokenizer.js       — Token estimator (loaded before content.js)
content.js         — DOM reading, UI injection, session tracking
injected.css       — Styles for bar + popup (scoped, no collisions)
background.js      — Service worker (minimal — just keeps extension alive)
popup.html/js      — Extension popup (click the toolbar icon)
icons/             — Extension icons
```

---

## Adding a New Platform (Future)

1. Add a new entry to `PLATFORMS` in `content.js`
2. Add its `match()`, `messageSelector`, `inputWrapperSelector`, `limits`, `getActiveModel()`, `getSessionId()`
3. Add the URL to `host_permissions` in `manifest.json`
4. Add to `SUPPORTED` array in `popup.js`

No changes needed to tokenizer, CSS, or background.

---

## Known Limitations

- Token count resets on page refresh (no persistence yet — add `chrome.storage` in v2)
- Model auto-detection depends on ChatGPT/Claude DOM — may break on UI updates
- Does not count system prompts (they're hidden from the DOM)

---

## Root Cause Debugging

If the bar doesn't appear:
1. Check `chrome://extensions/` for errors
2. Open DevTools on the ChatGPT/Claude tab → Console → look for `[TokenTracker]` messages
3. Most likely cause: the `inputWrapperSelector` changed after a ChatGPT/Claude UI update — update the selector in `content.js` `PLATFORMS` config

