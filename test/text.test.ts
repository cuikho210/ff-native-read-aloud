import { expect, test } from "bun:test";
import { readTexts, splitIntoParagraphs, startNativeReading } from "../src/content_script";

test("splits on blank lines and trims", () => {
  expect(splitIntoParagraphs("  one  \n\n two \n\n\n")).toEqual(["one", "two"]);
});

test("keeps single newlines inside a paragraph", () => {
  expect(splitIntoParagraphs("line one\nline two\n\nnext")).toEqual([
    "line one\nline two",
    "next",
  ]);
});

test("drops empty input", () => {
  expect(splitIntoParagraphs(" \n\n ")).toEqual([]);
});

test("an empty selection starts nothing", async () => {
  let started = 0;
  const deps = {
    getDriver: async () => "openai" as const,
    startNative: async () => {
      started += 1;
    },
    startOpenAi: () => {
      started += 1;
    },
  };
  await readTexts([], deps);
  expect(started).toBe(0);
});

test("the native driver speaks through startNative", async () => {
  const spoken: string[][] = [];
  let openAiCalls = 0;
  await readTexts(["hello"], {
    getDriver: async () => "native",
    startNative: async (texts) => {
      spoken.push(texts);
    },
    startOpenAi: () => {
      openAiCalls += 1;
    },
  });
  expect(spoken).toEqual([["hello"]]);
  expect(openAiCalls).toBe(0);
});

test("the openai driver streams through startOpenAi and cancels pending native speech", async () => {
  const openAiTexts: string[][] = [];
  let released!: () => void;
  const pending = new Promise<void>((resolve) => {
    released = resolve;
  });
  let spoke = 0;

  const stalling = startNativeReading(["stale"], {
    requestStart: () => pending,
    loadSettings: async () => ({ voiceUri: "", volume: 1, rate: 1, pitch: 1 }),
    speak: async () => {
      spoke += 1;
    },
  });

  await readTexts(["hello"], {
    getDriver: async () => "openai",
    startNative: async () => {
      spoke += 1;
    },
    startOpenAi: (texts) => {
      openAiTexts.push(texts);
    },
  });
  released();
  await stalling;

  expect(openAiTexts).toEqual([["hello"]]);
  expect(spoke).toBe(0);
});
