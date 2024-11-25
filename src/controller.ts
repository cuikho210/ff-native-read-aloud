import {
  keyPitch,
  keyPlaybackRate,
  keyVolume,
  loadPitch,
  loadPlaybackRate,
  loadVolume,
  storePitch,
  storePlaybackRate,
  storeVolume,
} from "./store";

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

  bindNumberOptions(keyPitch, pitch, storePitch);
  bindNumberOptions(keyVolume, volume, storeVolume);
  bindNumberOptions(keyPlaybackRate, playbackRate, storePlaybackRate);
}

function listVoices() {
  const elVoices = $("#list-voices");
  const voices = window.speechSynthesis.getVoices();

  for (const voice of voices) {
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "voice";
    input.value = voice.name;

    const label = document.createElement("label");
    label.append(input);
    label.append(voice.name);

    elVoices?.appendChild(label);
  }
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
