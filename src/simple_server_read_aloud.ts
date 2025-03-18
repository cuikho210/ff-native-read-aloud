import type { SimpleServerReadAloudOptions } from "./types";
import { loadPlaybackRate, loadSpeakerId } from "./store";
import { sleep } from "bun";

const abortController = new AbortController();
let isFetching = false;

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
  if (isFetching) {
    abortController.abort("Aborted due to a new request");
  }

  const body = {
    sid: options.sid,
    speed: options.speed,
    content: text,
  };

  isFetching = true;

  try {
    await fetch(options.url || "http://localhost:3001/speak", {
      method: "POST",
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } catch (e) {
    console.error(e);
  }

  isFetching = false;
}
