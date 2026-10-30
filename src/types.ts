export type Driver = "native" | "openai";

export interface OpenAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
  volume: number;
}

export type PlayerStatus = "idle" | "loading" | "playing" | "error";

export interface PlayerState {
  status: PlayerStatus;
  message?: string;
  receivedBytes?: number;
}

export interface PlaybackState {
  status: PlayerStatus;
  driver?: Driver;
  message?: string;
  receivedBytes?: number;
  updatedAt: number;
  tabId?: number;
}

export interface NativeVoiceSettings {
  voiceUri: string;
  volume: number;
  rate: number;
  pitch: number;
}

export interface AppSettings {
  driver: Driver;
  volume: number;
  playbackRate: number;
  pitch: number;
  nativeVoiceUri: string;
  openAiBaseUrl: string;
  openAiApiKey: string;
  openAiModel: string;
  openAiVoice: string;
}
