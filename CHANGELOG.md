# Changelog

All notable changes to Token Tracker will be documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/)

---

## [Unreleased]
- Nothing pending yet

---

## [1.0.0] - 2026-05-30
### Added
- Live token counter bar injected above input box on ChatGPT and Claude
- Progress bar with color states: green → yellow (70%) → red pulsing (90%)
- Context window exhaustion popup at 100% usage, auto-dismisses after 12s
- Session reset detection via URL change (new conversation resets counter)
- Toolbar popup showing used / remaining / limit with platform and model name
- Lightweight character-based token estimator (÷4 chars/token, no WASM)
- Dark mode support via `prefers-color-scheme` and ChatGPT/Claude dark class detection
- Support for ChatGPT models: GPT-4o (128k), GPT-3.5 (16k), o1/o3 (200k)
- Support for Claude models: all current models (200k context)