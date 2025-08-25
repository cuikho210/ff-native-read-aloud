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

export async function readSequentially(texts: string[], gapInMs = 500) {
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

  abortController.signal.onabort = () => {
    source.stop();
  };

  source.start(0);
}
