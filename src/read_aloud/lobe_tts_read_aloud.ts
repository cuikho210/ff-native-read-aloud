import { EdgeSpeechTTS, type EdgeSpeechPayload } from "@lobehub/tts";
import { sleep } from "../utils";
import { lobeTtsEdgeVoiceStore } from "../store";

export const lobeTtsEdgeVoices = [
  "en-US-AriaNeural",
  "en-US-AnaNeural",
  "en-US-ChristopherNeural",
  "en-US-EricNeural",
  "en-US-GuyNeural",
  "en-US-JennyNeural",
  "en-US-MichelleNeural",
  "en-US-RogerNeural",
  "en-US-SteffanNeural",
];

let abortController: AbortController | null = null;

export async function readSequentially(texts: string[], gapInMs = 100) {
  const voice = (await lobeTtsEdgeVoiceStore.get()) ?? lobeTtsEdgeVoices[0];
  const tts = new EdgeSpeechTTS({ locale: "en-US" });
  const options: EdgeSpeechPayload["options"] = {
    voice,
  };

  if (abortController) {
    abortController.abort("Aborted due to a new request");
  }

  abortController = new AbortController();

  for (const text of texts) {
    await readAloud(tts, text, options, abortController);
    await sleep(gapInMs);
  }
}

export async function readAloud(
  tts: EdgeSpeechTTS,
  text: string,
  options: EdgeSpeechPayload["options"],
  abortController: AbortController,
) {
  const payload: EdgeSpeechPayload = {
    input: text,
    options,
  };

  try {
    const response = await tts.create(payload);
    const arrayBuffer = await response.arrayBuffer();
    await playAudioBuffer(arrayBuffer, abortController);
  } catch (e) {
    console.error(e);
  }
}

export async function playAudioBuffer(
  arrayBuffer: ArrayBuffer,
  abortController: AbortController,
) {
  const audioContext = new window.AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);

  await new Promise<void>((resolve) => {
    const handleEnded = () => {
      // Clean up the abort listener once audio ends naturally
      abortController.signal.removeEventListener("abort", handleAbort);
      audioContext.close(); // Close the audio context when done
      resolve();
    };

    const handleAbort = () => {
      source.stop(); // Stop the audio playback immediately
      // Clean up the ended listener once audio is aborted
      source.removeEventListener("ended", handleEnded);
      audioContext.close(); // Close the audio context on abort
      resolve(); // Resolve the promise to unblock the sequence
    };

    // Add event listeners
    source.addEventListener("ended", handleEnded);
    abortController.signal.addEventListener("abort", handleAbort);

    // Start playing the audio
    source.start(0);

    // If the abort signal was already triggered before the audio even started,
    // ensure the promise resolves immediately.
    if (abortController.signal.aborted) {
      handleAbort();
    }
  });
}
