import type { PlaybackState } from "../types";

const labels: Record<PlaybackState["status"], string> = {
  idle: "Idle",
  loading: "Loading",
  playing: "Playing",
  error: "Error",
};

const classes: Record<PlaybackState["status"], string> = {
  idle: "badge-ghost",
  loading: "badge-info",
  playing: "badge-success",
  error: "badge-error",
};

export function StatusBadge({ state }: { state: PlaybackState }) {
  return (
    <span class={`badge badge-sm ${classes[state.status]}`}>
      {labels[state.status]}
    </span>
  );
}
