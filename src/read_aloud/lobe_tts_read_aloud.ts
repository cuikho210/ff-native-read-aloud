import { EdgeSpeechTTS } from "@lobehub/tts";
import { lobeTtsEdgeVoiceStore } from "../store";
import { AudioBufferQueue } from "../audio_buffer_queue";

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
const queue = new AudioBufferQueue();

export async function readSequentially(texts: string[]) {
  if (abortController) {
    abortController.abort("Aborted due to a new request");
  }
  abortController = new AbortController();
  abortController.signal.onabort = () => queue.stop();
  queue.stop();

  fetchTtsSequentially(abortController, texts, (buffer) => {
    queue.enqueue(buffer);
  });
}

async function fetchTtsSequentially(
  abortController: AbortController,
  texts: string[],
  onFetched: (buffer: ArrayBuffer) => void,
) {
  const voice = (await lobeTtsEdgeVoiceStore.get()) ?? lobeTtsEdgeVoices[0];
  const tts = new EdgeSpeechTTS({ locale: "en-US" });
  for (const input of texts) {
    if (abortController.signal.aborted) return;

    try {
      const response = await tts.create({ input, options: { voice } });
      const arrayBuffer = await response.arrayBuffer();
      if (abortController.signal.aborted) return;
      onFetched(arrayBuffer);
    } catch (error) {
      console.error(error);
    }
  }
}
