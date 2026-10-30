# simple-readaloud

A Chromium extension that reads selected text aloud with either the browser's
native speech synthesis or any OpenAI-compatible text-to-speech server that
supports streamed MP3.

Select text on a page and press **Shift+A**. A new reading stops whatever was
playing, across both drivers and tabs.

This is a Chromium Manifest V3 extension. Firefox is not supported.

## Requirements

- [Bun](https://bun.sh) for building and development
- Chrome or Chromium 116 or newer

## Build and install

```bash
bun install
bun run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select the `dist` directory. After changing the source, run
`bun run build` again and reload the extension from `chrome://extensions`.

## Drivers

### Native

Uses the browser's built-in speech synthesis. Pick a voice in the popup and
adjust pitch, volume, and playback rate. This is the default driver.

### OpenAI-compatible

Calls `POST {base URL}/audio/speech` with `response_format: "mp3"` and streams
the response into one continuous MediaSource stream, so playback starts before
the whole response has arrived and paragraphs join without gaps.

Popup fields:

- **Base URL** — defaults to `http://localhost:8880/v1`. A bare origin such as
  `http://localhost:8880` gets `/v1` appended; a URL with a path is used as-is.
- **API key** — optional. Sent as `Authorization: Bearer <key>` when set.
- **Model** and **Voice** — optional. Empty values are omitted from the request.
- **Refresh** — queries `GET {base}/models` and `GET {base}/audio/voices` and
  fills empty fields from the results. Typed values are never cleared.
- **Test voice** — streams a short preview through the same offscreen
  playback path used by Shift+A.

The playback-rate slider is sent as the API `speed` value, clamped to
`0.25`–`4.0`. Volume is applied to the audio element. Pitch has no effect for
this driver.

Only MP3 streaming is supported, because it is the format Chromium can play
through MediaSource here and the format OpenAI-compatible servers commonly
expose.

## Development

```bash
bun test            # unit tests
bun run test:player # streaming player E2E, needs the TTS server
bun run test:e2e    # full extension E2E, needs the TTS server
```

The two E2E suites expect a local OpenAI-compatible server at
`http://localhost:8880/v1` and use Chromium through Playwright. The full suite
also starts a page/proxy server on port `8890`. `bun run test:serve` starts that
server on its own for manual browser checks at
`http://localhost:8890/harness.html` and `http://localhost:8890/popup.html`
(the latter uses a `chrome.storage` shim).

The extension is built as four IIFE bundles in `dist`; Tailwind and daisyUI
generate `dist/controller.css` during the build.
