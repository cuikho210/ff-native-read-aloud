import {
  loadPitch,
  loadPlaybackRate,
  loadVoiceIndex,
  loadVolume,
} from "./store";

interface ReadAloudOptions {
  volume: number;
  pitch: number;
  rate: number;
  voice: SpeechSynthesisVoice;
}

const synth = window.speechSynthesis;
main();

function main() {
  console.log("[native-read-aloud] Content script initialized");
  listenCurrentWindow();
  listenCurrentIframes();
  listenFutureIframes();
}

function listenCurrentWindow() {
  listenShortcutEvent(window);
}

function listenCurrentIframes() {
  const iframes = window.document.getElementsByTagName("iframe");
  console.log("[native-read-aloud] Found", iframes.length, "iframes");
  for (let i = 0; i < iframes.length; i++) {
    const iWindow = iframes[i].contentWindow;
    if (iWindow) {
      listenShortcutEvent(iWindow);
      console.log(
        "[native-read-aloud] Started listening to iframe ",
        i,
        iWindow,
      );
    } else console.log("[native-read-aloud] Iframe", i, "window is null");
  }
}

function listenFutureIframes() {
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === "IFRAME") {
            const iWindow = (node as HTMLIFrameElement).contentWindow;
            if (iWindow) {
              listenShortcutEvent(iWindow);
              console.log(
                "[native-read-aloud] Started listening to iframe ",
                node,
              );
            } else console.log("[native-read-aloud] New iframe window is null");
          }
        });
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function listenShortcutEvent(w: Window) {
  try {
    w.addEventListener("keydown", (event) => {
      if (event.shiftKey && event.key === "A") {
        const text = getSelectedText().trim();
        if (!text) return console.log("Rejected by text:", text);

        const texts = splitTextIntoParagraphs(text);
        readSequentially(texts);
        console.log("Started read-aloud", texts);
      }
    });
  } catch (e) {
    console.error("[listenShortcutEvent]", e);
  }
}

function getSelectedText() {
  const selection = window.getSelection();
  return selection ? selection.toString() : "";
}

function splitTextIntoParagraphs(text: string): string[] {
  const paragraphs = text.split("\n\n");
  return paragraphs
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

async function readSequentially(texts: string[], gapInMs = 500) {
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

function readAloud(text: string, options?: ReadAloudOptions): Promise<void> {
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

function sleep(durInMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), durInMs);
  });
}
