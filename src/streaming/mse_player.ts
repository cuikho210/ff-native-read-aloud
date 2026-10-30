import {
  buildAuthHeaders,
  buildSpeechBody,
  responseErrorMessage,
  speechUrl,
} from "../openai_tts";
import type { OpenAiConfig, PlayerState } from "../types";

interface Session {
  generation: number;
  controller: AbortController;
  mediaSource: MediaSource;
  objectUrl: string;
  receivedBytes: number;
  started: boolean;
}

export class MseStreamPlayer {
  private session: Session | null = null;
  private generation = 0;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly onState?: (state: PlayerState) => void,
  ) {}

  async play(texts: string[], config: OpenAiConfig): Promise<void> {
    this.reset(false);

    if (texts.length === 0) {
      this.emit({ status: "idle" });
      return;
    }

    if (!MediaSource.isTypeSupported("audio/mpeg")) {
      this.emit({
        status: "error",
        message: "This browser cannot stream MP3 audio through MediaSource",
      });
      return;
    }

    const generation = ++this.generation;
    const controller = new AbortController();
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    const session: Session = {
      generation,
      controller,
      mediaSource,
      objectUrl,
      receivedBytes: 0,
      started: false,
    };
    this.session = session;

    this.audio.volume = Math.min(1, Math.max(0, config.volume));
    this.emit({ status: "loading" });

    try {
      this.audio.src = objectUrl;
      await waitForSourceOpen(mediaSource, controller.signal);
      this.assertCurrent(session);

      const sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");

      void this.audio.play().catch(() => {});

      for (const text of texts) {
        this.assertCurrent(session);

        const response = await fetch(speechUrl(config.baseUrl), {
          method: "POST",
          headers: {
            ...buildAuthHeaders(config.apiKey),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildSpeechBody(text, config)),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await responseErrorMessage(response));
        }
        if (!response.body) {
          throw new Error("empty audio response");
        }

        const reader = response.body.getReader();
        let wroteBytes = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            this.assertCurrent(session);
            if (done) {
              break;
            }
            if (!value || value.byteLength === 0) {
              continue;
            }

            await appendChunk(sourceBuffer, value, controller.signal);
            this.assertCurrent(session);

            session.receivedBytes += value.byteLength;
            wroteBytes = true;

            if (!session.started) {
              session.started = true;
              void this.audio.play().catch(() => {});
              this.emit({
                status: "playing",
                receivedBytes: session.receivedBytes,
              });
            }
          }
        } finally {
          reader.releaseLock();
        }

        if (!wroteBytes) {
          throw new Error("empty audio response");
        }
      }

      this.assertCurrent(session);
      mediaSource.endOfStream();
      await waitForEnded(this.audio, controller.signal);
      this.assertCurrent(session);

      const receivedBytes = session.receivedBytes;
      this.dispose(session);
      this.emit({ status: "idle", receivedBytes });
    } catch (error) {
      if (session.generation !== this.generation) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      const receivedBytes = session.receivedBytes;
      this.dispose(session);
      this.emit({ status: "error", message, receivedBytes });
    }
  }

  stop(): void {
    const session = this.session;
    this.generation += 1;
    if (session) {
      this.dispose(session);
    }
    this.emit({ status: "idle", receivedBytes: session?.receivedBytes });
  }

  private reset(emitIdle: boolean): void {
    const session = this.session;
    this.generation += 1;
    if (session) {
      this.dispose(session);
    }
    if (emitIdle) {
      this.emit({ status: "idle", receivedBytes: session?.receivedBytes });
    }
  }

  private assertCurrent(session: Session): void {
    if (session.generation !== this.generation || this.session !== session) {
      throw new DOMException("Playback stopped", "AbortError");
    }
  }

  private dispose(session: Session): void {
    if (this.session === session) {
      this.session = null;
    }

    session.controller.abort();

    try {
      if (session.mediaSource.readyState === "open") {
        session.mediaSource.endOfStream();
      }
    } catch {
      // Already closed or detached.
    }

    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    URL.revokeObjectURL(session.objectUrl);
  }

  private emit(state: PlayerState): void {
    this.onState?.(state);
  }
}

function waitForSourceOpen(
  mediaSource: MediaSource,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  if (mediaSource.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      mediaSource.removeEventListener("sourceopen", onOpen);
      mediaSource.removeEventListener("sourceclose", onClose);
      signal.removeEventListener("abort", onAbort);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("MediaSource closed before it opened"));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    mediaSource.addEventListener("sourceopen", onOpen);
    mediaSource.addEventListener("sourceclose", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function appendChunk(
  sourceBuffer: SourceBuffer,
  chunk: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      sourceBuffer.removeEventListener("error", onError);
      sourceBuffer.removeEventListener("abort", onBufferAbort);
      signal.removeEventListener("abort", onAbort);
    };
    const onUpdateEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("SourceBuffer failed while appending audio"));
    };
    const onBufferAbort = () => {
      cleanup();
      reject(new Error("SourceBuffer aborted the audio append"));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    sourceBuffer.addEventListener("updateend", onUpdateEnd);
    sourceBuffer.addEventListener("error", onError);
    sourceBuffer.addEventListener("abort", onBufferAbort);
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function waitForEnded(
  audio: HTMLAudioElement,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  if (audio.ended) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(audio.error?.message ?? "Audio playback failed"));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): DOMException {
  return new DOMException("Playback stopped", "AbortError");
}
