import type { OpenAiConfig, PlayerState } from "./types";

export type BackgroundMessage =
  | { target: "background"; type: "native:start" }
  | { target: "background"; type: "native:state"; state: PlayerState }
  | { target: "background"; type: "tts:start"; texts: string[] }
  | { target: "background"; type: "tts:stop" }
  | { target: "background"; type: "playback:state"; state: PlayerState };

export type OffscreenMessage =
  | { target: "offscreen"; type: "ping" }
  | { target: "offscreen"; type: "tts:start"; texts: string[]; config: OpenAiConfig }
  | { target: "offscreen"; type: "tts:stop" };
