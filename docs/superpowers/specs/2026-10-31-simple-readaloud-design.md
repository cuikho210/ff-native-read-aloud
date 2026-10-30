# simple-readaloud — Chromium streaming TTS design

Date: 2026-10-31
Status: proposed
Supersedes: the removed Firefox/OpenAI-only design

## Intent

Turn the existing Firefox read-aloud extension into **simple-readaloud**, a
Chromium extension with two drivers: the browser's native speech synthesis and
any server implementing the OpenAI audio-speech API. The OpenAI driver must
stream audio: playback starts while the response body is still arriving, and
paragraphs join into one continuous stream.

The motivating server is a local Gradium instance at
`http://localhost:8880/v1`, but the settings work for OpenAI and other
compatible servers.

## Goals

- Rename the extension to `simple-readaloud`; publish as a Chromium MV3
  extension.
- Keep the Shift+A read-selection workflow.
- Keep native speech as the default driver and add an OpenAI-compatible driver
  configured from the popup.
- Stream OpenAI audio through an offscreen document using MediaSource
  Extensions (MSE); start playback before the response completes.
- Join multiple paragraph responses into one continuous MediaSource stream.
- Map the playback-rate slider to the API's `speed` and the volume slider to
  playback volume. Native speech also keeps pitch.
- Discover models from `GET {base}/models` and voices from
  `GET {base}/audio/voices` when available; typed values always work.
- Rewrite the popup with Preact, Tailwind 4, and daisyUI.

## Non-goals

- Firefox support, `browser.*` APIs, or MV2.
- Simple-server and LobeTTS Edge drivers. Both are removed, along with
  `webext-storage` and `@lobehub/tts`.
- Non-MP3 streaming. The OpenAI request always uses
  `response_format: "mp3"`, the only format Chromium can stream through MSE
  here and the format the target server, OpenAI, and common compatible
  servers all support.
- Multiple server profiles.
- Azure OpenAI's `api-key` header or deployment-style URLs.
- Streaming text into a TTS model. Each paragraph is sent as a complete
  request; only the audio response is streamed.
- OpenAI extras such as instructions or response metadata.

## Anti-goals

- Buffering the whole response before playing (that defeats the streaming
  requirement).
- Making the extension depend on per-site CORS behaviour. It must work on
  sites with restrictive CSP/CORS.
- Silent failure: API and playback errors are visible in the popup status
  and the console.
- A popup that breaks when the server is offline. Fields stay editable;
  discovery failures only show status.

## Constraints

- Chromium MV3. Content scripts are subject to page CORS, so they cannot call
  arbitrary TTS servers directly.
- Service workers cannot use `AudioContext`, `MediaSource`, or play audio.
- Offscreen documents can do both and are the MV3-sanctioned place for audio
  playback. They have DOM APIs and `chrome.runtime` only: **no
  `chrome.storage`, `chrome.tabs`, or `chrome.offscreen`**.
- Verified in Chromium 148: `MediaSource.isTypeSupported("audio/mpeg")` is
  true; appending two separate MP3 responses to one `audio/mpeg` SourceBuffer
  produces one continuous 6.6 s stream. Ogg Opus and WAV are not MSE-supported
  there.
- The target server returns chunked `audio/mpeg`, accepts omitted `model` and
  `voice`, and rejects unknown voices with HTTP 400 JSON. It exposes
  `/v1/models` and `/v1/audio/voices`; it has no CORS headers and no OpenAPI
  document.
- Chrome offscreen API needs the `offscreen` permission and Chrome 116+.

## Architecture

Only one architecture meets CORS isolation + streaming:

**Chosen — offscreen document with MSE.** The content script sends text to the
service worker. The service worker creates (or reuses) an offscreen document
and forwards the request. The offscreen document fetches the TTS endpoint with
extension host permissions, streams the MP3 body into a MediaSource
`SourceBuffer`, and plays it through an `<audio>` element.

**Rejected — content-script fetch + MSE.** Simplest message flow, but Chrome
MV3 content scripts obey the page's CORS policy. The target server sends no
`Access-Control-Allow-Origin`, so this fails on the motivating server and on
many others.

**Rejected — service-worker fetch relayed to a content script.** Works around
CORS, but requires streaming `ArrayBuffer` chunks through ports, keeps the
service worker alive across long requests, and puts playback in a page context
where page CSP can interfere. More moving parts without a benefit.

## Design

### Component map

| Context | File | Responsibility |
| --- | --- | --- |
| Content script | `src/content_script.ts` | Shift+A listener, selection/paragraph split, native driver, stop-native message |
| Service worker | `src/background.ts` | Message routing, offscreen lifecycle, stop |
| Offscreen document | `src/offscreen.ts`, `public/offscreen.html` | Streaming fetch, MSE playback, state reports to the service worker |
| Popup | `src/controller.tsx` + `src/ui/*` | Preact settings UI, discovery, test, stop |
| Shared | `src/settings.ts` | Typed `chrome.storage.local` helpers (not used by offscreen) |
| Shared | `src/openai_tts.ts` | URL normalization, request body, model/voice discovery |
| Shared | `src/streaming/mse_player.ts` | Framework-free MSE streaming player |

### Settings

`chrome.storage.local`, one key per setting:

| Key | Default |
| --- | --- |
| `driver` | `native` |
| `volume` | `1` |
| `playback-rate` | `1` |
| `pitch` | `1` |
| `native-voice-uri` | empty |
| `openai-base-url` | `http://localhost:8880/v1` |
| `openai-api-key` | empty |
| `openai-model` | empty |
| `openai-voice` | empty |

The API key is stored in plain text in `chrome.storage.local` and masked by a
password input. This is a personal extension, not a secret manager.

Playback state is stored in `chrome.storage.session` under `playback-state`:
`{ status: "idle" | "loading" | "playing" | "error", message?, receivedBytes,
updatedAt, driver, tabId? }`. **The service worker writes it**, because offscreen
documents cannot use `chrome.storage`. The popup reads it on mount and
subscribes to `chrome.storage.onChanged`, so reopening the popup shows the
current state. Content scripts cannot read `storage.session` by default, which
is fine. The service worker also stores `active-native-tab` in
`chrome.storage.session` so playback ownership survives service-worker
suspension.

### OpenAI request

Base URL normalization: trim, strip trailing slashes, append `/v1` when the URL
path is empty or `/`. Users may paste `http://host:8880` or
`http://host:8880/v1`. A URL with an existing path is used as-is.

```
POST {base}/audio/speech
Content-Type: application/json
Authorization: Bearer {apiKey}      // only when non-empty

{
  "model": "{model}",               // omitted when empty
  "input": "{paragraph}",
  "voice": "{voice}",               // omitted when empty
  "response_format": "mp3",
  "speed": 1.0                      // playback rate clamped to 0.25–4.0
}
```

Non-2xx responses read the body and surface `error.message` when the JSON has
that shape, otherwise the raw text. A failed request stops the current stream
and sets the error state; it does not silently skip to the next paragraph.

### Streaming player

`src/streaming/mse_player.ts` owns a single `<audio>` element and one
MediaSource per playback session:

1. Set `audio.volume`; create `MediaSource`, set `audio.src` to its object URL.
2. Wait for `sourceopen`; add a `SourceBuffer` with `audio/mpeg`.
3. Start `audio.play()` (also retried after the first append if the initial
   promise rejects).
4. For each text: fetch, read `response.body` chunk by chunk, and append each
   chunk to the SourceBuffer, awaiting `updateend` for backpressure.
5. After the last paragraph, call `mediaSource.endOfStream()` and wait for
   `ended`.

All paragraphs append to the same SourceBuffer, so MSE timestamps continue
seamlessly. Aborting aborts the fetch, pauses and detaches the audio element,
revokes the object URL, and invalidates the session generation so late chunks
and events are ignored.

The player reports state transitions via a callback:
`loading` → `playing` (after first append) → `idle` (ended), or `error`.

Known limitation: the SourceBuffer grows for the whole selection. Chrome
handles typical selections; evicting already-played ranges is left out.

### Native driver

`src/native_tts.ts` runs in the content script. It reads `native-voice-uri`,
volume, rate, and pitch; calls `speechSynthesis.cancel()` before a new reading;
speaks paragraphs sequentially, resolving on `onend` and logging `onerror`.
Voice matching is by `voiceURI`, not array index, because indexes are not
stable across Chrome restarts. If the saved voice is missing, the default voice
is used.

### Content script

- One keydown listener per frame on its own `window`. With `all_frames: true`,
  each frame handles its own selection; the old parent-driven iframe scanning
  and MutationObserver are removed.
- Trigger: Shift+A without Ctrl/Meta/Alt. Split selected text on blank lines,
  trim, drop empties.
- Read the `driver` setting.
  - `native`: send `native:start` to the service worker, wait for its `ok`
    (which stops any other playback), then call the native driver. Report
    `native:state` playing/idle/error transitions.
  - `openai`: send `tts:start` with the paragraphs to the service worker.
- Listen for `stop-native` and call `speechSynthesis.cancel()`.
- On `pagehide`, cancel native speech so a closed page does not leave a stale
  playing state.

### Service worker

The service worker is the single owner of playback orchestration. Only one
playback runs at a time across drivers and tabs.

Handles messages targeted at `background`:

- `native:start` (from a content script; `sender.tab.id` identifies the tab) →
  stop the offscreen stream if present, stop the previous `active-native-tab`
  if it differs, persist the new `active-native-tab`, set `playback-state` to
  loading/native, and answer `{ ok: true }`.
- `native:state` → persist the reported playing/idle/error state; clear
  `active-native-tab` when playback ends.
- `tts:start` (page or popup preview) → stop the tracked native tab, clear
  `active-native-tab`, ensure the offscreen document, **load the OpenAI
  settings here**, and forward
  `{ target: "offscreen", type: "tts:start", texts, config }`. Set state to
  loading/openai. Startup failures become an error state.
- `tts:stop` (content script or popup) → forward stop to the offscreen
  document if it exists, send `stop-native` to `active-native-tab`, clear it,
  and set state idle.
- `playback:state` (from offscreen) → persist state and received bytes.

All state persists to `chrome.storage.session`; the service worker may be
suspended between messages and rehydrates from those keys.

`ensureOffscreen()` uses `chrome.offscreen.hasDocument()` and a module-level
promise to avoid concurrent `createDocument` calls. It creates
`offscreen.html` with reason `AUDIO_PLAYBACK` and a human-readable
justification. After creation, it pings the offscreen document until its
message listener answers, so a start message is not lost in the load race.

The offscreen document stays alive between plays. Closing it when idle is left
to the builder; correctness must not depend on it.

### Offscreen document

Offscreen documents only have `chrome.runtime`; this document never touches
storage. It listens for `{ target: "offscreen" }` messages. On `tts:start`:

1. Stop and invalidate any current session.
2. Use the `config` supplied in the message.
3. Run the streaming player over the paragraphs.
4. Send `{ target: "background", type: "playback:state", ... }` for loading,
   playing, idle, and error transitions.

On `tts:stop`, stop the player and report idle.

### Popup UI

Preact app mounted into `#app`; Tailwind 4 + daisyUI for styling. Width 360 px,
scrollable, light/dark via daisyUI themes. No inline scripts (MV3 CSP).

Layout:

- Header: title, playback status badge (`idle` / `loading` / `playing` /
  `error`).
- Driver control: Native / OpenAI-compatible.
- Native panel: voice `<select>` grouped by language, pitch slider.
- OpenAI panel: Base URL, API key (password), Model and Voice inputs with
  datalists, Refresh button, Test voice button, discovery status line.
- Shared: volume and playback-rate sliders.
- Footer: Stop button.

Behaviour:

- Settings load before the form renders to avoid flicker; each change writes
  immediately to `chrome.storage.local`.
- Native voices come from `speechSynthesis.getVoices()` plus the
  `voiceschanged` event.
- Refresh calls the discovery helpers with the current URL/key, a 5 s timeout,
  and fills empty model/voice fields with the first result. It never clears
  typed values. Models accept `{ data: [{ id }] }`; voices accept
  `{ voices: string[] }` or `string[]`. A missing voices endpoint is a
  non-fatal status message.
- Test voice saves the fields, then sends a one-sentence preview to the
  service worker, which stops any native playback and streams it through the
  offscreen document.
- Stop sends `tts:stop` to the service worker, which stops both the offscreen
  stream and the tracked native tab and sets the state to idle.
- The status badge is driven by `playback-state` in session storage, so it is
  correct when the popup is reopened mid-playback.

### Manifest and permissions

`public/manifest.json`, manifest version 3:

```json
{
  "manifest_version": 3,
  "name": "simple-readaloud",
  "version": "2.0.0",
  "minimum_chrome_version": "116",
  "description": "Read selected text aloud with native speech or any OpenAI-compatible TTS server.",
  "permissions": ["storage", "offscreen"],
  "host_permissions": ["*://*/*"],
  "background": { "service_worker": "background.js" },
  "action": {
    "default_popup": "controller.html",
    "default_icon": "icon-32.png",
    "default_title": "Read-aloud controls"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content_script.js"],
    "all_frames": true
  }]
}
```

`host_permissions` lets the offscreen document and popup fetch any TTS server
and lets the popup message content scripts in the active tab. The extension
already injects into all sites, so this adds no new Chrome warning category.

### Build and dependencies

- Replace `@types/firefox-webext-browser` with `@types/chrome`.
- Remove `@lobehub/tts` and `webext-storage`.
- Add `preact`, `tailwindcss` 4, `@tailwindcss/cli`, `daisyui` 5.
- `tsconfig.json`: `"jsx": "react-jsx"`, `"jsxImportSource": "preact"`.
- `build.ts` cleans `dist`, copies `public`, then Bun-builds four IIFE
  entrypoints: `controller.tsx`, `content_script.ts`, `background.ts`,
  `offscreen.ts`. IIFE output keeps content scripts classic and the service
  worker module-free.
- After the JS build, run the Tailwind CLI to produce `dist/controller.css`
  from `src/styles.css` (`@import "tailwindcss"; @plugin "daisyui"`), with
  explicit `@source` paths for `src/**/*.{ts,tsx}` and `public/*.html`.
- `public/controller.html` becomes a minimal page with `#app`, the CSS link,
  and `controller.js`. `public/offscreen.html` loads `offscreen.js`.
- Delete `public/controller.css`, the old driver files, the audio buffer queue,
  and the old store/types.

### Rename and docs

- Manifest/package/README names become `simple-readaloud`.
- README covers Bun, `bun install`, `bun run build`, loading `dist` via
  `chrome://extensions`, the two drivers, OpenAI server fields, Refresh/Test,
  and Shift+A.
- The repository directory name is out of scope; only extension/package
  identity is renamed.

## Testing

Real server: `http://localhost:8880/v1` (Gradium, MP3, 39 voices).

### Playwright MCP

- A dev-only `test/` harness on port 8890 reverse-proxies `/v1/*` to `:8880`
  and serves a page that imports the real `mse_player.ts`. Playwright MCP
  verifies: one paragraph streams and starts before completion; three
  paragraphs play as one continuous stream; bad voice surfaces an error;
  Stop aborts.
- The built popup is also exercised as a page with a `chrome.storage` shim
  through MCP: driver switch, discovery fills datalists, Test triggers
  playback, invalid URL shows an error.
- If Chromium's CDP `Extensions.loadUnpacked` works in the MCP browser, use it
  to load `dist` and test the actual popup; otherwise use the Playwright
  launch-persistent-context path below.

### Real extension

Playwright launches Chromium with
`--disable-extensions-except=dist --load-extension=dist` and a temporary
profile. It obtains the extension id from the service-worker URL and verifies:

1. Popup opens; settings persist across reopen.
2. Refresh discovers `gradium/phonon-31m-en` and the voice list from `:8880`.
3. Test voice sets `playback-state` to `loading` then `playing`, with
   `receivedBytes > 0`, proving the extension bypassed CORS and streamed.
4. On a test page, selecting text and pressing Shift+A does the same through
   the content script.
5. Stop returns the state to idle and aborts the request.
6. Bad URL/voice produces an error state.
7. Native driver speaks without involving the offscreen document (smoke test;
   headless Chrome may have no voices).

A quick `bun run build` and a `dist/manifest.json` check are part of every
verification pass.

## What is left to the builder

- Exact component breakdown, daisyUI theme, and wording.
- Whether to close an idle offscreen document after a timeout.
- Discovery auto-fill details and datalist presentation.
- Whether to add unit tests for URL normalization and request bodies.
- Test harness layout and package scripts.
- Whether MCP can load the unpacked extension; fall back to the Playwright
  script if not.
