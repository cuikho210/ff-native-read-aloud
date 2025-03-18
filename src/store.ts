export const keyPitch = "pitch";
export const keyVolume = "volume";
export const keyPlaybackRate = "playback-rate";
export const keyVoice = "voice-index";
export const keySpeakerId = "speaker-id";
export const keyDriver = "driver";

export async function storeVoiceIndex(value: number) {
  await storeOption(keyVoice, value);
}
export async function loadVoiceIndex(): Promise<number | undefined> {
  return await loadOption(keyVoice);
}

export async function storePitch(value: number) {
  await storeOption(keyPitch, value);
}
export async function loadPitch(): Promise<number> {
  return (await loadOption(keyPitch)) ?? 1;
}

export async function storeVolume(value: number) {
  await storeOption(keyVolume, value);
}
export async function loadVolume(): Promise<number> {
  return (await loadOption(keyVolume)) ?? 1;
}

export async function storeSpeakerId(value: number) {
  return storeOption(keySpeakerId, value);
}
export async function loadSpeakerId(): Promise<number> {
  return (await loadOption(keySpeakerId)) ?? 1;
}

export async function storePlaybackRate(value: number) {
  await storeOption(keyPlaybackRate, value);
}
export async function loadPlaybackRate(): Promise<number> {
  return (await loadOption(keyPlaybackRate)) ?? 1;
}

export async function storeDriver(value: string) {
  await storeOption(keyDriver, value);
}
export async function loadDriver(): Promise<string | undefined> {
  return await loadOption(keyDriver);
}

async function storeOption<T>(key: string, value: T) {
  const data: Record<string, T> = {};
  data[key] = value;
  await browser.storage.local.set(data);
}
async function loadOption<T>(key: string): Promise<T | undefined> {
  return (await browser.storage.local.get(key))[key];
}
