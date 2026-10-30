# simple-readaloud Chromium Streaming TTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the extension as `simple-readaloud`, a Chromium MV3 read-aloud extension with native speech and streamed OpenAI-compatible TTS.

**Architecture:** The content script handles Shift+A and native speech. A service worker owns playback orchestration, settings access, and state persistence. An offscreen document fetches the OpenAI-compatible endpoint and streams MP3 chunks into one MediaSource-backed `<audio>` element. The popup is a Preact app styled with Tailwind 4 and daisyUI.

**Tech Stack:** TypeScript, Bun, Preact, Tailwind 4, daisyUI 5, Chrome MV3 APIs, MediaSource Extensions, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-simple-readaloud-design.md`

## Global Constraints

- Manifest V3; `name` is `simple-readaloud`; `version` is `2.0.0`; `minimum_chrome_version` is `116`.
- Only two drivers exist: `native` and `openai`. Delete the simple-server and LobeTTS drivers and their dependencies.
- OpenAI requests always use `response_format: "mp3"`; `speed` is clamped to `0.25`–`4.0`.
- The offscreen document may use DOM APIs and `chrome.runtime` only. It must not use `chrome.storage`, `chrome.tabs`, or `chrome.offscreen`.
- The service worker owns `chrome.storage` settings, `playback-state`, and `active-native-tab`.
- Only one playback runs at a time across drivers and tabs.
- Build output is IIFE; content scripts are classic scripts and there are no inline scripts.
- Default OpenAI base URL is `http://localhost:8880/v1`; bare origins get `/v1` appended.
- `host_permissions` is `*://*/*`; `permissions` is `["storage", "offscreen"]`.
- The API key is optional, sent as `Authorization: Bearer`, and stored plaintext in `chrome.storage.local`.
- Popup stack is Preact + Tailwind 4 + daisyUI; no React.
- Shift+A reads the selection; paragraphs are separated by blank lines.
- Playback state lives in `chrome.storage.session` under `playback-state`; the active native tab lives under `active-native-tab`.

## Review Focus

- A long selection arrives as multiple paragraph responses over one continuous MediaSource stream; the second paragraph must play without a gap or restart. Pinned in Task 3's multi-paragraph Player E2E.
- Stop or a new start while a fetch or SourceBuffer append is in flight must leave no stale audio and must settle to idle/playing. Pinned in Task 3's stop test and Task 7's double-start test.
- Invalid base URLs, empty bodies, and non-2xx responses must produce a readable error state, never silence. Pinned in Task 2's URL/body tests and Task 7's bad-voice test.
- Two starts racing before the offscreen document exists must not throw "Only a single offscreen document may be created". Pinned in Task 5's ensure lock and Task 7's double-start test.
- Switching between native and OpenAI must stop the previous playback, and a closed native tab must not wedge Stop. Pinned in Task 7's driver-handoff and closed-tab tests.

---

### Task 1: MV3 scaffold, identity, and build

**Files:**
- Modify: `package.json`, `tsconfig.json`, `build.ts`, `public/manifest.json`, `public/controller.html`
- Create: `public/offscreen.html`, `src/styles.css`, `test/manifest.test.ts`
- Create stubs: `src/background.ts`, `src/content_script.ts`, `src/offscreen.ts`, `src/controller.tsx`
- Delete: `src/read_aloud/` (all files), `src/audio_buffer_queue.ts`, `src/store.ts`, `src/types.d.ts`, `src/utils.ts`, `public/controller.css`

**Interfaces:**
- Consumes: nothing.
- Produces: a build that emits `dist/background.js`, `dist/content_script.js`, `dist/offscreen.js`, `dist/controller.js`, and `dist/controller.css`; the manifest every later task edits.

- [ ] **Step 1: Write the failing manifest/build test**

```ts
// test/manifest.test.ts
import { expect, test } from "bun:test";

test("builds a Chromium MV3 extension", async () => {
  const manifest = await Bun.file("dist/manifest.json").json();
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe("simple-readaloud");
  expect(manifest.version).toBe("2.0.0");
  expect(manifest.minimum_chrome_version).toBe("116");
  expect(manifest.permissions).toEqual(["storage", "offscreen"]);
  expect(manifest.host_permissions).toEqual(["*://*/*"]);
  expect(manifest.background.service_worker).toBe("background.js");
  expect(manifest.action.default_popup).toBe("controller.html");
  expect(manifest.browser_action).toBeUndefined();

  for (const file of [
    "background.js",
    "content_script.js",
    "offscreen.js",
    "controller.js",
    "controller.css",
  ]) {
    expect(await Bun.file(`dist/${file}`).exists()).toBe(true);
  }
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `bun test test/manifest.test.ts`
Expected: FAIL, because `dist/manifest.json` is the old MV2 manifest or does not exist.

- [ ] **Step 3: Replace dependencies and scripts**

Run:

```bash
bun remove @lobehub/tts webext-storage
bun remove -d @types/firefox-webext-browser
bun add preact
bun add -d @types/chrome tailwindcss @tailwindcss/cli daisyui playwright
bunx playwright install chromium
```

Update the `scripts` block in `package.json` to:

```json
{
  "build": "bun run build.ts",
  "test": "bun test",
  "test:serve": "bun run test/server.ts",
  "test:player": "bun run test/player.e2e.ts",
  "test:e2e": "bun run test/e2e.ts"
}
```

Remove the stale `"module": "src/index.ts"` field. Keep `"type": "module"`.

- [ ] **Step 4: Configure TSX for Preact**

In `tsconfig.json`, set:

```json
"jsx": "react-jsx",
"jsxImportSource": "preact",
"lib": ["ESNext", "DOM", "DOM.Iterable"]
```

Leave the other compiler options unchanged. Remove the Firefox types dependency; `@types/chrome` supplies the global `chrome` namespace.

- [ ] **Step 5: Replace the manifest**

```json
{
  "manifest_version": 3,
  "name": "simple-readaloud",
  "version": "2.0.0",
  "minimum_chrome_version": "116",
  "description": "Read selected text aloud with native speech or any OpenAI-compatible TTS server.",
  "icons": { "48": "icon-48.png" },
  "permissions": ["storage", "offscreen"],
  "host_permissions": ["*://*/*"],
  "background": { "service_worker": "background.js" },
  "action": {
    "default_icon": "icon-32.png",
    "default_title": "Read-aloud controls",
    "default_popup": "controller.html"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content_script.js"],
      "all_frames": true
    }
  ]
}
```

- [ ] **Step 6: Replace the HTML entry points**

`public/controller.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="controller.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="controller.js"></script>
  </body>
</html>
```

`public/offscreen.html`:

```html
<!doctype html>
<html>
  <body>
    <audio id="player"></audio>
    <script src="offscreen.js"></script>
  </body>
</html>
```

- [ ] **Step 7: Replace `build.ts`**

Use `Bun.build` with `target: "browser"`, `format: "iife"`, and the four entry points `src/controller.tsx`, `src/content_script.ts`, `src/background.ts`, `src/offscreen.ts`. Throw if `build.success` is false. After the JS build, run the Tailwind CLI:

```ts
await Bun.$`bunx @tailwindcss/cli -i ${resolve(srcDir, "styles.css")} -o ${resolve(distDir, "controller.css")} --minify`;
```

Keep the existing clean-`dist` and copy-`public` steps. Log the output directory.

- [ ] **Step 8: Create `src/styles.css`**

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: light --default, dark --prefersdark;
}
@source "./**/*.{ts,tsx}";
@source "../public/*.html";
```

- [ ] **Step 9: Delete the old drivers and create compiling stubs**

Delete the files listed under **Files**. Create:

```ts
// src/background.ts
console.log("simple-readaloud background ready");
```

```ts
// src/content_script.ts
console.log("simple-readaloud content script ready");
```

```ts
// src/offscreen.ts
console.log("simple-readaloud offscreen ready");
```

```tsx
// src/controller.tsx
document.querySelector("#app")!.textContent = "simple-readaloud";
```

- [ ] **Step 10: Build and run the test**

Run: `bun run build && bun test test/manifest.test.ts`
Expected: build succeeds; the manifest test passes; `dist/` contains the five required files.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "build: scaffold simple-readaloud Chromium MV3 extension"
```

---

### Task 2: Shared types, settings, and OpenAI request logic

**Files:**
- Create: `src/types.ts`, `src/settings.ts`, `src/openai_tts.ts`, `test/openai_tts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the Chrome type globals.
- Produces:
  - `Driver = "native" | "openai"`
  - `OpenAiConfig { baseUrl, apiKey, model, voice, speed, volume }`
  - `PlayerState { status, message?, receivedBytes? }`
  - `PlaybackState { status, driver?, message?, receivedBytes?, updatedAt, tabId? }`
  - `Setting<T>` with `get(): Promise<T>` and `set(value: T): Promise<void>`
  - `driverSetting`, `volumeSetting`, `playbackRateSetting`, `pitchSetting`, `nativeVoiceUriSetting`, `openAiBaseUrlSetting`, `openAiApiKeySetting`, `openAiModelSetting`, `openAiVoiceSetting`, `playbackStateSetting`, `activeNativeTabSetting`
  - `loadOpenAiConfig()`, `loadNativeSettings()`, `loadAppSettings()`, `saveAppSetting()`
  - `normalizeBaseUrl`, `speechUrl`, `buildSpeechBody`, `buildAuthHeaders`, `parseModelIds`, `parseVoiceNames`, `discoverModels`, `discoverVoices`, `responseErrorMessage`

- [ ] **Step 1: Write the failing tests**

```ts
// test/openai_tts.test.ts
import { expect, test } from "bun:test";
import {
  buildAuthHeaders,
  buildSpeechBody,
  normalizeBaseUrl,
  parseModelIds,
  parseVoiceNames,
  speechUrl,
} from "../src/openai_tts";

test("normalizes a bare origin to /v1", () => {
  expect(normalizeBaseUrl("http://localhost:8880")).toBe("http://localhost:8880/v1");
  expect(normalizeBaseUrl("http://localhost:8880/")).toBe("http://localhost:8880/v1");
});

test("keeps an existing path and strips trailing slashes", () => {
  expect(normalizeBaseUrl("https://host/openai/v1/")).toBe("https://host/openai/v1");
  expect(normalizeBaseUrl("  http://localhost:8880/v1  ")).toBe("http://localhost:8880/v1");
});

test("rejects a blank or invalid base URL", () => {
  expect(() => normalizeBaseUrl("   ")).toThrow();
  expect(() => normalizeBaseUrl("not a url")).toThrow();
});

test("builds the speech endpoint", () => {
  expect(speechUrl("http://localhost:8880")).toBe("http://localhost:8880/v1/audio/speech");
});

test("builds a complete MP3 request with clamped speed", () => {
  expect(
    buildSpeechBody("Hello", { model: "m", voice: "v", speed: 0.1 }),
  ).toEqual({
    model: "m",
    input: "Hello",
    voice: "v",
    response_format: "mp3",
    speed: 0.25,
  });
});

test("omits empty model and voice and clamps high speed", () => {
  expect(
    buildSpeechBody("Hello", { model: "", voice: "", speed: 9 }),
  ).toEqual({ input: "Hello", response_format: "mp3", speed: 4 });
});

test("adds an Authorization header only for a non-empty key", () => {
  expect(buildAuthHeaders("")).toEqual({});
  expect(buildAuthHeaders("secret")).toEqual({ Authorization: "Bearer secret" });
});

test("parses model ids and voice names", () => {
  expect(parseModelIds({ data: [{ id: "a" }, { id: "b" }, { nope: 1 }] })).toEqual(["a", "b"]);
  expect(parseVoiceNames({ voices: ["a", "b", "a"] })).toEqual(["a", "b"]);
  expect(parseVoiceNames(["a", "b"])).toEqual(["a", "b"]);
  expect(parseVoiceNames({ nope: true })).toEqual([]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `bun test test/openai_tts.test.ts`
Expected: FAIL, because `src/openai_tts.ts` does not exist.

- [ ] **Step 3: Implement `src/types.ts`**

Define the four types above. `PlayerState["status"]` and `PlaybackState["status"]` both use `"idle" | "loading" | "playing" | "error"`. `PlaybackState["driver"]` is `Driver`. `NativeVoiceSettings` is `{ voiceUri: string; volume: number; rate: number; pitch: number }`.

- [ ] **Step 4: Implement `src/settings.ts`**

Implement `Setting<T>` using `chrome.storage.local` by default and `chrome.storage.session` for the two session settings. `get()` returns the stored value or the constructor default. `set()` writes `{ [key]: value }`.

Define the settings with these exact keys and defaults:

```ts
driver              "driver"              "native"
volume              "volume"              1
playbackRate        "playback-rate"       1
pitch               "pitch"               1
nativeVoiceUri      "native-voice-uri"    ""
openAiBaseUrl       "openai-base-url"     "http://localhost:8880/v1"
openAiApiKey        "openai-api-key"      ""
openAiModel         "openai-model"        ""
openAiVoice         "openai-voice"        ""
playbackState       "playback-state"      { status: "idle", updatedAt: 0 }   // session
activeNativeTab     "active-native-tab"   null                               // session
```

`loadOpenAiConfig()` returns `{ baseUrl, apiKey, model, voice, speed: clamp(playbackRate, 0.25, 4), volume }`. `loadNativeSettings()` returns `{ voiceUri, volume, rate: playbackRate, pitch }`. `loadAppSettings()` returns camelCase keys for all local settings. `saveAppSetting(key, value)` dispatches to the matching setting.

- [ ] **Step 5: Implement `src/openai_tts.ts`**

Implement:

```ts
export function normalizeBaseUrl(raw: string): string
export function speechUrl(baseUrl: string): string
export function buildSpeechBody(input: string, config: Pick<OpenAiConfig, "model" | "voice" | "speed">): Record<string, unknown>
export function buildAuthHeaders(apiKey: string): Record<string, string>
export function parseModelIds(value: unknown): string[]
export function parseVoiceNames(value: unknown): string[]
export async function discoverModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]>
export async function discoverVoices(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]>
export async function responseErrorMessage(response: Response): Promise<string>
```

`normalizeBaseUrl` uses `new URL`; append `/v1` when `pathname` is empty or `/`; strip trailing slashes first; throw on blank/invalid. `buildSpeechBody` omits empty model/voice, always sets `response_format: "mp3"`, and clamps speed to `0.25`–`4`. `discoverModels` fetches `{base}/models`; `discoverVoices` fetches `{base}/audio/voices`; both send auth headers and throw with the status plus parsed server message on failure. `responseErrorMessage` prefers JSON `error.message`, then `message`, then raw text, then `HTTP <status>`.

- [ ] **Step 6: Run tests**

Run: `bun test test/openai_tts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/settings.ts src/openai_tts.ts test/openai_tts.test.ts
git commit -m "feat: add settings and OpenAI TTS request logic"
```

---

### Task 3: Streaming MSE player and harness

**Files:**
- Create: `src/streaming/mse_player.ts`
- Create: `test/server.ts`, `test/harness.html`, `test/harness.ts`, `test/player.e2e.ts`
- Modify: `package.json` (scripts already added in Task 1)

**Interfaces:**
- Consumes: `OpenAiConfig`, `PlayerState` from Task 2; `speechUrl`, `buildSpeechBody`, `buildAuthHeaders`, `responseErrorMessage`.
- Produces: `MseStreamPlayer` with `constructor(audio: HTMLAudioElement, onState?: (state: PlayerState) => void)`, `play(texts: string[], config: OpenAiConfig): Promise<void>`, and `stop(): void`.

- [ ] **Step 1: Write the failing Player E2E test**

Create `test/player.e2e.ts` that:

- Spawns `bun test/server.ts` on port 8890 and waits for `/harness.html`.
- Launches Playwright Chromium headless.
- Opens `http://localhost:8890/harness.html`.
- Fills base URL `http://localhost:8890/v1`, model ``, voice `default`, and three paragraphs.
- Clicks Play.
- Waits for the page log to contain `"status":"playing"`.
- Asserts `"status":"playing"` appears before `play resolved`.
- Waits for `"status":"idle"` and asserts the final `receivedBytes` is greater than 0.
- Clicks Play with a long text, waits for playing, clicks Stop, and asserts the last state is `"idle"`.
- Fills voice `nope`, clicks Play, and asserts an `"status":"error"` entry containing `unknown voice`.
- Kills the server and closes the browser in `finally`.

Use `node:assert/strict` and a small `waitForLog`/polling helper. Save the log on the page as a JSON array in `window.__log` and a `#log` element. Expose the current player as `window.__player` so Stop can call `window.__player.stop()`.

- [ ] **Step 2: Run it and verify failure**

Run: `bun run test:player`
Expected: FAIL, because `src/streaming/mse_player.ts` and the harness do not exist.

- [ ] **Step 3: Implement `MseStreamPlayer`**

In `src/streaming/mse_player.ts`, implement a generation-guarded player:

- `play()` stops any current session, increments the generation, emits `loading`, creates `MediaSource`, assigns an object URL to `audio.src`, waits for `sourceopen`, adds an `audio/mpeg` SourceBuffer, and sets `audio.volume`.
- For each text, `POST` to `speechUrl(config.baseUrl)` with `buildAuthHeaders`, `Content-Type: application/json`, and `JSON.stringify(buildSpeechBody(text, config))`.
- Throw `await responseErrorMessage(response)` when `!response.ok`.
- Read `response.body` with a reader; append each chunk and await `updateend`. Ignore chunks whose generation is stale.
- After the first appended chunk, call `audio.play()` and emit `playing` with the running byte count.
- After all paragraphs, `mediaSource.endOfStream()` and wait for `ended`; emit `idle`.
- If the body yields zero bytes, throw an error `"empty audio response"`.
- `stop()` increments the generation, aborts the controller, pauses the audio, removes `src`, calls `audio.load()`, revokes the object URL, and emits `idle`.
- Catch errors: aborted generations return silently; real errors emit `error` with the message.
- Handle `SourceBuffer` `error` and `abort` events by rejecting the append promise.

- [ ] **Step 4: Implement the harness and proxy**

`test/server.ts`:

- `Bun.build` `test/harness.ts` to `test-dist/harness.js` with `target: "browser"`, `format: "iife"`.
- `Bun.serve` on `PORT ?? 8890`.
- Serve `/harness.html`, `/harness.js`, and `/page.html`.
- Proxy `/v1/*` to `${TTS_UPSTREAM ?? "http://localhost:8880"}` using `fetch`, forwarding method, headers, body, and the streaming response body. Return the upstream status and content type unchanged.

`test/harness.html` has a form with Base URL, Model, Voice, a three-paragraph textarea, Play, Stop, and a `<pre id="log">`.

`test/harness.ts` imports `MseStreamPlayer`, creates an `Audio` element, and on Play:

```ts
const player = new MseStreamPlayer(audio, (state) => {
  window.__log.push(state);
  logEl.textContent += JSON.stringify(state) + "\n";
});
window.__player = player;
void player.play(texts, config).then(() => {
  logEl.textContent += "play resolved\n";
});
```

Button handlers write to `window.__log` and `#log`.

- [ ] **Step 5: Run the Player E2E test**

Run: `bun run test:player`
Expected: PASS: playing starts before the play promise resolves, three paragraphs reach idle with bytes received, Stop returns idle, and the bad voice reports an error containing `unknown voice`.

- [ ] **Step 6: Manually inspect with Playwright MCP**

Start `bun run test:serve` in the background and open `http://localhost:8890/harness.html` with Playwright MCP. Click Play, confirm the log shows `playing` then `idle`, and take a screenshot. This is the required MCP check for the streaming path; the automated test remains the source of truth.

- [ ] **Step 7: Commit**

```bash
git add src/streaming/mse_player.ts test/server.ts test/harness.html test/harness.ts test/player.e2e.ts
git commit -m "feat: stream MP3 TTS through MediaSource"
```

---

### Task 4: Native driver, message types, and content script

**Files:**
- Create: `src/messages.ts`, `src/native_tts.ts`, `src/content_script.ts`, `test/text.test.ts`
- Modify: `src/content_script.ts` (replace stub)

**Interfaces:**
- Consumes: `driverSetting`, `loadNativeSettings`, `playbackStateSetting`; `NativeVoiceSettings`, `PlayerState`.
- Produces:
  - `splitIntoParagraphs(text: string): string[]`
  - `speakNative(texts: string[], settings: NativeVoiceSettings, onState?: (state: PlayerState) => void): Promise<void>`
  - `stopNative(): void`
  - `BackgroundMessage` and `OffscreenMessage` unions used by Tasks 5 and 6.

- [ ] **Step 1: Write the failing text test**

```ts
// test/text.test.ts
import { expect, test } from "bun:test";
import { splitIntoParagraphs } from "../src/content_script";

test("splits on blank lines and trims", () => {
  expect(splitIntoParagraphs("  one  \n\n two \n\n\n")).toEqual(["one", "two"]);
});

test("keeps single newlines inside a paragraph", () => {
  expect(splitIntoParagraphs("line one\nline two\n\nnext")).toEqual([
    "line one\nline two",
    "next",
  ]);
});

test("drops empty input", () => {
  expect(splitIntoParagraphs(" \n\n ")).toEqual([]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `bun test test/text.test.ts`
Expected: FAIL, because `splitIntoParagraphs` is not exported.

- [ ] **Step 3: Implement `src/native_tts.ts`**

`src/native_tts.ts` imports `NativeVoiceSettings` and `PlayerState`. It keeps a module-level `speechSynthesis`. `speakNative` cancels any current speech, selects the voice by `voiceURI` (falling back to the default), and speaks each paragraph sequentially through a promise resolved by `utter.onend` and rejected by `utter.onerror`. Set `volume`, `rate`, and `pitch` on each utterance. Emit `playing` before the first utterance and `idle` after the last. `stopNative()` calls `speechSynthesis.cancel()`.

- [ ] **Step 4: Implement `src/messages.ts`**

Define the exact message unions:

```ts
export type BackgroundMessage =
  | { target: "background"; type: "native:start" }
  | { target: "background"; type: "native:state"; state: PlayerState }
  | { target: "background"; type: "tts:start"; texts: string[] }
  | { target: "background"; type: "tts:stop" }
  | { target: "background"; type: "playback:state"; state: PlayerState };

export type OffscreenMessage =
  | { target: "offscreen"; type: "ping" }
  | { target: "offscreen"; type: "tts:start"; texts: string[]; config: OpenAiConfig }
  | { target: "offscreen"; type: "tts:stop" };
```

- [ ] **Step 5: Implement `src/content_script.ts`**

- Add one `keydown` listener on `window`. Trigger on Shift+A when Ctrl, Meta, and Alt are not pressed.
- Get the selection from `window.getSelection()`, split it with `splitIntoParagraphs`, and return if empty.
- Read `driverSetting.get()`.
- For `native`: `await chrome.runtime.sendMessage({ target: "background", type: "native:start" }).catch(() => {})`, then `loadNativeSettings()`, then `speakNative(texts, settings, (state) => void chrome.runtime.sendMessage({ target: "background", type: "native:state", state }).catch(() => {}))`.
- For `openai`: `void chrome.runtime.sendMessage({ target: "background", type: "tts:start", texts }).catch(() => {})`.
- Listen for `{ type: "stop-native" }` and call `stopNative()` plus a native idle state message.
- On `pagehide`, stop native speech and send a native idle state.

- [ ] **Step 6: Run tests and build**

Run: `bun test test/text.test.ts && bun run build`
Expected: text tests pass; build succeeds with the new content script.

- [ ] **Step 7: Commit**

```bash
git add src/messages.ts src/native_tts.ts src/content_script.ts test/text.test.ts
git commit -m "feat: add native driver and Shift+A content script"
```

---

### Task 5: Service worker orchestration and offscreen playback

**Files:**
- Create: `src/background.ts`, `src/offscreen.ts`, `test/e2e.ts`
- Modify: `public/offscreen.html` (replace stub)

**Interfaces:**
- Consumes: `MseStreamPlayer`; all settings; message unions; `loadOpenAiConfig`.
- Produces: a working extension backend; `test/e2e.ts` exports reusable launch/poll helpers for Task 7.

- [ ] **Step 1: Write the failing backend E2E test**

Create `test/e2e.ts` with:

- A `launchExtension()` helper: `chromium.launchPersistentContext` with a temp profile and `--disable-extensions-except=dist --load-extension=dist`; use `headless: false` and note that `xvfb-run -a` is the fallback on machines without a display.
- Wait for the service worker, read the extension id from its URL, and open `chrome-extension://<id>/controller.html` (the Task 1 stub page is an extension page and can call `chrome.*`).
- Helper `getState(page)` reads `chrome.storage.session.get("playback-state")` and returns its value.
- Helper `waitForStatus(page, status, timeoutMs = 15000)` polls every 100 ms.

The first test:

1. Send `{ target: "background", type: "tts:start", texts: ["Hello from the backend smoke test."] }` from the extension page with `page.evaluate`.
2. Wait for `playing`.
3. Assert `receivedBytes > 0`.
4. Send `{ target: "background", type: "tts:stop" }`.
5. Wait for `idle`.

Close the context and remove the profile in `finally`.

- [ ] **Step 2: Run it and verify failure**

Run: `bun run test:e2e`
Expected: FAIL, because the background stub does not handle messages and no offscreen document exists.

- [ ] **Step 3: Implement `src/background.ts`**

Implement:

- A module-level `creatingOffscreen: Promise<void> | null` and `ensureOffscreen()` that checks `chrome.offscreen.hasDocument()`, creates `offscreen.html` with `chrome.offscreen.Reason.AUDIO_PLAYBACK`, waits for creation, then pings the offscreen document up to 20 times (50 ms apart) until it gets `{ ok: true }`.
- `stopOffscreen()` sends `{ target: "offscreen", type: "tts:stop" }` only when `hasDocument()` is true, catching errors.
- `stopNativeTab()` reads `activeNativeTabSetting`, sends `{ type: "stop-native" }` with `chrome.tabs.sendMessage` to that tab, catches errors, and clears the setting.
- `setPlaybackState(state)` writes `playbackStateSetting` with `updatedAt: Date.now()`.
- `handleStart(texts, source)` stops the native tab, ensures offscreen, loads the OpenAI config, sends `{ target: "offscreen", type: "tts:start", texts, config }`, and sets loading/openai. Any failure becomes an error state.
- `handleNativeStart(senderTabId, sendResponse)` stops offscreen, stops the previous native tab if different, stores `senderTabId`, sets loading/native, and responds `{ ok: true }`.
- `native:state` and `playback:state` write state. Native idle/error clears `active-native-tab`.
- `tts:stop` stops offscreen and the native tab and sets idle.
- The `onMessage` listener only handles `target === "background"`. It returns `true` only for `native:start` so `sendResponse` can run asynchronously; all other handlers are fire-and-forget.

- [ ] **Step 4: Implement `src/offscreen.ts`**

- Query `#player` as the audio element.
- Create one `MseStreamPlayer` with a callback that sends `{ target: "background", type: "playback:state", state }` and catches send errors.
- On `{ target: "offscreen", type: "ping" }`, call `sendResponse({ ok: true })` and return `true`.
- On `tts:start`, call `stop()` on the player, then `void player.play(message.texts, message.config)`.
- On `tts:stop`, call `player.stop()`.
- Do not reference `chrome.storage` anywhere.

- [ ] **Step 5: Replace `public/offscreen.html`**

Use the Task 1 HTML with `<audio id="player"></audio>` and `<script src="offscreen.js"></script>`.

- [ ] **Step 6: Run the backend E2E test**

Run: `bun run build && bun run test:e2e`
Expected: PASS: state reaches playing with bytes, then idle after stop.

- [ ] **Step 7: Commit**

```bash
git add src/background.ts src/offscreen.ts public/offscreen.html test/e2e.ts
git commit -m "feat: orchestrate streaming playback with an offscreen document"
```

---

### Task 6: Preact popup with Tailwind and daisyUI

**Files:**
- Create: `src/controller.tsx`, `src/ui/App.tsx`, `src/ui/NativePanel.tsx`, `src/ui/ServerPanel.tsx`, `src/ui/StatusBadge.tsx`, `src/ui/Slider.tsx`, `src/ui/usePlaybackState.ts`, `src/ui/useSettings.ts`
- Create: `test/chrome-shim.js`
- Modify: `test/server.ts` (popup route and dist assets)
- Modify: `public/controller.html` (keep minimal shell)

**Interfaces:**
- Consumes: `loadAppSettings`, `saveAppSetting`, `discoverModels`, `discoverVoices`, `playbackStateSetting`, `Driver`, `PlaybackState`, `PREVIEW_TEXT` (define `"The quick brown fox jumps over the lazy dog"` in `App.tsx`).
- Produces: the popup UI and the `chrome` shim for page-level tests.

- [ ] **Step 1: Implement the settings and playback hooks**

`useSettings()` loads `loadAppSettings()` on mount, returns `[settings, update]`, and writes each update through `saveAppSetting`. Render nothing until settings are loaded.

`usePlaybackState()` reads `playbackStateSetting.get()` on mount, subscribes to `chrome.storage.onChanged` for `areaName === "session"` and `changes["playback-state"]`, and returns the latest `PlaybackState`.

- [ ] **Step 2: Implement the components**

`App.tsx`:

- Header with `simple-readaloud` and `<StatusBadge state={state} />`.
- Driver tabs: `Native` and `OpenAI-compatible`, using daisyUI `tabs tabs-boxed`; changing saves `driver`.
- Conditional panels: `NativePanel` or `ServerPanel`.
- Shared `Slider` controls for Volume (`0`–`1`, step `0.05`) and Playback rate (`0.1`–`2`, step `0.1`); Pitch (`0`–`2`, step `0.05`) appears only for Native.
- Footer `Stop` button that sends `{ target: "background", type: "tts:stop" }`.
- Error state renders a daisyUI `alert alert-error` with `state.message`.

`NativePanel.tsx`:

- `speechSynthesis.getVoices()` plus a `voiceschanged` listener. Group `<option>` elements by `voice.lang`; value is `voice.voiceURI`; label is `voice.name`.
- Save `nativeVoiceUri` on change.

`ServerPanel.tsx`:

- Base URL, API key (`type="password"`), Model, Voice (both with datalists), Refresh, Test voice, and a status line.
- Refresh reads the current base URL/key, runs `discoverModels` and `discoverVoices` with `AbortSignal.timeout(5000)`, fills empty model/voice fields with the first result, and writes the current values before testing.
- Never clear typed values. Show "N models, M voices", "Voice list unavailable", or the error text.
- Test voice sends `{ target: "background", type: "tts:start", texts: [PREVIEW_TEXT] }`.

`StatusBadge.tsx`: maps status to daisyUI badge classes (`badge-ghost`, `badge-info`, `badge-success`, `badge-error`) and text `Idle`, `Loading`, `Playing`, `Error`.

`Slider.tsx`: label, numeric value, `input[type=range]` with daisyUI `range`, and onChange.

- [ ] **Step 3: Implement `src/controller.tsx`**

Render `<App />` into `#app` with `preact.render`.

- [ ] **Step 4: Add the popup page shim**

`test/chrome-shim.js` implements `chrome.storage.local`, `chrome.storage.session`, `chrome.storage.onChanged`, `chrome.runtime.sendMessage`, and `chrome.tabs` backed by `localStorage`/memory:

- `storage.get(key)` supports a string, array, null (all), or object.
- `storage.set(obj)` writes and notifies listeners with `{ [key]: { newValue, oldValue } }`.
- `runtime.sendMessage({ type: "tts:start" })` writes a playing state with `receivedBytes: 2048` and notifies; `tts:stop` writes idle.
- `tabs.query()` returns `[{ id: 1 }]`; `tabs.sendMessage()` resolves.
- The shim is a classic script and must define `globalThis.chrome` before `controller.js`.

In `test/server.ts`, serve `/popup.html` by reading `dist/controller.html` and injecting `<script src="/chrome-shim.js"></script>` immediately before `<script src="controller.js"></script>`. Serve `/controller.js`, `/controller.css`, and icon files from `dist/`, and `/chrome-shim.js` from `test/`.

- [ ] **Step 5: Build and check the popup with Playwright MCP**

Run: `bun run build`, then start `bun run test:serve`.

With Playwright MCP:

1. Open `http://localhost:8890/popup.html`.
2. Assert the header, driver tabs, Native panel, and shared sliders render.
3. Click `OpenAI-compatible`; fill Base URL `http://localhost:8890/v1`; click `Refresh`; assert the Model field becomes `gradium/phonon-31m-en` and the Voice field is non-empty.
4. Click `Test voice`; assert the status badge shows `Playing`.
5. Click `Stop`; assert the badge shows `Idle`.
6. Switch back to `Native`; assert the pitch slider appears and the server panel disappears.
7. Take a screenshot for the visual record.

Expected: all checks pass; discovery comes from the real server through the proxy.

- [ ] **Step 6: Run unit tests and build**

Run: `bun test && bun run build`
Expected: all non-E2E tests pass and the popup CSS/JS are in `dist/`.

- [ ] **Step 7: Commit**

```bash
git add src/controller.tsx src/ui src/styles.css public/controller.html test/chrome-shim.js test/server.ts
git commit -m "feat: rebuild the popup with Preact, Tailwind, and daisyUI"
```

---

### Task 7: Full extension E2E, docs, and cleanup

**Files:**
- Modify: `test/e2e.ts`, `README.md`, `.gitignore`
- Verify: all old files are gone, `dist/` is not committed

**Interfaces:**
- Consumes: the launch/state helpers from Task 5; all UI labels from Task 6; the content script from Task 4.
- Produces: a complete, verified extension and developer docs.

- [ ] **Step 1: Extend `test/e2e.ts` with the full flow**

Add these cases in order, reusing one launched context:

1. **Popup settings:** open the extension popup page, fill Base URL `http://localhost:8880/v1`, click Refresh, wait for Model `gradium/phonon-31m-en` and a non-empty Voice.
2. **Preview stream:** click Test voice; wait for `playing`; assert `driver === "openai"` and `receivedBytes > 0`; click Stop; wait for `idle`.
3. **Content script:** start a local page server on `http://localhost:8890/page.html` with one paragraph; open it; select the paragraph with a DOM Range; press Shift+A; wait for `playing`; assert `driver === "openai"`; click Stop in the popup page; wait for `idle`.
4. **Error:** set Voice `nope`; click Test voice; wait for `error`; assert the message contains `unknown voice`.
5. **Offscreen race:** reset Voice to a valid voice; click Test voice twice in quick succession; wait for `playing`; assert no `Only a single offscreen document` message in the console.
6. **Native handoff:** switch the driver to Native; press Shift+A on the page; wait for `driver === "native"` with status loading or playing; click Stop; wait for `idle`.
7. **Closed native tab:** start native again, close the page, click Stop in the popup, and assert the state becomes `idle` without an unhandled error.

Use `node:assert/strict`, a `waitForState` helper with a 20 s timeout, and `finally` cleanup. Skip the native assertions with a clear console note if `speechSynthesis` is unavailable, but still verify the message/state path.

- [ ] **Step 2: Run the full E2E**

Run: `bun run build && bun test && bun run test:player && bun run test:e2e`
Expected: all pass. The extension streams real audio from `:8880`, bypasses CORS via host permissions, and returns to idle after Stop.

- [ ] **Step 3: Rewrite `README.md`**

Cover:

- `simple-readaloud` name and Chromium-only status.
- Requirements: Bun, Chrome 116+.
- Build: `bun install`, `bun run build`; load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.
- Usage: select text and press Shift+A.
- Drivers: Native (default) and OpenAI-compatible.
- OpenAI fields: base URL, optional API key, model, voice, Refresh discovery, Test voice.
- Streaming limitation: MP3 only.
- Development: `bun test`, `bun run test:player`, `bun run test:e2e`; the last two need the local server at `http://localhost:8880/v1`.

- [ ] **Step 4: Cleanup**

- Delete `public/controller.css` if it still exists.
- Ensure `.gitignore` contains `dist`, `test-dist/`, and `.playwright-mcp/`.
- `git status --short` must show only intended source/docs changes; no `dist/`, profiles, or screenshots.

- [ ] **Step 5: Final verification**

Run:

```bash
bun run build
bun test
bun run test:player
bun run test:e2e
```

Expected: build succeeds; all suites pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ship simple-readaloud Chromium streaming extension"
```
