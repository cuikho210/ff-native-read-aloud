import type {
  AppSettings,
  Driver,
  NativeVoiceSettings,
  OpenAiConfig,
  PlaybackState,
} from "./types";

type AreaName = "local" | "session";

export class Setting<T> {
  constructor(
    readonly key: string,
    readonly defaultValue: T,
    private readonly areaName: AreaName,
  ) {}

  private area(): chrome.storage.StorageArea {
    return this.areaName === "local" ? chrome.storage.local : chrome.storage.session;
  }

  async get(): Promise<T> {
    const values = await this.area().get(this.key);
    return this.key in values ? (values[this.key] as T) : this.defaultValue;
  }

  async set(value: T): Promise<void> {
    await this.area().set({ [this.key]: value });
  }
}

export const driverSetting = new Setting<Driver>("driver", "native", "local");
export const volumeSetting = new Setting<number>("volume", 1, "local");
export const playbackRateSetting = new Setting<number>("playback-rate", 1, "local");
export const pitchSetting = new Setting<number>("pitch", 1, "local");
export const nativeVoiceUriSetting = new Setting<string>(
  "native-voice-uri",
  "",
  "local",
);
export const openAiBaseUrlSetting = new Setting<string>(
  "openai-base-url",
  "http://localhost:8880/v1",
  "local",
);
export const openAiApiKeySetting = new Setting<string>("openai-api-key", "", "local");
export const openAiModelSetting = new Setting<string>("openai-model", "", "local");
export const openAiVoiceSetting = new Setting<string>("openai-voice", "", "local");
export const playbackStateSetting = new Setting<PlaybackState>(
  "playback-state",
  { status: "idle", updatedAt: 0 },
  "session",
);
export const activeNativeTabSetting = new Setting<number | null>(
  "active-native-tab",
  null,
  "session",
);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export async function loadOpenAiConfig(): Promise<OpenAiConfig> {
  const [baseUrl, apiKey, model, voice, playbackRate, volume] = await Promise.all([
    openAiBaseUrlSetting.get(),
    openAiApiKeySetting.get(),
    openAiModelSetting.get(),
    openAiVoiceSetting.get(),
    playbackRateSetting.get(),
    volumeSetting.get(),
  ]);

  return {
    baseUrl,
    apiKey,
    model,
    voice,
    speed: clamp(playbackRate, 0.25, 4),
    volume,
  };
}

export async function loadNativeSettings(): Promise<NativeVoiceSettings> {
  const [voiceUri, volume, playbackRate, pitch] = await Promise.all([
    nativeVoiceUriSetting.get(),
    volumeSetting.get(),
    playbackRateSetting.get(),
    pitchSetting.get(),
  ]);

  return { voiceUri, volume, rate: playbackRate, pitch };
}

export async function loadAppSettings(): Promise<AppSettings> {
  const [
    driver,
    volume,
    playbackRate,
    pitch,
    nativeVoiceUri,
    openAiBaseUrl,
    openAiApiKey,
    openAiModel,
    openAiVoice,
  ] = await Promise.all([
    driverSetting.get(),
    volumeSetting.get(),
    playbackRateSetting.get(),
    pitchSetting.get(),
    nativeVoiceUriSetting.get(),
    openAiBaseUrlSetting.get(),
    openAiApiKeySetting.get(),
    openAiModelSetting.get(),
    openAiVoiceSetting.get(),
  ]);

  return {
    driver,
    volume,
    playbackRate,
    pitch,
    nativeVoiceUri,
    openAiBaseUrl,
    openAiApiKey,
    openAiModel,
    openAiVoice,
  };
}

const appSettings: {
  [K in keyof AppSettings]: Setting<AppSettings[K]>;
} = {
  driver: driverSetting,
  volume: volumeSetting,
  playbackRate: playbackRateSetting,
  pitch: pitchSetting,
  nativeVoiceUri: nativeVoiceUriSetting,
  openAiBaseUrl: openAiBaseUrlSetting,
  openAiApiKey: openAiApiKeySetting,
  openAiModel: openAiModelSetting,
  openAiVoice: openAiVoiceSetting,
};

export async function saveAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  await appSettings[key].set(value);
}
