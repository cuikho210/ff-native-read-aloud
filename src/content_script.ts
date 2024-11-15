window.addEventListener("keydown", (event) => {
  if (event.shiftKey && event.key === "A") {
    const text = getSelectedText().trim();
    if (!text) return;

    const texts = splitTextIntoParagraphs(text);
    readSequentially(texts);
  }
});

const synth = window.speechSynthesis;

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
  for (const text of texts) {
    await readAloud(text);
    await sleep(gapInMs);
  }
}

function readAloud(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (synth.speaking) {
      synth.cancel();
    }

    const utter = new SpeechSynthesisUtterance(text);

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
