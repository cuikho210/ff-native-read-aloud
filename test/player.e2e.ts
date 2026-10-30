import assert from "node:assert/strict";
import type { Subprocess } from "bun";
import { test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";

const PORT = 8890;
const BASE_URL = `http://localhost:${PORT}/v1`;

interface LogEntry {
  status: string;
  message?: string;
  receivedBytes?: number;
}

let server: Subprocess<"ignore", "inherit", "inherit"> | undefined;
let browser: Browser | undefined;

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

async function readLog(page: Page): Promise<LogEntry[]> {
  return page.evaluate(() => (window as unknown as { __log: LogEntry[] }).__log ?? []);
}

async function waitForLog(
  page: Page,
  predicate: (entries: LogEntry[]) => boolean,
  timeoutMs = 30000,
): Promise<LogEntry[]> {
  const start = Date.now();
  let entries: LogEntry[] = [];
  while (Date.now() - start < timeoutMs) {
    entries = await readLog(page);
    if (predicate(entries)) {
      return entries;
    }
    await Bun.sleep(100);
  }
  throw new Error(
    `Timed out waiting for log condition. Last log: ${JSON.stringify(entries)}`,
  );
}

test(
  "streams paragraphs continuously and stops cleanly",
  async () => {
    server = Bun.spawn(["bun", "run", "test/server.ts"], {
      cwd: import.meta.dir + "/..",
      env: { ...process.env, PORT: String(PORT) },
      stdout: "inherit",
      stderr: "inherit",
    });

    try {
      await waitForServer(`http://localhost:${PORT}/harness.html`);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      await page.goto(`http://localhost:${PORT}/harness.html`);
      await page.fill("#base-url", BASE_URL);
      await page.fill("#model", "");
      await page.fill("#voice", "default");
      await page.fill(
        "#texts",
        "First paragraph from the streaming harness.\n\n" +
          "Second paragraph follows the first.\n\n" +
          "Third paragraph finishes the selection.",
      );

      await page.click("#play");
      await waitForLog(page, (entries) =>
        entries.some((entry) => entry.status === "playing"),
      );
      await page.waitForFunction(() =>
        document.querySelector("#log")?.textContent?.includes("play resolved"),
      );

      const logText = await page.textContent("#log");
      assert.ok(logText, "expected a page log");
      assert.ok(
        logText.indexOf('"status":"playing"') < logText.indexOf("play resolved"),
        "playback must start before the play promise resolves",
      );

      const finished = await waitForLog(page, (entries) => {
        const last = entries.at(-1);
        return (
          last?.status === "idle" &&
          entries.some((entry) => entry.status === "playing")
        );
      });
      const idle = [...finished].reverse().find((entry) => entry.status === "idle");
      assert.ok(
        (idle?.receivedBytes ?? 0) > 0,
        "final idle state must report received audio bytes",
      );

      const longText = Array.from(
        { length: 20 },
        () => "This is a long paragraph used to exercise the stop button.",
      ).join(" ");
      const stopStart = finished.length;
      await page.fill("#texts", longText);
      await page.click("#play");
      await waitForLog(
        page,
        (entries) =>
          entries.slice(stopStart).some((entry) => entry.status === "playing"),
      );
      await page.click("#stop");
      const stopped = await waitForLog(page, (entries) => {
        const recent = entries.slice(stopStart);
        return (
          recent.some((entry) => entry.status === "playing") &&
          recent.at(-1)?.status === "idle"
        );
      });
      assert.ok(
        stopped.slice(stopStart).every((entry) => entry.status !== "error"),
        "stop must not produce an error state",
      );

      const errorStart = stopped.length;
      await page.fill("#voice", "nope");
      await page.click("#play");
      const failed = await waitForLog(page, (entries) =>
        entries
          .slice(errorStart)
          .some(
            (entry) =>
              entry.status === "error" &&
              (entry.message ?? "").includes("unknown voice"),
          ),
      );
      const errorEntry = failed
        .slice(errorStart)
        .find((entry) => entry.status === "error");
      assert.ok(
        (errorEntry?.message ?? "").includes("unknown voice"),
        "bad voice must surface the server message",
      );
    } finally {
      await browser?.close();
      server?.kill();
    }
  },
  180000,
);
