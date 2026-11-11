# Neon Pulse — YouTube Playable

A fast-paced arcade endless runner built with **TypeScript + Vite + HTML5 Canvas** and integrated with the **YouTube Playables SDK (`game_api/v1`)**.

## Quick Start

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Build production bundle for YouTube Playables Test Suite (outputs to ./dist)
npm run build
```

## Controls

| Action | Desktop | Mobile / Touch |
| :--- | :--- | :--- |
| **Jump / Double-Jump** | `Space`, `W`, `Up Arrow`, or Left Click | Tap screen |
| **Slide / Fast-Fall** | `S`, `Down Arrow`, or Right Click | Swipe down |

## YouTube Playables SDK Compliance

- **SDK Script Order**: `<script src="https://www.youtube.com/game_api/v1"></script>` is loaded first in `<head>` of [`index.html`](file:///c:/Users/jorda/Projects/youtube-playables/index.html).
- **Relative Paths**: Configured via `base: './'` in [`vite.config.ts`](file:///c:/Users/jorda/Projects/youtube-playables/vite.config.ts) so all assets resolve inside YouTube's hosted container.
- **Lifecycle Signals**:
  - `ytgame.game.firstFrameReady()` is invoked immediately after the initial canvas frame renders.
  - `ytgame.game.gameReady()` is invoked once cloud save data loads and the game is interactive.
- **System Pause & Audio**:
  - `ytgame.system.onPause` and `ytgame.system.onResume` stop/restart the `requestAnimationFrame` loop and suspend/resume the Web Audio synth context.
  - `ytgame.system.isAudioEnabled()` and `ytgame.system.onAudioEnabledChange` mute/unmute all procedural audio.
- **Engagement & Cloud Save**:
  - High scores are submitted via `ytgame.engagement.sendScore({ value })`.
  - High scores and collected shards persist via `ytgame.game.saveData()` / `ytgame.game.loadData()` with automatic `localStorage` fallback during local browser development.

## Official Documentation References

### Getting Started

- https://developers.google.com/youtube/gaming/playables
- https://developers.google.com/youtube/gaming/playables/reference/getting_started
- https://developers.google.com/youtube/gaming/playables/reference/sdk

### Testing the game

- https://developers.google.com/youtube/gaming/playables/test_suite
- https://developers.google.com/youtube/gaming/playables/reference/test_suite_guide

### Other resources

- https://developers.google.com/youtube/gaming/playables/reference/monetization
- https://developers.google.com/youtube/gaming/playables/samples/oss_samples