import assert from "node:assert/strict";
import type { Subprocess } from "bun";
import { test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { PlaybackState } from "../src/types";

const ROOT = resolve(import.meta.dir, "..");
const DIST = resolve(ROOT, "dist");
const TEST_PORT = 8890;
const PAGE_URL = `http://localhost:${TEST_PORT}/page.html`;
const TTS_URL = "http://localhost:8880/v1";

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
  timeoutMs = 20000,
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
  timeoutMs = 20000,
): Promise<PlaybackState> {
  return waitForState(page, (state) => state?.status === status, timeoutMs);
}

export async function waitForSetting(
  page: Page,
  key: string,
  value: unknown,
): Promise<void> {
  await page.waitForFunction(
    async ({ key, value }) => {
      const stored = await chrome.storage.local.get(key);
      return stored[key] === value;
    },
    { key, value },
    { timeout: 5000 },
  );
}

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Server did not start at ${url}`);
}

async function startPageServer(): Promise<Subprocess<"ignore", "inherit", "inherit">> {
  const server = Bun.spawn(["bun", "run", "test/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdout: "inherit",
    stderr: "inherit",
  });
  await waitForServer(PAGE_URL, 20000);
  return server;
}

async function waitForSpeechServerIdle(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  let last = "no response";
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch("http://localhost:8880/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: "probe",
          voice: "__readaloud_idle_probe__",
          response_format: "mp3",
        }),
      });
      const text = await response.text();
      if (response.status === 400 && text.includes("unknown voice")) {
        return;
      }
      last = `HTTP ${response.status}: ${text}`;
    } catch (error) {
      last = String(error);
    }
    await Bun.sleep(100);
  }
  throw new Error(`TTS server stayed busy: ${last}`);
}

async function selectParagraph(page: Page): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => {
    const paragraph = document.querySelector("#paragraph")!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function recordStateHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { __stateHistory: unknown[] };
    target.__stateHistory = [];
    chrome.storage.onChanged.addListener((changes, areaName) => {
      const change = changes["playback-state"];
      if (areaName === "session" && change?.newValue) {
        target.__stateHistory.push(change.newValue);
      }
    });
  });
}

async function readStateHistory(page: Page): Promise<PlaybackState[]> {
  return page.evaluate(
    () => (window as unknown as { __stateHistory: PlaybackState[] }).__stateHistory,
  );
}

test(
  "full extension flow",
  async () => {
    let server: Subprocess<"ignore", "inherit", "inherit"> | undefined;
    let extension: ExtensionSession | undefined;

    try {
      server = await startPageServer();
      extension = await launchExtension();
      const { popup, context } = extension;

      const consoleErrors: string[] = [];
      popup.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      popup.on("pageerror", (error) => consoleErrors.push(String(error)));

      await popup.locator("h1").waitFor();

      await popup.getByRole("tab", { name: "OpenAI-compatible" }).click();
      await waitForSetting(popup, "driver", "openai");
      await popup.fill("#openai-base-url", TTS_URL);
      await waitForSetting(popup, "openai-base-url", TTS_URL);
      await popup.click("#refresh");
      await popup.waitForFunction(
        async () => {
          const stored = await chrome.storage.local.get([
            "openai-model",
            "openai-voice",
          ]);
          return (
            stored["openai-model"] === "gradium/phonon-31m-en" &&
            typeof stored["openai-voice"] === "string" &&
            stored["openai-voice"].length > 0
          );
        },
        undefined,
        { timeout: 15000 },
      );
      await popup.waitForFunction(
        () =>
          (document.querySelector("#openai-voice") as HTMLInputElement | null)
            ?.value.length ?? 0,
        undefined,
        { timeout: 5000 },
      );
      const discoveredVoice = await popup.inputValue("#openai-voice");
      assert.ok(discoveredVoice.length > 0, "expected a discovered voice");

      await popup.click("#test-voice");
      const preview = await waitForState(
        popup,
        (state) => state?.status === "playing",
      );
      assert.equal(preview.driver, "openai");
      assert.ok(
        (preview.receivedBytes ?? 0) > 0,
        "preview must stream audio bytes",
      );
      await popup.click("#stop");
      await waitForStatus(popup, "idle");
      await waitForSpeechServerIdle();

      const page = await context.newPage();
      await page.goto(PAGE_URL);
      await page.waitForFunction(
        () => document.documentElement.dataset.simpleReadaloud === "ready",
        undefined,
        { timeout: 10000 },
      );
      await selectParagraph(page);
      await page.keyboard.press("Shift+A");
      const fromContentScript = await waitForState(
        popup,
        (state) => state?.status === "playing",
      );
      assert.equal(fromContentScript.driver, "openai");
      assert.ok(
        (fromContentScript.receivedBytes ?? 0) > 0,
        "content script must stream audio bytes",
      );
      await popup.click("#stop");
      await waitForStatus(popup, "idle");
      await waitForSpeechServerIdle();

      await popup.fill("#openai-voice", "nope");
      await waitForSetting(popup, "openai-voice", "nope");
      await popup.click("#test-voice");
      const failure = await waitForState(
        popup,
        (state) => state?.status === "error",
      );
      assert.match(failure.message ?? "", /unknown voice/);

      await popup.fill("#openai-voice", discoveredVoice);
      await waitForSetting(popup, "openai-voice", discoveredVoice);
      await recordStateHistory(popup);
      await popup.click("#test-voice");
      await popup.click("#test-voice");
      const raced = await waitForState(
        popup,
        (state) => state?.status === "playing",
      );
      assert.equal(raced.driver, "openai");
      await Bun.sleep(300);
      const history = await readStateHistory(popup);
      assert.ok(
        !history.some(
          (state) =>
            state.status === "error" &&
            /Only a single offscreen document/i.test(state.message ?? ""),
        ),
        "double start must not race offscreen creation",
      );
      await popup.click("#stop");
      await waitForStatus(popup, "idle");

      await popup.getByRole("tab", { name: "Native" }).click();
      await waitForSetting(popup, "driver", "native");

      const nativeAvailable = await popup.evaluate(
        () =>
          typeof window.speechSynthesis !== "undefined" &&
          window.speechSynthesis.getVoices().length > 0,
      );

      if (nativeAvailable) {
        await selectParagraph(page);
        await page.keyboard.press("Shift+A");
        const nativeState = await waitForState(
          popup,
          (state) =>
            state?.driver === "native" &&
            (state.status === "loading" || state.status === "playing"),
        );
        assert.equal(nativeState.driver, "native");
        await popup.click("#stop");
        await waitForStatus(popup, "idle");

        await selectParagraph(page);
        await page.keyboard.press("Shift+A");
        await waitForState(
          popup,
          (state) =>
            state?.driver === "native" &&
            (state.status === "loading" || state.status === "playing"),
        );
        await page.close();
        await popup.click("#stop");
        await waitForStatus(popup, "idle");
      } else {
        console.log(
          "speechSynthesis unavailable; verifying the native message path only",
        );
        await popup.evaluate(() =>
          chrome.runtime.sendMessage({
            target: "background",
            type: "native:start",
          }),
        );
        await waitForState(
          popup,
          (state) => state?.driver === "native",
          5000,
        );
        await popup.click("#stop");
        await waitForStatus(popup, "idle");

        await popup.evaluate(async () => {
          await chrome.storage.session.set({ "active-native-tab": 999999999 });
          await chrome.runtime.sendMessage({
            target: "background",
            type: "tts:stop",
          });
        });
        await waitForStatus(popup, "idle");
      }

      assert.ok(
        !consoleErrors.some((text) =>
          /Only a single offscreen document/i.test(text),
        ),
        `unexpected offscreen race error: ${consoleErrors.join(" | ")}`,
      );
    } finally {
      await extension?.close();
      server?.kill();
    }
  },
  240000,
);
