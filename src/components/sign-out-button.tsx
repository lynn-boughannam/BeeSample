import { signOut } from "@/lib/auth";
import { cn } from "@/lib/cn";

const ICON = (
  <svg
    className="h-5 w-5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M10.5 8.2 6.7 12l3.8 3.8" />
    <path d="M6.7 12H16" />
  </svg>
);

// "bar" sits on the cream desktop top bar; "icon" on the charcoal mobile header, which
// has no room for the word. The sign-out action is a server action, which a Client
// Component can't declare inline, so the layout renders these and passes them down.
export function SignOutButton({ variant = "bar" }: { variant?: "bar" | "icon" }) {
  const iconOnly = variant === "icon";

  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button
        type="submit"
        title={iconOnly ? "Sign out" : undefined}
        aria-label={iconOnly ? "Sign out" : undefined}
        className={cn(
          "flex items-center rounded-full font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 active:scale-95",
          iconOnly
            ? "h-10 w-10 justify-center text-neutral-light hover:bg-neutral-light/10 focus-visible:ring-neutral-light/40"
            : "h-10 gap-2 px-3.5 text-body text-neutral-dark/70 hover:bg-neutral-dark/[0.06] hover:text-neutral-dark focus-visible:ring-neutral-dark/30"
        )}
      >
        {ICON}
        {!iconOnly && <span>Sign out</span>}
      </button>
    </form>
  );
}
