import { useEffect, useState } from "preact/hooks";
import type { AppSettings } from "../types";
import { Slider } from "./Slider";
import type { UpdateSetting } from "./useSettings";

interface NativePanelProps {
  settings: AppSettings;
  update: UpdateSetting;
}

export function NativePanel({ settings, update }: NativePanelProps) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    window.speechSynthesis ? window.speechSynthesis.getVoices() : [],
  );

  useEffect(() => {
    if (!window.speechSynthesis) {
      return;
    }
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  const groups = new Map<string, SpeechSynthesisVoice[]>();
  for (const voice of voices) {
    const list = groups.get(voice.lang) ?? [];
    list.push(voice);
    groups.set(voice.lang, list);
  }
  const sortedGroups = [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return (
    <section class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-sm">Voice</span>
        <select
          id="native-voice"
          class="select select-bordered select-sm w-full"
          value={settings.nativeVoiceUri}
          onChange={(event) =>
            update("nativeVoiceUri", event.currentTarget.value)
          }
        >
          <option value="">Default voice</option>
          {sortedGroups.map(([language, list]) => (
            <optgroup label={language}>
              {list.map((voice) => (
                <option value={voice.voiceURI}>{voice.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <Slider
        label="Pitch"
        value={settings.pitch}
        min={0}
        max={2}
        step={0.05}
        onChange={(value) => update("pitch", value)}
      />
    </section>
  );
}
