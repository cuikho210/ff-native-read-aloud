import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { PlaybackState } from "../src/types";

const DIST = resolve(import.meta.dir, "..", "dist");

export interface ExtensionSession {
  context: BrowserContext;
  extensionId: string;
  popup: Page;
  close(): Promise<void>;
}

export async function launchExtension(): Promise<ExtensionSession> {
  const profile = await mkdtemp(join(tmpdir(), "simple-readaloud-e2e-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
    ],
  });

  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const extensionId = new URL(worker.url()).host;

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/controller.html`);

    return {
      context,
      extensionId,
      popup,
      close: async () => {
        await context.close();
        await rm(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context.close();
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

export async function getState(page: Page): Promise<PlaybackState | undefined> {
  return page.evaluate(async () => {
    const values = await chrome.storage.session.get("playback-state");
    return values["playback-state"] as PlaybackState | undefined;
  });
}

export async function waitForState(
  page: Page,
  predicate: (state: PlaybackState | undefined) => boolean,
  timeoutMs = 15000,
): Promise<PlaybackState> {
  const start = Date.now();
  let state: PlaybackState | undefined;
  while (Date.now() - start < timeoutMs) {
    state = await getState(page);
    if (state && predicate(state)) {
      return state;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for playback state. Last state: ${JSON.stringify(state)}`,
  );
}

export async function waitForStatus(
  page: Page,
  status: PlaybackState["status"],
  timeoutMs = 15000,
): Promise<PlaybackState> {
  return waitForState(page, (state) => state?.status === status, timeoutMs);
}

test(
  "streams through the service worker and offscreen document",
  async () => {
    const extension = await launchExtension();
    try {
      await extension.popup.evaluate(() =>
        chrome.runtime.sendMessage({
          target: "background",
          type: "tts:start",
          texts: ["Hello from the backend smoke test."],
        }),
      );

      const playing = await waitForStatus(extension.popup, "playing");
      assert.ok(
        (playing.receivedBytes ?? 0) > 0,
        "playing state must report received audio bytes",
      );

      await extension.popup.evaluate(() =>
        chrome.runtime.sendMessage({ target: "background", type: "tts:stop" }),
      );
      await waitForStatus(extension.popup, "idle");
    } finally {
      await extension.close();
    }
  },
  120000,
);
