import { useEffect, useState } from "preact/hooks";
import { playbackStateSetting } from "../settings";
import type { PlaybackState } from "../types";

export function usePlaybackState(): PlaybackState {
  const [state, setState] = useState<PlaybackState>({
    status: "idle",
    updatedAt: 0,
  });

  useEffect(() => {
    let active = true;

    void playbackStateSetting.get().then((stored) => {
      if (active) {
        setState(stored);
      }
    });

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "session") {
        return;
      }
      const change = changes["playback-state"];
      if (change?.newValue) {
        setState(change.newValue as PlaybackState);
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  return state;
}
