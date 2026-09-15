import { signOut } from "@/lib/auth";
import { cn } from "@/lib/cn";

// The collapsed sidebar can't fit the word, so it renders the icon variant instead. Both
// are rendered by the server layout and swapped client-side — the sign-out action itself
// is a server action, which a Client Component can't declare inline.
export function SignOutButton({ variant = "full" }: { variant?: "full" | "icon" }) {
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
          "w-full rounded-lg font-medium text-neutral-light/70 transition-colors duration-150 hover:bg-neutral-light/10 hover:text-neutral-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-light/40",
          iconOnly ? "flex items-center justify-center p-2.5" : "px-3 py-2 text-left text-body"
        )}
      >
        {iconOnly ? (
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
        ) : (
          "Sign out"
        )}
      </button>
    </form>
  );
}
