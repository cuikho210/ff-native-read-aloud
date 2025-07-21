import {
  driverStore,
  pitchStore,
  playbackRateStore,
  speakerIdStore,
  voiceIndexStore,
  volumeStore,
} from "./store";
import { ReadAloudDriver } from "./types.d";

const $ = document.querySelector.bind(document);

main();
function main() {
  initOptions();
  listVoices();
}

async function initOptions() {
  const pitch = (await pitchStore.get()) ?? 1;
  const volume = (await volumeStore.get()) ?? 1;
  const playbackRate = (await playbackRateStore.get()) ?? 1;
  const sid = (await speakerIdStore.get()) ?? 0;
  const driver = (await driverStore.get()) ?? ReadAloudDriver.Native;

  bindNumberOptions(pitchStore.key, pitch, pitchStore.set);
  bindNumberOptions(volumeStore.key, volume, volumeStore.set);
  bindNumberOptions(playbackRateStore.key, playbackRate, playbackRateStore.set);
  bindNumberOptions(speakerIdStore.key, sid, speakerIdStore.set);
  bindSelectOptions(driverStore.key, driver, (val) =>
    driverStore.set(val as ReadAloudDriver),
  );
}

async function listVoices() {
  const elVoices = $("#list-voices");
  const voices = window.speechSynthesis.getVoices();
  const voiceIndex = await voiceIndexStore.get();

  voices.forEach((voice, index) => {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "voice";
    input.value = voice.name;
    input.checked = voiceIndex === index;
    input.oninput = () => {
      voiceIndexStore.set(index);
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
