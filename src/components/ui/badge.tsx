import { cn } from "@/lib/cn";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

const variants: Record<BadgeVariant, string> = {
  success: "bg-success text-on-success",
  warning: "bg-warning text-on-warning",
  danger: "bg-danger text-on-danger",
  info: "bg-info text-on-info",
  neutral: "bg-neutral-dark/8 text-neutral-dark",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

// A small hex-color swatch chip — the signature device for this app. Category and
// shelf-address colors come from the real physical shelf-plan taxonomy
// (src/lib/taxonomy.ts / ShelfSlotConfig), not invented decoration, so this component
// takes an arbitrary hex rather than a fixed variant set.
export function SwatchChip({
  colorHex,
  label,
  className,
}: {
  colorHex: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-neutral-dark/10 bg-neutral-light px-2.5 py-0.5 text-caption font-medium text-neutral-dark",
        className
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorHex }} />
      {label}
    </span>
  );
}
