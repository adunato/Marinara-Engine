import { useEffect, useRef, useState } from "react";

interface DraftRangeInputProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}

export function DraftRangeInput({
  value,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  ariaLabel,
  className,
}: DraftRangeInputProps) {
  const [draft, setDraft] = useState(value);
  const lastCommitted = useRef(value);

  useEffect(() => {
    setDraft(value);
    lastCommitted.current = value;
  }, [value]);

  const commit = (nextValue: number) => {
    const next = Math.max(min, Math.min(max, nextValue));
    setDraft(next);
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    onCommit(next);
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-valuetext={`${draft}%`}
      onChange={(event) => setDraft(Number(event.target.value))}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onKeyUp={(event) => {
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)
        ) {
          commit(Number(event.currentTarget.value));
        }
      }}
      onBlur={(event) => commit(Number(event.currentTarget.value))}
      className={className}
    />
  );
}
