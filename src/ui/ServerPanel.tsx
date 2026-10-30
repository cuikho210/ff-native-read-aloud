import { useRef, useState } from "preact/hooks";
import { discoverModels, discoverVoices } from "../openai_tts";
import { saveAppSetting } from "../settings";
import type { AppSettings } from "../types";
import type { UpdateSetting } from "./useSettings";

interface ServerPanelProps {
  settings: AppSettings;
  update: UpdateSetting;
  previewText: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ServerPanel({
  settings,
  update,
  previewText,
}: ServerPanelProps) {
  const [models, setModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const latestSettings = useRef(settings);
  latestSettings.current = settings;

  const persist = async () => {
    await Promise.all([
      saveAppSetting("openAiBaseUrl", settings.openAiBaseUrl),
      saveAppSetting("openAiApiKey", settings.openAiApiKey),
      saveAppSetting("openAiModel", settings.openAiModel),
      saveAppSetting("openAiVoice", settings.openAiVoice),
    ]);
  };

  const refresh = async () => {
    setBusy(true);
    setError(null);
    setStatus("Discovering…");

    try {
      const signal = AbortSignal.timeout(5000);
      const [modelResult, voiceResult] = await Promise.allSettled([
        discoverModels(settings.openAiBaseUrl, settings.openAiApiKey, signal),
        discoverVoices(settings.openAiBaseUrl, settings.openAiApiKey, signal),
      ]);

      const parts: string[] = [];
      const failures: string[] = [];

      if (modelResult.status === "fulfilled") {
        setModels(modelResult.value);
        parts.push(`${modelResult.value.length} models`);
        if (
          !latestSettings.current.openAiModel.trim() &&
          modelResult.value[0]
        ) {
          update("openAiModel", modelResult.value[0]);
        }
      } else {
        parts.push("Model list unavailable");
        failures.push(`Models: ${errorText(modelResult.reason)}`);
      }

      if (voiceResult.status === "fulfilled") {
        setVoices(voiceResult.value);
        parts.push(`${voiceResult.value.length} voices`);
        if (
          !latestSettings.current.openAiVoice.trim() &&
          voiceResult.value[0]
        ) {
          update("openAiVoice", voiceResult.value[0]);
        }
      } else {
        parts.push("Voice list unavailable");
      }

      setStatus(parts.join(", "));
      if (failures.length > 0) {
        setError(failures.join("; "));
      }
    } finally {
      setBusy(false);
    }
  };

  const testVoice = async () => {
    await persist();
    await chrome.runtime.sendMessage({
      target: "background",
      type: "tts:start",
      texts: [previewText],
    });
  };

  return (
    <section class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-sm">Base URL</span>
        <input
          id="openai-base-url"
          class="input input-bordered input-sm w-full"
          value={settings.openAiBaseUrl}
          onInput={(event) =>
            update("openAiBaseUrl", event.currentTarget.value)
          }
        />
      </label>

      <label class="block">
        <span class="mb-1 block text-sm">API key</span>
        <input
          id="openai-api-key"
          type="password"
          class="input input-bordered input-sm w-full"
          value={settings.openAiApiKey}
          placeholder="Optional"
          onInput={(event) =>
            update("openAiApiKey", event.currentTarget.value)
          }
        />
      </label>

      <label class="block">
        <span class="mb-1 block text-sm">Model</span>
        <input
          id="openai-model"
          class="input input-bordered input-sm w-full"
          list="openai-models"
          value={settings.openAiModel}
          placeholder="Server default"
          onInput={(event) => update("openAiModel", event.currentTarget.value)}
        />
        <datalist id="openai-models">
          {models.map((model) => (
            <option value={model} />
          ))}
        </datalist>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm">Voice</span>
        <input
          id="openai-voice"
          class="input input-bordered input-sm w-full"
          list="openai-voices"
          value={settings.openAiVoice}
          placeholder="Server default"
          onInput={(event) => update("openAiVoice", event.currentTarget.value)}
        />
        <datalist id="openai-voices">
          {voices.map((voice) => (
            <option value={voice} />
          ))}
        </datalist>
      </label>

      <div class="flex flex-wrap gap-2">
        <button
          id="refresh"
          type="button"
          class="btn btn-sm btn-outline"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </button>
        <button
          id="test-voice"
          type="button"
          class="btn btn-sm btn-primary"
          onClick={() => void testVoice()}
        >
          Test voice
        </button>
      </div>

      <p id="discovery-status" class="min-h-4 text-xs opacity-70">
        {status}
      </p>
      {error ? <p class="text-xs text-error">{error}</p> : null}
    </section>
  );
}
