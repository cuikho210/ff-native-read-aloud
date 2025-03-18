import type { SimpleServerReadAloudOptions } from "./types.d";
import { loadPlaybackRate, loadSpeakerId } from "./store";
import { sleep } from "./utils";

let abortController: AbortController | null = null;

export async function readSequentially(texts: string[], gapInMs = 500) {
  const options: SimpleServerReadAloudOptions = {
    speed: await loadPlaybackRate(),
    sid: await loadSpeakerId(),
  };

  for (const text of texts) {
    await readAloud(text, options);
    await sleep(gapInMs);
  }
}

export async function readAloud(
  text: string,
  options: SimpleServerReadAloudOptions,
) {
  if (abortController) {
    abortController.abort("Aborted due to a new request");
    abortController = null;
  }

  const body = {
    sid: options.sid,
    speed: options.speed,
    content: text,
  };

  abortController = new AbortController();

  try {
    await fetch(options.url || "http://localhost:3001/speak", {
      method: "POST",
      body: JSON.stringify(body),
      signal: abortController.signal,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    console.error(e);
  }

  abortController = null;
}
