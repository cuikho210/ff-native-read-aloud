import { StorageItem } from "webext-storage";
import { ReadAloudDriver } from "./types.d";

export const pitchStore = new StorageItem<number>("pitch");
export const volumeStore = new StorageItem<number>("volume");
export const playbackRateStore = new StorageItem<number>("playback-rate");
export const voiceIndexStore = new StorageItem<number>("voice-index");
export const speakerIdStore = new StorageItem<number>("speaker-id");
export const lobeTtsEdgeVoiceStore = new StorageItem<string>(
  "lobe-tts-edge-voice",
);
export const driverStore = new StorageItem<ReadAloudDriver>("driver");
