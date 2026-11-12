# Read Aloud from the Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single "Read aloud" browser context-menu item for a text selection that starts the same reading Shift+A starts.

**Architecture:** The service worker registers one `contextMenus` item scoped to selections. A click is delegated to the content script in the clicked frame, because native speech and `getSelection()` exist only in a page. The content script's Shift+A body is extracted into one shared function that both the keyboard handler and the new message listener call, so driver routing cannot drift.

**Tech Stack:** TypeScript, Bun, Chrome MV3 (`contextMenus`, `tabs.sendMessage`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-selection-context-menu-design.md`

## Global Constraints

- Manifest V3; `name` is `simple-readaloud`; `version` becomes `2.1.0`; `minimum_chrome_version` is `116`.
- `permissions` becomes `["storage", "offscreen", "contextMenus"]`.
- Exactly one menu item: id `read-selection`, title `Read aloud`, `contexts: ["selection"]`. No Stop item.
- Only two drivers exist: `native` and `openai`. Routing is unchanged.
- The menu click must never use `info.selectionText`; the content script re-reads the live selection.
- Menu wiring must never break playback handling: registration and click errors are swallowed.
- Only one playback runs at a time across drivers and tabs.
- Content scripts are classic IIFE bundles; no inline scripts.
- Shift+A behaviour is unchanged.

## Review Focus

- A click on a page with no content script (`chrome://`, Web Store, PDF viewer) must not throw, log an unhandled rejection, or wedge `playback-state`.
- A click inside an iframe must read that frame's selection, not the top frame's.
- Shift+A must still start readings after the shared-path refactor.
- A selection cleared between menu render and click must start nothing and must not interrupt playback already running.
- A second reading started by the menu while something plays must supersede it, matching Shift+A.

---

### Task 1: Register the menu and delegate clicks to the content script

**Files:**
- Modify: `public/manifest.json`
- Modify: `src/messages.ts`
- Modify: `src/background.ts`
- Test: `test/manifest.test.ts`, `test/background.test.ts`

**Interfaces:**
- Consumes: nothing new; `chrome.tabs.sendMessage` already used in `stopNativeTab()`.
- Produces: `export type ContentMessage` in `src/messages.ts` — `{ type: "read-selection" } | { type: "stop-native" }`; `export const READ_SELECTION_MENU_ID = "read-selection"`, `export function installContextMenu(): Promise<void>`, and `export async function handleMenuClick(info: { menuItemId: string; frameId?: number }, tab: { id?: number } | undefined): Promise<void>` in `src/background.ts`. Task 2 consumes `ContentMessage` as the listener's message type. Task 3 sends `{ type: "read-selection" }`.

- [ ] **Step 1: Write the failing tests**

In `test/manifest.test.ts`, change the version expectation and permission list, and add a menu assertion:

```ts
expect(manifest.version).toBe("2.1.0");
expect(manifest.permissions).toEqual(["storage", "offscreen", "contextMenus"]);
```

In `test/background.test.ts`, extend `fakeChrome` so the module can register menus and capture tab messages. The module also registers lifecycle listeners at import time, so `fakeChrome.runtime` needs `onInstalled` and `onStartup` stubs before `await import("../src/background")` runs; add alongside the existing `onMessage`:

```ts
onInstalled: { addListener() {} },
onStartup: { addListener() {} },
```

Then add the menu and tab capture:

```ts
contextMenus: {
  removeAll(callback?: () => void) {
    callback?.();
  },
  create(createProperties: { id?: string; title?: string; contexts?: string[] }) {
    createdMenus.push(createProperties);
  },
  onClicked: { addListener(listener: (info: { menuItemId: string; frameId?: number }, tab?: { id?: number }) => void) { menuListener = listener; } },
},
tabs: {
  async sendMessage(tabId: number, message: SentMessage, options?: { frameId?: number }) {
    tabMessages.push({ tabId, message, options });
    return sendMessageImpl(tabId, message, options);
  },
},
```

with module-level `let createdMenus: unknown[] = []; let tabMessages: { tabId: number; message: SentMessage; options?: { frameId?: number } }[] = []; let menuListener: ((info: any, tab?: any) => void) | undefined;` cleared in `beforeEach`, plus these tests:

```ts
test("registers one Read aloud item for selections", async () => {
  await background.installContextMenu();
  expect(createdMenus).toEqual([
    { id: "read-selection", title: "Read aloud", contexts: ["selection"] },
  ]);
});

test("a menu click asks the clicked tab and frame to read its selection", async () => {
  await background.handleMenuClick(
    { menuItemId: "read-selection", frameId: 3 },
    { id: 42 },
  );
  expect(tabMessages).toEqual([
    { tabId: 42, message: { type: "read-selection" }, options: { frameId: 3 } },
  ]);
});

test("an unrelated menu id sends nothing", async () => {
  await background.handleMenuClick({ menuItemId: "other", frameId: 0 }, { id: 42 });
  expect(tabMessages).toHaveLength(0);
});

test("a tab without an id is ignored and a failed send is swallowed", async () => {
  await background.handleMenuClick({ menuItemId: "read-selection", frameId: 0 }, undefined);
  expect(tabMessages).toHaveLength(0);

  (fakeChrome.tabs as unknown as { sendMessage: () => Promise<never> }).sendMessage =
    async () => {
      throw new Error("Could not establish connection.");
    };
  await expect(
    background.handleMenuClick({ menuItemId: "read-selection", frameId: 0 }, { id: 7 }),
  ).resolves.toBeUndefined();
});

test("the registered click listener delegates to handleMenuClick", async () => {
  await background.installContextMenu();
  menuListener?.({ menuItemId: "read-selection", frameId: 1 }, { id: 9 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(tabMessages).toEqual([
    { tabId: 9, message: { type: "read-selection" }, options: { frameId: 1 } },
  ]);
});
```

Define `let sendMessageImpl: (tabId: number, message: SentMessage, options?: { frameId?: number }) => Promise<unknown>` at module level in the test file and have `fakeChrome.tabs.sendMessage` record into `tabMessages` then delegate to `sendMessageImpl`. Reset `sendMessageImpl` to `async () => undefined` in `beforeEach`, and set the throwing implementation inside that one test, so the failure case cannot leak into later tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/manifest.test.ts test/background.test.ts`
Expected: FAIL — `manifest.version` is `"2.0.0"`, `permissions` lacks `contextMenus`, and `background.installContextMenu`/`handleMenuClick` are not exported.

- [ ] **Step 3: Update the manifest**

In `public/manifest.json` set `"version": "2.1.0"` and `"permissions": ["storage", "offscreen", "contextMenus"]`. Change nothing else.

- [ ] **Step 4: Add `ContentMessage` to `src/messages.ts`**

```ts
export type ContentMessage =
  | { type: "read-selection" }
  | { type: "stop-native" };
```

- [ ] **Step 5: Implement registration and delegation in `src/background.ts`**

Export `READ_SELECTION_MENU_ID = "read-selection"`. `installContextMenu(): Promise<void>` resolves after `chrome.contextMenus.removeAll` fires, then calls `chrome.contextMenus.create({ id: READ_SELECTION_MENU_ID, title: "Read aloud", contexts: ["selection"] })` and swallows a create error — wrap the removal/creation in a promise over the `removeAll` callback so a reinstall cannot race the removal. `handleMenuClick(info, tab)` returns early unless `info.menuItemId === READ_SELECTION_MENU_ID` or `tab?.id` is a number, then awaits `chrome.tabs.sendMessage(tabId, { type: "read-selection" } satisfies ContentMessage, { frameId: info.frameId ?? 0 }).catch(() => {})` — the same swallow pattern `stopNativeTab()` uses, because a frame with no content script rejects.

Wire it next to the existing listener at the bottom of the file:

```ts
chrome.runtime.onInstalled.addListener(() => installContextMenu());
chrome.runtime.onStartup.addListener(() => installContextMenu());
chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleMenuClick(info, tab);
});
```

- [ ] **Step 6: Rebuild and run the tests**

Run: `bun run build && bun test test/manifest.test.ts test/background.test.ts`
Expected: PASS. `dist/manifest.json` carries version `2.1.0` and the `contextMenus` permission.

- [ ] **Step 7: Commit**

```bash
git add public/manifest.json src/messages.ts src/background.ts test/manifest.test.ts test/background.test.ts
git commit -m "feat: add Read aloud context menu item"
```

---

### Task 2: Share one read path between Shift+A and the menu message

**Files:**
- Modify: `src/content_script.ts`
- Test: `test/text.test.ts`

**Interfaces:**
- Consumes: `ContentMessage` from Task 1.
- Produces: `export interface ReadDeps { getDriver: () => Promise<Driver>; startNative: (texts: string[]) => Promise<void>; startOpenAi: (texts: string[]) => void }` and `export async function readTexts(texts: string[], deps?: ReadDeps): Promise<void>` in `src/content_script.ts`. Task 3 relies on the message listener being wired; it calls no function directly.

- [ ] **Step 1: Write the failing tests**

Append to `test/text.test.ts`:

```ts
test("an empty selection starts nothing", async () => {
  let started = 0;
  const deps = {
    getDriver: async () => "openai" as const,
    startNative: async () => { started += 1; },
    startOpenAi: () => { started += 1; },
  };
  await readTexts([], deps);
  expect(started).toBe(0);
});

test("the native driver speaks through startNative", async () => {
  const spoken: string[][] = [];
  let openAiCalls = 0;
  await readTexts(["hello"], {
    getDriver: async () => "native",
    startNative: async (texts) => { spoken.push(texts); },
    startOpenAi: () => { openAiCalls += 1; },
  });
  expect(spoken).toEqual([["hello"]]);
  expect(openAiCalls).toBe(0);
});

test("the openai driver streams through startOpenAi and cancels pending native speech", async () => {
  const openAiTexts: string[][] = [];
  let released!: () => void;
  const pending = new Promise<void>((resolve) => { released = resolve; });
  let spoke = 0;

  const stalling = startNativeReading(["stale"], {
    requestStart: () => pending,
    loadSettings: async () => ({ voiceUri: "", volume: 1, rate: 1, pitch: 1 }),
    speak: async () => { spoke += 1; },
  });

  await readTexts(["hello"], {
    getDriver: async () => "openai",
    startNative: async () => { spoke += 1; },
    startOpenAi: (texts) => { openAiTexts.push(texts); },
  });
  released();
  await stalling;

  expect(openAiTexts).toEqual([["hello"]]);
  expect(spoke).toBe(0);
});
```

Import `readTexts` alongside the existing imports in that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/text.test.ts`
Expected: FAIL — `readTexts` is not exported.

- [ ] **Step 3: Extract the shared path in `src/content_script.ts`**

Add the `ReadDeps` interface and `readTexts(texts, deps = defaultReadDeps)`, where the default deps are `{ getDriver: () => driverSetting.get(), startNative: (texts) => startNativeReading(texts), startOpenAi: (texts) => void sendBackground({ target: "background", type: "tts:start", texts }) }`. Body: return when `texts.length === 0`; read the driver; when it is `openai`, call `invalidateNativeStart()` first, then `startOpenAi(texts)` and return; otherwise await `startNative`. Invalidation lives in `readTexts`, not in `startOpenAi`, so a superseded native read is cancelled on every route — including the keyboard path and the menu path alike — and the injected test deps above exercise it.

Rewrite `handleKeydown` to keep its existing guards, then:

```ts
const texts = readSelection();
if (texts.length === 0) {
  return;
}
event.preventDefault();
await readTexts(texts);
```

Add to the message listener, before the existing `stop-native` check:

```ts
if ((message as ContentMessage)?.type === "read-selection") {
  void readTexts(readSelection());
  return;
}
```

and widen the listener's parameter type to `ContentMessage`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test`
Expected: PASS — the new `text.test.ts` cases plus the existing `native_start.test.ts` and `background.test.ts` suites.

- [ ] **Step 5: Commit**

```bash
git add src/content_script.ts test/text.test.ts
git commit -m "refactor: share one read path for Shift+A and the context menu"
```

---

### Task 3: Prove the menu path end to end

**Files:**
- Modify: `test/e2e.ts`

**Interfaces:**
- Consumes: the `read-selection` message from Task 2 and the `waitForState` / `selectParagraph` / `PAGE_URL` helpers already in the file.
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the end-to-end check**

After the existing Shift+A OpenAI block (the one that asserts `fromContentScript`) and before the bad-voice block, insert a menu-path check. Playwright cannot click a native context menu, so drive the content-script half the menu click reaches, resolving the tab id through the browser:

```ts
await selectParagraph(page);
await popup.evaluate(async (pageUrl) => {
  const tabs = await chrome.tabs.query({});
  const target = tabs.find((tab) => tab.url === pageUrl);
  await chrome.tabs.sendMessage(target!.id!, { type: "read-selection" }, { frameId: 0 });
}, PAGE_URL);
const fromMenu = await waitForState(
  popup,
  (state) => state?.status === "playing",
);
assert.equal(fromMenu.driver, "openai");
assert.ok((fromMenu.receivedBytes ?? 0) > 0, "menu path must stream audio bytes");
await popup.click("#stop");
await waitForStatus(popup, "idle");
await waitForSpeechServerIdle();

await page.evaluate(() => window.getSelection()?.removeAllRanges());
await popup.evaluate(async (pageUrl) => {
  const tabs = await chrome.tabs.query({});
  const target = tabs.find((tab) => tab.url === pageUrl);
  await chrome.tabs.sendMessage(target!.id!, { type: "read-selection" }, { frameId: 0 });
}, PAGE_URL);
for (let elapsed = 0; elapsed < 1500; elapsed += 100) {
  assert.equal(
    (await getState(popup))?.status,
    "idle",
    "an empty selection must start nothing",
  );
  await Bun.sleep(100);
}
```

`getState` is already exported in that file.

- [ ] **Step 2: Run the E2E suite**

Run: `bun run build && bun run test:e2e`
Expected: PASS against the local server at `http://localhost:8880/v1`. If the TTS server is down, start it first; this suite cannot skip.

- [ ] **Step 3: Commit**

```bash
git add test/e2e.ts
git commit -m "test: cover reading the selection from the context menu path"
```
