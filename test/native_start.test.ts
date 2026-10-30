import { expect, test } from "bun:test";
import {
  invalidateNativeStart,
  startNativeReading,
  type NativeStartDeps,
} from "../src/content_script";
import type { NativeVoiceSettings } from "../src/types";

const settings: NativeVoiceSettings = {
  voiceUri: "",
  volume: 1,
  rate: 1,
  pitch: 1,
};

function deps(
  requestStart: Promise<void>,
  speak: (texts: string[]) => Promise<void>,
): NativeStartDeps {
  return {
    requestStart: () => requestStart,
    loadSettings: async () => settings,
    speak,
  };
}

test("Stop during a pending native request prevents speech", async () => {
  let release!: () => void;
  const requestStart = new Promise<void>((resolve) => {
    release = resolve;
  });
  let spoke = 0;

  const start = startNativeReading(
    ["hello"],
    deps(requestStart, async () => {
      spoke += 1;
    }),
  );

  invalidateNativeStart();
  release();
  await start;

  expect(spoke).toBe(0);
});

test("a newer native start supersedes an older pending one", async () => {
  let releaseFirst!: () => void;
  const firstRequest = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const spoken: string[][] = [];

  const first = startNativeReading(
    ["first"],
    deps(firstRequest, async (texts) => {
      spoken.push(texts);
    }),
  );
  await startNativeReading(
    ["second"],
    deps(Promise.resolve(), async (texts) => {
      spoken.push(texts);
    }),
  );

  releaseFirst();
  await first;

  expect(spoken).toEqual([["second"]]);
});
