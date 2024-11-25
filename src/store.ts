export const keyPitch = "pitch";
export const keyVolume = "volume";
export const keyPlaybackRate = "playback-rate";
export const keyVoice = "voice-index";

export async function storeVoiceIndex(value: number) {
  await storeNumberOption(keyVoice, value);
}

export async function loadVoiceIndex(): Promise<number | undefined> {
  return await loadNumberOption(keyVoice);
}

export async function storePitch(value: number) {
  await storeNumberOption(keyPitch, value);
}

export async function storeVolume(value: number) {
  await storeNumberOption(keyVolume, value);
}

export async function storePlaybackRate(value: number) {
  await storeNumberOption(keyPlaybackRate, value);
}

export async function loadPitch(): Promise<number> {
  return (await loadNumberOption(keyPitch)) ?? 1;
}

export async function loadVolume(): Promise<number> {
  return (await loadNumberOption(keyVolume)) ?? 1;
}

export async function loadPlaybackRate(): Promise<number> {
  return (await loadNumberOption(keyPlaybackRate)) ?? 1;
}

async function storeNumberOption(key: string, value: number) {
  const data: Record<string, number> = {};
  data[key] = value;
  await browser.storage.local.set(data);
}

async function loadNumberOption(key: string): Promise<number | undefined> {
  return (await browser.storage.local.get(key))[key];
}
