import type { BackgroundMessage } from "./messages";
import { speakNative, stopNative } from "./native_tts";
import { driverSetting, loadNativeSettings } from "./settings";
import type { PlayerState } from "./types";

export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function sendBackground(message: BackgroundMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

function reportNativeState(state: PlayerState): void {
  void sendBackground({ target: "background", type: "native:state", state });
}

function readSelection(): string[] {
  const selection = window.getSelection()?.toString() ?? "";
  return splitIntoParagraphs(selection);
}

async function handleKeydown(event: KeyboardEvent): Promise<void> {
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (event.key.toLowerCase() !== "a") {
    return;
  }

  const texts = readSelection();
  if (texts.length === 0) {
    return;
  }
  event.preventDefault();

  const driver = await driverSetting.get();
  if (driver === "openai") {
    void sendBackground({ target: "background", type: "tts:start", texts });
    return;
  }

  await sendBackground({ target: "background", type: "native:start" });
  const settings = await loadNativeSettings();
  await speakNative(texts, settings, reportNativeState);
}

if (typeof window !== "undefined" && typeof chrome !== "undefined") {
  document.documentElement.dataset.simpleReadaloud = "ready";

  window.addEventListener("keydown", (event) => {
    void handleKeydown(event);
  });

  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === "stop-native") {
      stopNative();
      reportNativeState({ status: "idle" });
    }
  });

  window.addEventListener("pagehide", () => {
    stopNative();
    reportNativeState({ status: "idle" });
  });
}
