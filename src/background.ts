import type { BackgroundMessage, OffscreenMessage } from "./messages";
import {
  activeNativeTabSetting,
  loadOpenAiConfig,
  playbackStateSetting,
} from "./settings";
import type { Driver, PlaybackState, PlayerState } from "./types";

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  creatingOffscreen = createOffscreen().finally(() => {
    creatingOffscreen = null;
  });
  await creatingOffscreen;
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

async function handleStart(texts: string[]): Promise<void> {
  try {
    await stopNativeTab();
    await setPlaybackState({ status: "loading" }, "openai");
    await ensureOffscreen();
    const config = await loadOpenAiConfig();
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "tts:start",
      texts,
      config,
    } satisfies OffscreenMessage);
  } catch (error) {
    await setPlaybackState(
      { status: "error", message: errorMessage(error) },
      "openai",
    );
  }
}

async function handleNativeStart(
  tabId: number | undefined,
  sendResponse: (response: { ok: boolean }) => void,
): Promise<void> {
  try {
    await stopOffscreen();

    const previousTab = await activeNativeTabSetting.get();
    if (typeof previousTab === "number" && previousTab !== tabId) {
      await chrome.tabs
        .sendMessage(previousTab, { type: "stop-native" })
        .catch(() => {});
    }

    await activeNativeTabSetting.set(tabId ?? null);
    await setPlaybackState({ status: "loading" }, "native", tabId);
  } finally {
    sendResponse({ ok: true });
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

async function handleStop(): Promise<void> {
  await Promise.all([stopOffscreen(), stopNativeTab()]);
  await setPlaybackState({ status: "idle" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
