import type { ReadAloudOptions } from "./types";
import {
  loadPitch,
  loadPlaybackRate,
  loadVoiceIndex,
  loadVolume,
} from "./store";
import { sleep } from "bun";

const synth = window.speechSynthesis;

export async function readSequentially(texts: string[], gapInMs = 500) {
  const volume = await loadVolume();
  const pitch = await loadPitch();
  const rate = await loadPlaybackRate();
  const voiceIndex = await loadVoiceIndex();
  const voice = synth.getVoices()[voiceIndex || 0];
  const options: ReadAloudOptions = {
    voice,
    volume,
    rate,
    pitch,
  };

  for (const text of texts) {
    await readAloud(text, options);
    await sleep(gapInMs);
  }
}

export function readAloud(
  text: string,
  options?: ReadAloudOptions,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    if (synth.speaking) {
      synth.cancel();
    }

    const utter = new SpeechSynthesisUtterance(text);

    if (options) {
      utter.pitch = options.pitch;
      utter.rate = options.rate;
      utter.volume = options.volume;
      utter.voice = options.voice;
    }

    utter.onend = function () {
      resolve();
    };

    utter.onerror = function (event) {
      reject(event);
    };

    synth.speak(utter);
  });
}
