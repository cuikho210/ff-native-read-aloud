import { NativePanel } from "./NativePanel";
import { ServerPanel } from "./ServerPanel";
import { Slider } from "./Slider";
import { StatusBadge } from "./StatusBadge";
import { usePlaybackState } from "./usePlaybackState";
import { useSettings } from "./useSettings";

export const PREVIEW_TEXT = "The quick brown fox jumps over the lazy dog";

export function App() {
  const [settings, update] = useSettings();
  const state = usePlaybackState();

  if (!settings) {
    return null;
  }

  const stop = () => {
    void chrome.runtime
      .sendMessage({ target: "background", type: "tts:stop" })
      .catch(() => {});
  };

  return (
    <main class="w-[360px] space-y-4 p-4">
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-lg font-semibold">simple-readaloud</h1>
        <StatusBadge state={state} />
      </header>

      <div role="tablist" class="tabs tabs-boxed tabs-sm">
        <button
          type="button"
          role="tab"
          class={`tab ${settings.driver === "native" ? "tab-active" : ""}`}
          aria-selected={settings.driver === "native"}
          onClick={() => update("driver", "native")}
        >
          Native
        </button>
        <button
          type="button"
          role="tab"
          class={`tab ${settings.driver === "openai" ? "tab-active" : ""}`}
          aria-selected={settings.driver === "openai"}
          onClick={() => update("driver", "openai")}
        >
          OpenAI-compatible
        </button>
      </div>

      {settings.driver === "native" ? (
        <NativePanel settings={settings} update={update} />
      ) : (
        <ServerPanel
          settings={settings}
          update={update}
          previewText={PREVIEW_TEXT}
        />
      )}

      <div class="space-y-3 border-t border-base-300 pt-3">
        <Slider
          label="Volume"
          value={settings.volume}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => update("volume", value)}
        />
        <Slider
          label="Playback rate"
          value={settings.playbackRate}
          min={0.1}
          max={2}
          step={0.1}
          onChange={(value) => update("playbackRate", value)}
        />
      </div>

      {state.status === "error" ? (
        <div class="alert alert-error alert-sm" role="alert">
          <span>{state.message ?? "Playback failed"}</span>
        </div>
      ) : null}

      <footer class="flex justify-end">
        <button id="stop" type="button" class="btn btn-sm" onClick={stop}>
          Stop
        </button>
      </footer>
    </main>
  );
}
