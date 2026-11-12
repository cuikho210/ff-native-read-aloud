import { beforeEach, expect, test } from "bun:test";
import type { PlaybackState } from "../src/types";

interface SentMessage {
  target?: string;
  type?: string;
}

const localData = new Map<string, unknown>();
const sessionData = new Map<string, unknown>();
let sent: SentMessage[] = [];
let hasDocument = false;
let createDocumentCalls = 0;
let createDocumentGate: Promise<void> = Promise.resolve();
let createdMenus: unknown[] = [];
let tabMessages: {
  tabId: number;
  message: SentMessage;
  options?: { frameId?: number };
}[] = [];
let menuListener: ((info: any, tab?: any) => void) | undefined;
let sendMessageImpl: (
  tabId: number,
  message: SentMessage,
  options?: { frameId?: number },
) => Promise<unknown> = async () => undefined;

function makeArea(data: Map<string, unknown>) {
  return {
    async get(keys: string | string[] | Record<string, unknown> | null) {
      if (keys === null || keys === undefined) {
        return Object.fromEntries(data);
      }
      if (typeof keys === "string") {
        return data.has(keys) ? { [keys]: data.get(keys) } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)]),
        );
      }
      return {
        ...keys,
        ...Object.fromEntries(
          Object.keys(keys)
            .filter((key) => data.has(key))
            .map((key) => [key, data.get(key)]),
        ),
      };
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) {
        data.set(key, value);
      }
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        data.delete(key);
      }
    },
    async clear() {
      data.clear();
    },
  };
}

const fakeChrome = {
  runtime: {
    onMessage: {
      addListener() {},
      removeListener() {},
    },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    async sendMessage(message: SentMessage) {
      sent.push(message);
      if (message.target === "offscreen" && message.type === "ping") {
        return { ok: true };
      }
      return undefined;
    },
  },
  contextMenus: {
    removeAll(callback?: () => void) {
      callback?.();
    },
    create(createProperties: {
      id?: string;
      title?: string;
      contexts?: string[];
    }) {
      createdMenus.push(createProperties);
    },
    onClicked: {
      addListener(
        listener: (
          info: { menuItemId: string; frameId?: number },
          tab?: { id?: number },
        ) => void,
      ) {
        menuListener = listener;
      },
    },
  },
  storage: {
    local: makeArea(localData),
    session: makeArea(sessionData),
    onChanged: {
      addListener() {},
      removeListener() {},
    },
  },
  offscreen: {
    Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
    async hasDocument() {
      return hasDocument;
    },
    async createDocument() {
      createDocumentCalls += 1;
      await createDocumentGate;
      hasDocument = true;
    },
  },
  tabs: {
    async sendMessage(
      tabId: number,
      message: SentMessage,
      options?: { frameId?: number },
    ) {
      tabMessages.push({ tabId, message, options });
      return sendMessageImpl(tabId, message, options);
    },
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = fakeChrome;

const background = await import("../src/background");

beforeEach(() => {
  sent = [];
  hasDocument = false;
  createDocumentCalls = 0;
  createDocumentGate = Promise.resolve();
  createdMenus = [];
  tabMessages = [];
  sendMessageImpl = async () => undefined;
  localData.clear();
  sessionData.clear();
  background.resetOrchestrationForTests();
});

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function audioStarts(): SentMessage[] {
  return sent.filter(
    (message) => message.target === "offscreen" && message.type === "tts:start",
  );
}

async function playbackState(): Promise<PlaybackState> {
  return sessionData.get("playback-state") as PlaybackState;
}

test("concurrent first starts create only one offscreen document", async () => {
  let release!: () => void;
  createDocumentGate = new Promise((resolve) => {
    release = resolve;
  });

  const first = background.ensureOffscreen();
  const second = background.ensureOffscreen();

  await waitUntil(() => createDocumentCalls > 0);
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(createDocumentCalls).toBe(1);

  release();
  await Promise.all([first, second]);
  expect(hasDocument).toBe(true);
});

test("Stop during a pending start prevents audio from starting", async () => {
  let release!: () => void;
  createDocumentGate = new Promise((resolve) => {
    release = resolve;
  });

  const start = background.handleStart(["hello"]);
  await waitUntil(() => createDocumentCalls === 1);

  await background.handleStop();
  release();
  await start;

  expect(audioStarts()).toHaveLength(0);
  expect((await playbackState()).status).toBe("idle");
});

test("a native start supersedes a pending OpenAI start", async () => {
  let release!: () => void;
  createDocumentGate = new Promise((resolve) => {
    release = resolve;
  });

  const start = background.handleStart(["hello"]);
  await waitUntil(() => createDocumentCalls === 1);

  await background.handleNativeStart(7, () => {});
  release();
  await start;

  expect(audioStarts()).toHaveLength(0);
  const state = await playbackState();
  expect(state.status).toBe("loading");
  expect(state.driver).toBe("native");
  expect(state.tabId).toBe(7);
});

test("registers one Read aloud item for selections", async () => {
  await background.installContextMenu();
  expect(createdMenus).toEqual([
    { id: "read-selection", title: "Read aloud", contexts: ["selection"] },
  ]);
});

test("a menu click asks the clicked tab and frame to read its selection", async () => {
  await background.handleMenuClick(
    { menuItemId: "read-selection", frameId: 3 },
    { id: 42 },
  );
  expect(tabMessages).toEqual([
    { tabId: 42, message: { type: "read-selection" }, options: { frameId: 3 } },
  ]);
});

test("an unrelated menu id sends nothing", async () => {
  await background.handleMenuClick(
    { menuItemId: "other", frameId: 0 },
    { id: 42 },
  );
  expect(tabMessages).toHaveLength(0);
});

test("a tab without an id is ignored and a failed send is swallowed", async () => {
  await background.handleMenuClick(
    { menuItemId: "read-selection", frameId: 0 },
    undefined,
  );
  expect(tabMessages).toHaveLength(0);

  sendMessageImpl = async () => {
    throw new Error("Could not establish connection.");
  };
  await expect(
    background.handleMenuClick(
      { menuItemId: "read-selection", frameId: 0 },
      { id: 7 },
    ),
  ).resolves.toBeUndefined();
});

test("the registered click listener delegates to handleMenuClick", async () => {
  await background.installContextMenu();
  menuListener?.({ menuItemId: "read-selection", frameId: 1 }, { id: 9 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(tabMessages).toEqual([
    { tabId: 9, message: { type: "read-selection" }, options: { frameId: 1 } },
  ]);
});
