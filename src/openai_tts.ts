import type { OpenAiConfig } from "./types";

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Base URL is required");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid base URL: ${trimmed}`);
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/v1";
  }

  return url.toString().replace(/\/$/, "");
}

export function speechUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/audio/speech`;
}

const clampSpeed = (speed: number) => Math.min(4, Math.max(0.25, speed));

export function buildSpeechBody(
  input: string,
  config: Pick<OpenAiConfig, "model" | "voice" | "speed">,
): Record<string, unknown> {
  const body: Record<string, unknown> = { input };

  const model = config.model.trim();
  if (model) {
    body.model = model;
  }

  const voice = config.voice.trim();
  if (voice) {
    body.voice = voice;
  }

  body.response_format = "mp3";
  body.speed = clampSpeed(config.speed);

  return body;
}

export function buildAuthHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim();
  return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

export function parseModelIds(value: unknown): string[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { data?: unknown }).data)
  ) {
    return [];
  }

  const ids = (value as { data: unknown[] }).data
    .map((item) =>
      typeof item === "object" && item !== null
        ? (item as { id?: unknown }).id
        : undefined,
    )
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return [...new Set(ids)];
}

export function parseVoiceNames(value: unknown): string[] {
  let names: unknown[];

  if (Array.isArray(value)) {
    names = value;
  } else if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { voices?: unknown }).voices)
  ) {
    names = (value as { voices: unknown[] }).voices;
  } else {
    return [];
  }

  return [
    ...new Set(
      names.filter(
        (name): name is string => typeof name === "string" && name.length > 0,
      ),
    ),
  ];
}

async function assertOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${await responseErrorMessage(response)}`,
    );
  }
}

export async function discoverModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: buildAuthHeaders(apiKey),
    signal,
  });
  await assertOk(response);
  return parseModelIds(await response.json());
}

export async function discoverVoices(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/audio/voices`, {
    headers: buildAuthHeaders(apiKey),
    signal,
  });
  await assertOk(response);
  return parseVoiceNames(await response.json());
}

export async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text();

  try {
    const data: unknown = JSON.parse(text);
    if (typeof data === "object" && data !== null) {
      const error = (data as { error?: unknown }).error;
      if (
        typeof error === "object" &&
        error !== null &&
        typeof (error as { message?: unknown }).message === "string"
      ) {
        return (error as { message: string }).message;
      }
      if (typeof (data as { message?: unknown }).message === "string") {
        return (data as { message: string }).message;
      }
    }
  } catch {
    // Not JSON; fall through to raw text.
  }

  return text.trim() || `HTTP ${response.status}`;
}
