import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "danger";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-body font-medium " +
  "transition-[transform,opacity,background-color,border-color] duration-150 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";

const variants: Record<ButtonVariant, string> = {
  // Never white text on primary — --color-on-primary is dark forest green (13.05:1).
  primary:
    "bg-brand-primary text-on-primary hover:brightness-95 focus-visible:ring-brand-secondary",
  secondary:
    "border border-neutral-dark/20 bg-transparent text-neutral-dark hover:bg-neutral-dark/5 focus-visible:ring-neutral-dark",
  danger: "bg-danger text-on-danger hover:brightness-90 focus-visible:ring-danger",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={cn(base, variants[variant], className)} {...props} />;
}
