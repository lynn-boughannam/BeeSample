import { cn } from "@/lib/cn";

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border bg-neutral-light px-3 py-2 text-body text-neutral-dark outline-none transition-colors",
        "placeholder:text-neutral-dark/40",
        "focus-visible:ring-2 focus-visible:ring-offset-1",
        invalid
          ? "border-danger focus-visible:ring-danger"
          : "border-neutral-dark/20 focus-visible:border-brand-secondary focus-visible:ring-brand-secondary/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border bg-neutral-light px-3 py-2 text-body text-neutral-dark outline-none transition-colors",
        "placeholder:text-neutral-dark/40",
        "focus-visible:ring-2 focus-visible:ring-offset-1",
        invalid
          ? "border-danger focus-visible:ring-danger"
          : "border-neutral-dark/20 focus-visible:border-brand-secondary focus-visible:ring-brand-secondary/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Select({
  className,
  invalid,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(
        "w-full rounded-lg border bg-neutral-light px-3 py-2 text-body text-neutral-dark outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-offset-1",
        invalid
          ? "border-danger focus-visible:ring-danger"
          : "border-neutral-dark/20 focus-visible:border-brand-secondary focus-visible:ring-brand-secondary/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

// Wraps a label + control + inline error, per design.md's "forms validate inline,
// field-by-field, with specific error copy" rule.
export function FormField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-body font-medium text-neutral-dark">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}
