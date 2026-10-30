import { useCallback, useEffect, useState } from "preact/hooks";
import { loadAppSettings, saveAppSetting } from "../settings";
import type { AppSettings } from "../types";

export type UpdateSetting = <K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
) => void;

export function useSettings(): [AppSettings | null, UpdateSetting] {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let active = true;
    void loadAppSettings().then((loaded) => {
      if (active) {
        setSettings(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(function updateSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) {
    setSettings((current) =>
      current ? { ...current, [key]: value } : current,
    );
    void saveAppSetting(key, value);
  }, []);

  return [settings, update];
}
