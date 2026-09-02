import { cn } from "../../lib/utils";

export function GenerationEmotionLabel({ label, className }: { label?: string | null; className?: string }) {
  const value = label?.trim();
  if (!value) return null;
  return (
    <span
      className={cn(
        "mari-message-generation-emotion block text-[0.625rem] font-normal leading-tight text-[var(--muted-foreground)]/60",
        className,
      )}
    >
      {value}
    </span>
  );
}
