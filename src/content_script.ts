import type { BackgroundMessage } from "./messages";
import { speakNative, stopNative } from "./native_tts";
import { driverSetting, loadNativeSettings } from "./settings";
import type { NativeVoiceSettings, PlayerState } from "./types";

export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function sendBackground(message: BackgroundMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

let nativeStartGeneration = 0;

export function invalidateNativeStart(): void {
  nativeStartGeneration += 1;
}

export interface NativeStartDeps {
  requestStart: () => Promise<unknown>;
  loadSettings: () => Promise<NativeVoiceSettings>;
  speak: (
    texts: string[],
    settings: NativeVoiceSettings,
    onState?: (state: PlayerState) => void,
  ) => Promise<void>;
}

function rejectedStart(response: unknown): boolean {
  return (
    typeof response === "object" &&
    response !== null &&
    (response as { ok?: unknown }).ok === false
  );
}

export async function startNativeReading(
  texts: string[],
  deps: NativeStartDeps = {
    requestStart: () =>
      sendBackground({ target: "background", type: "native:start" }),
    loadSettings: loadNativeSettings,
    speak: speakNative,
  },
): Promise<void> {
  const generation = ++nativeStartGeneration;

  const response = await deps.requestStart();
  if (rejectedStart(response) || generation !== nativeStartGeneration) {
    return;
  }

  const settings = await deps.loadSettings();
  if (generation !== nativeStartGeneration) {
    return;
  }

  await deps.speak(texts, settings, reportNativeState);
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
    invalidateNativeStart();
    void sendBackground({ target: "background", type: "tts:start", texts });
    return;
  }

  await startNativeReading(texts);
}

if (typeof window !== "undefined" && typeof chrome !== "undefined") {
  document.documentElement.dataset.simpleReadaloud = "ready";

  window.addEventListener("keydown", (event) => {
    void handleKeydown(event);
  });

  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === "stop-native") {
      invalidateNativeStart();
      stopNative();
      reportNativeState({ status: "idle" });
    }
  });

  window.addEventListener("pagehide", () => {
    invalidateNativeStart();
    stopNative();
    reportNativeState({ status: "idle" });
  });
}
