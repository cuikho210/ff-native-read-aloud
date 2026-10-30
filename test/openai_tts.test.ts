import { expect, test } from "bun:test";
import {
  buildAuthHeaders,
  buildSpeechBody,
  normalizeBaseUrl,
  parseModelIds,
  parseVoiceNames,
  speechUrl,
} from "../src/openai_tts";

test("normalizes a bare origin to /v1", () => {
  expect(normalizeBaseUrl("http://localhost:8880")).toBe(
    "http://localhost:8880/v1",
  );
  expect(normalizeBaseUrl("http://localhost:8880/")).toBe(
    "http://localhost:8880/v1",
  );
});

test("keeps an existing path and strips trailing slashes", () => {
  expect(normalizeBaseUrl("https://host/openai/v1/")).toBe(
    "https://host/openai/v1",
  );
  expect(normalizeBaseUrl("  http://localhost:8880/v1  ")).toBe(
    "http://localhost:8880/v1",
  );
});

test("rejects a blank or invalid base URL", () => {
  expect(() => normalizeBaseUrl("   ")).toThrow();
  expect(() => normalizeBaseUrl("not a url")).toThrow();
});

test("builds the speech endpoint", () => {
  expect(speechUrl("http://localhost:8880")).toBe(
    "http://localhost:8880/v1/audio/speech",
  );
});

test("builds a complete MP3 request with clamped speed", () => {
  expect(buildSpeechBody("Hello", { model: "m", voice: "v", speed: 0.1 })).toEqual(
    {
      model: "m",
      input: "Hello",
      voice: "v",
      response_format: "mp3",
      speed: 0.25,
    },
  );
});

test("omits empty model and voice and clamps high speed", () => {
  expect(buildSpeechBody("Hello", { model: "", voice: "", speed: 9 })).toEqual({
    input: "Hello",
    response_format: "mp3",
    speed: 4,
  });
});

test("adds an Authorization header only for a non-empty key", () => {
  expect(buildAuthHeaders("")).toEqual({});
  expect(buildAuthHeaders("secret")).toEqual({ Authorization: "Bearer secret" });
});

test("parses model ids and voice names", () => {
  expect(parseModelIds({ data: [{ id: "a" }, { id: "b" }, { nope: 1 }] })).toEqual(
    ["a", "b"],
  );
  expect(parseVoiceNames({ voices: ["a", "b", "a"] })).toEqual(["a", "b"]);
  expect(parseVoiceNames(["a", "b"])).toEqual(["a", "b"]);
  expect(parseVoiceNames({ nope: true })).toEqual([]);
});
