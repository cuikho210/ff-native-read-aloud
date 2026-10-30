# OpenAI-compatible TTS driver — design

Date: 2026-10-31
Status: proposed

## Intent

Let the extension read selected text through any server that implements the
OpenAI audio-speech API (`POST {base}/audio/speech`), not just the built-in
native engine, the existing "simple server", and LobeTTS Edge. The motivating
server is a local Gradium instance at `http://localhost:8880/v1`, but the same
settings must work for OpenAI itself and other compatible servers.

The person using the extension configures server URL, credentials, model, and
voice once in the popup, then uses Shift+A exactly as today.

## Goals

- Add a new read-aloud driver, "OpenAI-compatible", selectable next to the
  existing three drivers.
- Speak a selection paragraph by paragraph, prefetching the next paragraph and
  playing returned audio in the browser with the existing
  `AudioBufferQueue`, so playback is continuous when server responses keep up.
- Configure base URL, optional API key, model, voice, and audio format from the
  popup; values persist across browser sessions.
- Discover models from `GET {base}/models` and voices from
  `GET {base}/audio/voices` when those endpoints exist. Both are optional:
  typed values always work without discovery.
- Map the existing playback-rate slider to the API's `speed` parameter and the
  volume slider to playback volume. Pitch is ignored.
- Work with the user's server at `http://localhost:8880/v1` out of the box.

## Non-goals

- Streaming/chunked playback inside one paragraph. Each paragraph is a complete
  request and response.
- Strict gapless playback across paragraphs (scheduled `AudioBufferSourceNode`
  starts). Prefetching is best-effort, matching the existing LobeTTS driver.
- OpenAI-specific extras (instructions, response metadata, multi-voice).
- Azure OpenAI's `api-key` header or deployment-style URLs. Bearer auth only.
- Saving multiple server profiles. One server configuration at a time.
- Changing the native, simple-server, or LobeTTS drivers.

## Anti-goals

- A settings workflow that requires editing the manifest per server.
- Silent failure: network/API errors must be visible in the console and, for
  discovery, in the popup status line.
- Making the popup unusable when the server is offline. All fields stay
  editable; discovery failures only produce a status message.

## Constraints

- Firefox Manifest V2 extension, built with Bun (`bun run build`).
- `readAloud()` runs in the content script. In Firefox MV2, content-script
  `fetch()` uses extension privileges, so a host permission is required for
  the configured server. The manifest currently grants localhost and
  `speech.platform.bing.com`.
- The popup is 300 px wide and already hosts three drivers' controls.
- `AudioBufferQueue` currently has no volume control.
- The user's server returns `audio/mpeg` for mp3, accepts omitted `model` and
  `voice`, and rejects unknown voices with HTTP 400 JSON. It exposes
  `GET /v1/models` and `GET /v1/audio/voices`; it has no OpenAPI document.
- Playwright MCP runs Chromium and cannot load a Firefox MV2 extension.

## Approaches considered

**A. New driver + one compact popup panel (chosen).** A dedicated
`openai_tts_read_aloud.ts` reads its own stores, calls the API, and feeds the
existing audio queue. The popup gains one section with text fields, discovery
buttons, and a test button. Smallest change that fully satisfies the request
and keeps protocol code separate.

**B. Provider profiles + options page.** Same driver, but configuration moves
to a Firefox options page with multiple saved servers. Better for people who
switch between many servers; adds a second UI surface, messaging, and more
state for a use case not asked for.

**C. Extend the simple-server driver.** Reuse its URL field and branch on an
"API mode" flag. Less new code, but the two drivers have opposite semantics:
simple-server sends text and lets the server play it; OpenAI-compatible returns
audio for the browser to play. One module would be harder to reason about.

A was chosen because it isolates the new protocol, reuses the proven playback
path, and keeps the change reviewable.

## Design

### Driver

New file `src/read_aloud/openai_tts_read_aloud.ts`.

Exports:

- `synthesize(text, options, signal): Promise<ArrayBuffer>` — pure request
  function, usable by tests.
- `readSequentially(texts: string[]): Promise<void>` — reads stored options,
  aborts the previous run, stops the queue, then fetches paragraphs in order
  and enqueues each decoded buffer.

`readSequentially` mirrors the LobeTTS driver: fetch paragraph N+1 while
paragraph N is playing; stop on abort. A per-call `AbortController` replaces
the previous one.

Request:

```
POST {base}/audio/speech
Content-Type: application/json
Authorization: Bearer {apiKey}      // only when apiKey is non-empty

{
  "model": "{model}",               // omitted when empty
  "input": "{paragraph}",
  "voice": "{voice}",               // omitted when empty
  "response_format": "{format}",    // mp3 | wav | opus
  "speed": 1.0                      // clamped to 0.25–4.0
}
```

`base` normalization: trim, strip trailing slashes, and append `/v1` when the
URL has an empty path or `/`. Users may paste either `http://host:8880` or
`http://host:8880/v1`. A base that already has a path is used as-is, so
`https://host/openai/v1` works.

Non-2xx responses: read the body, log status plus the server's message (JSON
`error.message` when present, otherwise raw text), and continue with the next
paragraph. Aborts are silent. `queue.enqueue()` rejections (decode failures)
are caught and logged rather than becoming unhandled rejections.

### Playback

`AudioBufferQueue` gains a `GainNode` between sources and the destination and a
`setVolume(value)` method. The OpenAI driver sets it from `volumeStore` before
playback. `enqueue()` resumes a suspended `AudioContext`, which also makes
click-driven playback reliable in Chromium tests. Other drivers keep their
current behavior (no explicit volume), so this is not a behavior change for
them.

Speed is sent to the server, not applied to `AudioBufferSourceNode`. A server
that ignores `speed` simply plays at its own rate. Pitch is not sent or applied.

### Storage

New `StorageItem`s in `src/store.ts`:

| Store key | Default |
| --- | --- |
| `openai-tts-base-url` | `http://localhost:8880/v1` |
| `openai-tts-api-key` | empty |
| `openai-tts-model` | empty |
| `openai-tts-voice` | empty |
| `openai-tts-format` | `mp3` |

The API key is stored in `browser.storage.local` in plain text, like the other
settings. The UI masks it with a password input. This is acceptable for a
personal extension; it is not a secret manager.

`ReadAloudDriver` gains `OpenAiTts = "openai-tts"`, and `read_aloud/index.ts`
dispatches to it.

### Popup UI

One new container in `public/controller.html`, placed above the simple-server
section:

- **Base URL** — `type="url"`, placeholder `http://localhost:8880/v1`.
- **API key** — `type="password"`, placeholder "optional".
- **Model** — text input with a `<datalist>` filled by discovery.
- **Voice** — text input with a `<datalist>` filled by discovery.
- **Format** — select: mp3 (default), wav, opus.
- **Refresh** button — fetches models and voices.
- **Test voice** button — saves the current fields and calls
  `previewReadAloud()` with the OpenAI driver selected.
- **Status line** — small text showing discovery results or errors.

Text inputs write to their stores on `input`; the select writes on `change`.
Nothing previews on typing.

Refresh behavior:

1. Read the current base URL (not yet saved values from other fields do not
   matter).
2. `GET {base}/models`; accept `{ data: [{ id }] }`; fill model datalist.
3. `GET {base}/audio/voices`; accept `{ voices: string[] }` or `string[]`;
   fill voice datalist. A 404 is reported as "voice list unavailable" but is
   not fatal.
4. If the model field is empty, fill it with the first discovered model. If the
   voice field is empty, fill it with the first discovered voice.
5. Show "N models, M voices" or the failure reason. Never clear typed values.

Both discovery calls use a short timeout (5 s) so a dead server cannot leave
the popup spinner hanging. Refresh and Test require no extension page reload.

The driver `<select>` gains `<option value="openai-tts">OpenAI-compatible</option>`.

### Permissions and manifest

Add `"*://*/*"` to `permissions` so any configured HTTP(S) server can be
reached from the content script. The extension already injects a content
script into `<all_urls>`, so this does not add a new permission category to the
install prompt. Keep the existing localhost and Bing entries.

Bump the manifest version to 1.8.

### Documentation

README gains a short "OpenAI-compatible TTS" section: choose the driver, set
base URL/key/model/voice, Refresh to discover, Test to preview, then Shift+A.
Mention that the API key is optional and stored locally.

## Testing

Because Playwright MCP is Chromium-only and this is Firefox MV2, test the real
driver and popup code as local pages, then do one manual Firefox smoke test.

Dev-only harness under `test/` (not part of `dist/`):

- `test/server.ts` — Bun server on port 8890. Serves the harness and popup
  pages, and reverse-proxies `/v1/*` to `http://localhost:8880/v1/*` so the
  Chromium page is same-origin with the TTS API.
- `test/harness.ts` + `harness.html` — imports the real `synthesize()` and
  `AudioBufferQueue`; buttons for one-shot speech and multi-paragraph speech;
  logs request result, decoded duration, and errors to the page and console.
- `test/build.ts` — builds the harness, copies the built popup, and injects a
  small `browser.storage.local` shim (backed by `localStorage`) before
  `controller.js`.
- `test/browser-shim.js` — the storage shim.

Playwright MCP checks, against `:8880` through the proxy:

1. Harness: one sentence → HTTP 200, audio decodes, duration > 0, playback
   starts.
2. Harness: three paragraphs → three buffers queue and play in order.
3. Harness: bad voice → 400 handled with a visible error, no crash.
4. Real popup page: OpenAI section renders, Refresh fills model/voice
   datalists, Test voice plays a sample, invalid URL shows an error status.
5. Full build passes (`bun run build`) and `dist/manifest.json` contains the
   new driver option and permission.

Manual Firefox check (user or agent with Firefox): load `dist/` temporarily via
`about:debugging`, select OpenAI-compatible, Refresh, Test, select text on a
page, press Shift+A, confirm speech.

## What is left to the builder

- Exact HTML/CSS structure and wording of the status line.
- Whether the datalists auto-refresh when the popup opens (manual Refresh is
  the requirement).
- Test harness file layout and whether `test/` scripts are exposed as package
  scripts.
- Factoring shared "load options / abort / queue" code with the LobeTTS driver
  if it can be done without changing LobeTTS behavior.
