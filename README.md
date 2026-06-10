# TokenPulse

**Live token & rate limit tracker for Claude and ChatGPT.**

Built by Anoop Kumar and Mansi Rathore · Alpha

---

## What it does

TokenPulse sits inside Claude and ChatGPT and tells you exactly where you stand — before the model starts forgetting your conversation or your session gets cut off.

A live token bar above the input box tracks your context window in real time. Click the toolbar icon for the full dashboard.

---

## Features

| Feature | Claude | ChatGPT |
|---------|--------|---------|
| Live in-page token bar | ✅ | ✅ |
| Context window tracking | ✅ | ✅ |
| Daily usage history | ✅ | ✅ |
| Real rate limit data (5hr + 7day) | ✅ | — |
| Reset countdowns | ✅ | — |
| Smart notifications (75%, 90%, 100%) | ✅ | ✅ |
| Settings — thresholds + refresh interval | ✅ | ✅ |

ChatGPT does not expose rate limit data via any API. Context window tracking works on both platforms.

---

## Install

### Chrome Web Store
git clone https://github.com/anu-ship-it/TokenPulse

### Manual (Developer Mode)
1. Clone or download this repo
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `src/` folder

Works on Chrome, Edge, Brave, and Opera.

---

## Project Structure

```
src/
├── manifest.json
├── background/
│   └── service-worker.js     # Alarms, API fetch, notifications
├── content/
│   ├── content.js            # In-page token bar (both platforms)
│   └── content.css           # Bar + popup styles
├── lib/
│   ├── constants.js          # All config, limits, colors, keys
│   ├── storage.js            # All chrome.storage ops
│   └── tokenizer.js          # Character-based token estimator
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js              # Main view + settings view
├── welcome/
│   └── welcome.html          # First install onboarding
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How token counting works

TokenPulse estimates tokens using the `chars ÷ 4` rule — OpenAI's documented approximation for English text. Accuracy is ±8%, which errs conservative (shows slightly more remaining than actual).

For Claude, real rate limit data (5-hour session and 7-day weekly utilization) is fetched directly from Claude's internal API using your existing browser session. No credentials are stored or transmitted anywhere.

---

## Notifications

Notifications fire when you cross a new threshold — not on a timer. Once you're notified at 75%, you won't be notified again until you cross 90%. If usage drops below all thresholds, the tracker resets so you'll be notified again next time.

Default thresholds: **75%, 90%, 100%** (50% available, off by default).

---

## Privacy

- All data stored locally via `chrome.storage.local`
- No external servers, no analytics, no tracking
- Claude rate limit data fetched from `claude.ai/api` using your existing session only
- Full privacy policy: [privacy.html](./privacy.html)

---

## Roadmap

### v2.0 — Current
- Dual-platform support (Claude + ChatGPT)
- Real Claude API rate limits
- Auto-saving daily usage history
- Smart threshold notifications
- Settings inside popup (no new tabs)
- TokenPulse branding

### v2.1 — Next
- Firefox support
- Response-ready notification (alert when model finishes generating)
- Weekly usage summary

### Future
- Chrome Web Store release
- Usage export (CSV)
- Keyboard shortcut to open popup

---

## Development

No build step. Pure vanilla JS, HTML, CSS.

```bash
git clone https://github.com/yourusername/tokenpulse
# Load src/ as unpacked extension in chrome://extensions/
```

To release:
```bash
git tag v2.0.0
git push --tags
# GitHub Actions auto-zips src/ and creates a release
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md)

---

## License

MIT — see LICENSE file

---

*TokenPulse is an independent project. Not affiliated with Anthropic or OpenAI.*
