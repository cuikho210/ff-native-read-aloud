import { MseStreamPlayer } from "../src/streaming/mse_player";
import type { OpenAiConfig, PlayerState } from "../src/types";

declare global {
  interface Window {
    __log: PlayerState[];
    __player: MseStreamPlayer | null;
  }
}

const audio = new Audio();
const logEl = document.querySelector<HTMLPreElement>("#log")!;
const baseUrl = document.querySelector<HTMLInputElement>("#base-url")!;
const model = document.querySelector<HTMLInputElement>("#model")!;
const voice = document.querySelector<HTMLInputElement>("#voice")!;
const texts = document.querySelector<HTMLTextAreaElement>("#texts")!;

window.__log = [];
window.__player = null;

function logLine(line: string) {
  logEl.textContent += `${line}\n`;
}

document.querySelector("#play")!.addEventListener("click", () => {
  const config: OpenAiConfig = {
    baseUrl: baseUrl.value,
    apiKey: "",
    model: model.value,
    voice: voice.value,
    speed: 1,
    volume: 1,
  };
  const paragraphs = texts.value
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean);

  const player = new MseStreamPlayer(audio, (state) => {
    window.__log.push(state);
    logLine(JSON.stringify(state));
  });
  window.__player = player;

  void player
    .play(paragraphs, config)
    .then(() => logLine("play resolved"))
    .catch((error: unknown) => {
      logLine(`play rejected: ${error instanceof Error ? error.message : String(error)}`);
    });
});

document.querySelector("#stop")!.addEventListener("click", () => {
  window.__player?.stop();
});
