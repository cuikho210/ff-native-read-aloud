import {
  keyDriver,
  keyPitch,
  keyPlaybackRate,
  keySpeakerId,
  keyVolume,
  loadDriver,
  loadPitch,
  loadPlaybackRate,
  loadSpeakerId,
  loadVoiceIndex,
  loadVolume,
  storeDriver,
  storePitch,
  storePlaybackRate,
  storeSpeakerId,
  storeVoiceIndex,
  storeVolume,
} from "./store";
import { ReadAloudDriver } from "./types.d";

const $ = document.querySelector.bind(document);

main();
function main() {
  initOptions();
  listVoices();
}

async function initOptions() {
  const pitch = await loadPitch();
  const volume = await loadVolume();
  const playbackRate = await loadPlaybackRate();
  const sid = await loadSpeakerId();
  const driver = (await loadDriver()) || ReadAloudDriver.Native;

  bindNumberOptions(keyPitch, pitch, storePitch);
  bindNumberOptions(keyVolume, volume, storeVolume);
  bindNumberOptions(keyPlaybackRate, playbackRate, storePlaybackRate);
  bindNumberOptions(keySpeakerId, sid, storeSpeakerId);
  bindSelectOptions(keyDriver, driver, (val) =>
    storeDriver(val as ReadAloudDriver),
  );
}

async function listVoices() {
  const elVoices = $("#list-voices");
  const voices = window.speechSynthesis.getVoices();
  const voiceIndex = await loadVoiceIndex();

  voices.forEach((voice, index) => {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "voice";
    input.value = voice.name;
    input.checked = voiceIndex === index;
    input.oninput = () => {
      storeVoiceIndex(index);
    };

    const label = document.createElement("label");
    label.append(input);
    label.append(voice.name);

    const p = document.createElement("p");
    p.append(label);

    elVoices?.appendChild(p);
  });
}

function bindNumberOptions(
  name: string,
  initValue: number,
  onUpdate?: (newValue: number) => void,
) {
  const elInput = $("#i-" + name) as HTMLInputElement;
  const elLabel = $("#l-" + name) as HTMLInputElement;
  const { getter, setter, onInput } = createInputBinding(elInput, initValue);

  const updateData = (value: string | number) => {
    elLabel.innerText = String(value);
    setter(Number(value));
    if (onUpdate) onUpdate(getter());
  };

  updateData(initValue);
  onInput(updateData);
}

function bindSelectOptions(
  name: string,
  initValue: string,
  onUpdate?: (newValue: string) => void,
) {
  const elSelect = $("#i-" + name) as HTMLSelectElement;

  // Update both the display element and the select value
  const updateData = (value: string) => {
    elSelect.value = value;
    if (onUpdate) onUpdate(value);
  };

  updateData(initValue);
  elSelect.addEventListener("change", (event) => {
    const newValue = (event.target as HTMLSelectElement).value;
    updateData(newValue);
  });
}

function createInputBinding<T>(input: HTMLInputElement, value: T) {
  const getter = () => value;
  const setter = (newValue: T) => {
    value = newValue;
    input.value = String(newValue);
  };

  let inputCallback: ((val: string) => void) | null = null;
  const onInput = (cb: (val: string) => void) => {
    inputCallback = cb;
  };

  input.addEventListener("input", (event) => {
    const inputValue = (event.target as HTMLInputElement).value;
    if (inputCallback) inputCallback(inputValue);
  });

  return { getter, setter, onInput };
}
