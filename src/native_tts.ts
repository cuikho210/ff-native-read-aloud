import type { NativeVoiceSettings, PlayerState } from "./types";

let generation = 0;

export function stopNative(): void {
  generation += 1;
  window.speechSynthesis.cancel();
}

export async function speakNative(
  texts: string[],
  settings: NativeVoiceSettings,
  onState?: (state: PlayerState) => void,
): Promise<void> {
  stopNative();
  const myGeneration = generation;

  const synthesis = window.speechSynthesis;
  const voice =
    synthesis.getVoices().find((item) => item.voiceURI === settings.voiceUri) ??
    null;

  if (texts.length === 0) {
    onState?.({ status: "idle" });
    return;
  }

  onState?.({ status: "playing" });

  try {
    for (const text of texts) {
      if (myGeneration !== generation) {
        return;
      }
      await speakOne(text, settings, voice);
    }
  } catch (error) {
    if (myGeneration !== generation) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    onState?.({ status: "error", message });
    return;
  }

  if (myGeneration === generation) {
    onState?.({ status: "idle" });
  }
}

function speakOne(
  text: string,
  settings: NativeVoiceSettings,
  voice: SpeechSynthesisVoice | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);

    if (voice) {
      utterance.voice = voice;
    }
    utterance.volume = clamp(settings.volume, 0, 1);
    utterance.rate = clamp(settings.rate, 0.1, 10);
    utterance.pitch = clamp(settings.pitch, 0, 2);
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      reject(new Error(event.error || "Speech synthesis failed"));
    };

    window.speechSynthesis.speak(utterance);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
