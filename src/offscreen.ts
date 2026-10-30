import type { BackgroundMessage, OffscreenMessage } from "./messages";
import { MseStreamPlayer } from "./streaming/mse_player";

const audio = document.querySelector<HTMLAudioElement>("#player")!;

const player = new MseStreamPlayer(audio, (state) => {
  void chrome.runtime
    .sendMessage({
      target: "background",
      type: "playback:state",
      state,
    } satisfies BackgroundMessage)
    .catch(() => {});
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    const typed = message as OffscreenMessage | undefined;
    if (typed?.target !== "offscreen") {
      return;
    }

    switch (typed.type) {
      case "ping":
        sendResponse({ ok: true });
        return true;
      case "tts:start":
        player.stop();
        void player.play(typed.texts, typed.config);
        return;
      case "tts:stop":
        player.stop();
        return;
    }
  },
);
