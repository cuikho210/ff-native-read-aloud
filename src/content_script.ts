import { readSequentially as nativeReadSequentially } from "./native_read_aloud";
import { readSequentially as simpleServerReadSequentially } from "./simple_server_read_aloud";
import { loadDriver } from "./store";
import { ReadAloudDriver } from "./types";

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
        readAloud(texts);
        console.log("Started read-aloud", texts);
      }
    });
  } catch (e) {
    console.error("[listenShortcutEvent]", e);
  }
}

async function readAloud(texts: string[]) {
  const driver = await loadDriver();

  if (driver == ReadAloudDriver.SimpleServer) {
    simpleServerReadSequentially(texts);
  } else {
    nativeReadSequentially(texts);
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
