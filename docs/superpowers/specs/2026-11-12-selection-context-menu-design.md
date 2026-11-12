# Read-aloud from the browser context menu

Date: 2026-11-12
Status: proposed
Size: small change

## Intent

Right-clicking a text selection on a page offers a **Read aloud** item that
starts the same reading Shift+A starts. Only one menu item exists; there is no
Stop entry, because the popup already has Stop.

## What already exists

The content script owns both drivers: it reads `window.getSelection()`, splits
paragraphs on blank lines, and routes to `tts:start` (OpenAI) or
`startNativeReading()` (native). The service worker owns orchestration, settings,
and `playback-state`. Nothing about playback changes here.

## Constraint that shapes the design

Native speech runs on `speechSynthesis`, which exists only in a page/frame. A
context-menu click is handled in the service worker, which has neither
`speechSynthesis` nor `getSelection()`. So the click cannot read aloud by itself
and must delegate to the content script. Building the request from
`info.selectionText` in the service worker was rejected for the same reason: it
would make the menu OpenAI-only.

## Approaches

1. **Delegate the click to the content script (chosen).** The service worker
   registers the menu, then on click messages `{ type: "read-selection" }` to
   `tabId` at `info.frameId`. The content script re-reads its live selection and
   runs the existing read path. Both drivers work, iframes work through the
   existing `all_frames: true`, and the click reads exactly what is highlighted.
   Cost: nothing happens on pages with no content script (`chrome://` pages, the
   Web Store, the PDF viewer), and `selectionText` is not used.
2. **Service worker uses `info.selectionText`.** Less code and works on PDFs, but
   the native driver cannot run there, so the menu would be silently
   OpenAI-only. Rejected.
3. **Content script registers the menu.** `chrome.contextMenus` is not exposed
   to content scripts. Rejected.
4. **Add a Stop item too.** Rejected by request: one item only.

## Design

### Manifest

Add `"contextMenus"` to `permissions`. Bump `version` to `2.1.0` (my call; it is
a user-visible feature).

### Service worker (`src/background.ts`)

- Constant menu id `read-selection`, title `Read aloud`, `contexts:
  ["selection"]` so Chrome shows it only when text is selected.
- `installContextMenu()` removes all menus and recreates the one item. Called
  from `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`, wrapped so a
  recreate failure cannot break playback handling. Exported for tests.
- `chrome.contextMenus.onClicked` → when `menuItemId` matches and `tab?.id` is a
  number, `chrome.tabs.sendMessage(tabId, { type: "read-selection" }, { frameId:
  info.frameId ?? 0 })`, swallowing failures the same way `stopNativeTab()` does.

### Content script (`src/content_script.ts`)

- Extract the current Shift+A body into `read(texts: string[])` holding the
  driver read and routing. `handleKeydown` becomes "read the selection, then
  `read()`" and the message listener adds a `read-selection` case that does the
  same. One routing implementation, so the two entry points cannot drift.
- `read()` does nothing when `texts` is empty.

### Message type (`src/messages.ts`)

This message travels worker → content script instead of to `background`, so it
gets its own `ContentMessage` union rather than joining `BackgroundMessage`:
`{ type: "read-selection" } | { type: "stop-native" }`. The content script's
listener takes that type instead of an inline `{ type?: string }`.

## Testing

- `test/manifest.test.ts`: `contextMenus` is in `permissions`; version is `2.1.0`.
- `test/background.test.ts`: extend the chrome shim with `contextMenus`
  (`removeAll`, `create`, `onClicked.addListener`) and `tabs.sendMessage`
  capture. Assert the menu is created with `contexts: ["selection"]`, and that a
  matching click sends `read-selection` to the clicked tab and frame while an
  unrelated menu id sends nothing.
- `test/e2e.ts`: from the popup, `chrome.tabs.sendMessage` to the test page with
  `{ type: "read-selection" }` over a live selection and assert the state reaches
  `playing` with `receivedBytes > 0`. This exercises the content-script half real
  end to end; Playwright cannot click a native context menu, so the menu wiring
  is covered by the unit test.

## Non-goals

- A Stop or Pause menu item, submenus, per-site menu visibility control.
- Reading `selectionText` when no content script is present (PDFs, `chrome://`).
- Keyboard changes; Shift+A keeps working unchanged.
