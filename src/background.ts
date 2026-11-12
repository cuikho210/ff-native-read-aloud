import type { BackgroundMessage, ContentMessage, OffscreenMessage } from "./messages";
import {
  activeNativeTabSetting,
  loadOpenAiConfig,
  playbackStateSetting,
} from "./settings";
import type { Driver, PlaybackState, PlayerState } from "./types";

export const READ_SELECTION_MENU_ID = "read-selection";

let creatingOffscreen: Promise<void> | null = null;
let startGeneration = 0;

export function resetOrchestrationForTests(): void {
  creatingOffscreen = null;
  startGeneration = 0;
}

function invalidateStarts(): void {
  startGeneration += 1;
}

export async function ensureOffscreen(): Promise<void> {
  if (!creatingOffscreen) {
    creatingOffscreen = prepareOffscreen().finally(() => {
      creatingOffscreen = null;
    });
  }

  await creatingOffscreen;
}

async function prepareOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  await createOffscreen();
}

async function createOffscreen(): Promise<void> {
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Play streamed text-to-speech audio",
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = (await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "ping",
      })) as { ok?: boolean } | undefined;
      if (response?.ok) {
        return;
      }
    } catch {
      // Listener not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Offscreen document did not become ready");
}

async function stopOffscreen(): Promise<void> {
  try {
    if (await chrome.offscreen.hasDocument()) {
      await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "tts:stop",
      } satisfies OffscreenMessage);
    }
  } catch {
    // Document may be closing or already gone.
  }
}

async function stopNativeTab(): Promise<void> {
  const tabId = await activeNativeTabSetting.get();
  await activeNativeTabSetting.set(null);

  if (typeof tabId === "number") {
    await chrome.tabs.sendMessage(tabId, { type: "stop-native" }).catch(() => {});
  }
}

async function setPlaybackState(
  state: PlayerState,
  driver?: Driver,
  tabId?: number,
): Promise<void> {
  const playbackState: PlaybackState = {
    ...state,
    updatedAt: Date.now(),
  };
  if (driver) {
    playbackState.driver = driver;
  }
  if (typeof tabId === "number") {
    playbackState.tabId = tabId;
  }
  await playbackStateSetting.set(playbackState);
}

export async function handleStart(texts: string[]): Promise<void> {
  const generation = ++startGeneration;

  try {
    await stopNativeTab();
    if (generation !== startGeneration) {
      return;
    }

    await setPlaybackState({ status: "loading" }, "openai");
    if (generation !== startGeneration) {
      return;
    }

    await ensureOffscreen();
    const config = await loadOpenAiConfig();
    if (generation !== startGeneration) {
      return;
    }

    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "tts:start",
      texts,
      config,
    } satisfies OffscreenMessage);
  } catch (error) {
    if (generation !== startGeneration) {
      return;
    }
    await setPlaybackState(
      { status: "error", message: errorMessage(error) },
      "openai",
    );
  }
}

export async function handleNativeStart(
  tabId: number | undefined,
  sendResponse: (response: { ok: boolean }) => void,
): Promise<void> {
  const generation = ++startGeneration;

  try {
    await stopOffscreen();
    if (generation !== startGeneration) {
      return;
    }

    const previousTab = await activeNativeTabSetting.get();
    if (typeof previousTab === "number" && previousTab !== tabId) {
      await chrome.tabs
        .sendMessage(previousTab, { type: "stop-native" })
        .catch(() => {});
    }

    if (generation !== startGeneration) {
      return;
    }

    await activeNativeTabSetting.set(tabId ?? null);
    if (generation !== startGeneration) {
      return;
    }

    await setPlaybackState({ status: "loading" }, "native", tabId);
  } finally {
    sendResponse({ ok: generation === startGeneration });
  }
}

async function handleNativeState(
  state: PlayerState,
  tabId: number | undefined,
): Promise<void> {
  if (typeof tabId !== "number") {
    return;
  }

  const activeTab = await activeNativeTabSetting.get();
  if (activeTab !== tabId) {
    return;
  }

  await setPlaybackState(state, "native", tabId);

  if (state.status === "idle" || state.status === "error") {
    await activeNativeTabSetting.set(null);
  }
}

async function handleOffscreenState(state: PlayerState): Promise<void> {
  const current = await playbackStateSetting.get();
  if (current.driver !== "openai") {
    return;
  }

  await setPlaybackState(state, "openai");
}

export async function handleStop(): Promise<void> {
  invalidateStarts();
  await Promise.all([stopOffscreen(), stopNativeTab()]);
  await setPlaybackState({ status: "idle" });
}

export async function installContextMenu(): Promise<void> {
  await Promise.resolve(
    chrome.contextMenus.removeAll(() => {
      try {
        chrome.contextMenus.create({
          id: READ_SELECTION_MENU_ID,
          title: "Read aloud",
          contexts: ["selection"],
        });
      } catch {
        // A duplicate id means the menu already exists; playback is unaffected.
      }
    }),
  );
}

export async function handleMenuClick(
  info: { menuItemId: string | number; frameId?: number },
  tab: { id?: number } | undefined,
): Promise<void> {
  if (info.menuItemId !== READ_SELECTION_MENU_ID) {
    return;
  }
  if (typeof tab?.id !== "number") {
    return;
  }

  await chrome.tabs
    .sendMessage(
      tab.id,
      { type: "read-selection" } satisfies ContentMessage,
      { frameId: info.frameId ?? 0 },
    )
    .catch(() => {});
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

chrome.runtime.onInstalled.addListener(() => {
  void installContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void installContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleMenuClick(info, tab);
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    const typed = message as BackgroundMessage | undefined;
    if (typed?.target !== "background") {
      return;
    }

    switch (typed.type) {
      case "native:start":
        void handleNativeStart(sender.tab?.id, sendResponse);
        return true;
      case "native:state":
        void handleNativeState(typed.state, sender.tab?.id);
        return;
      case "tts:start":
        void handleStart(typed.texts);
        return;
      case "tts:stop":
        void handleStop();
        return;
      case "playback:state":
        void handleOffscreenState(typed.state);
        return;
    }
  },
);
