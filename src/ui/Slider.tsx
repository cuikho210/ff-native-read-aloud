interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: SliderProps) {
  return (
    <label class="block">
      <span class="mb-1 flex items-center justify-between text-sm">
        <span>{label}</span>
        <span class="tabular-nums opacity-60">{formatValue(value)}</span>
      </span>
      <input
        type="range"
        class="range range-primary range-sm"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
