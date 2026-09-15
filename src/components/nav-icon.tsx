// One icon per nav key, needed because the collapsed sidebar has no room for labels.
// Keyed on NavItem.key so nav.ts stays pure data. All drawn on the same 24px grid with
// the same stroke weight as the existing menu/close glyphs, so the rail reads as one set.
const PATHS: Record<string, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  library: (
    <>
      <path d="M9.5 3v5.2L4.9 16.3A2.4 2.4 0 0 0 7 20h10a2.4 2.4 0 0 0 2.1-3.7L14.5 8.2V3" />
      <path d="M8 3h8" />
      <path d="M7.3 14.6h9.4" />
    </>
  ),
  "add-sample": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.4v7.2M8.4 12h7.2" />
    </>
  ),
  locations: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17" />
    </>
  ),
  "my-checkouts": (
    <>
      <path d="M4 7h11a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h13" />
      <path d="m17 4 3 3-3 3" />
    </>
  ),
  ingredients: <path d="M12 3.4c0 0 6 5.9 6 9.6a6 6 0 0 1-12 0c0-3.7 6-9.6 6-9.6Z" />,
  requests: (
    <>
      <path d="M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13.5A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2" />
      <rect x="9" y="2.5" width="6" height="4" rx="1.2" />
      <path d="M9 12.5h6M9 16h4" />
    </>
  ),
  orders: (
    <>
      <path d="M3 4.5h2.2l2.3 10.2a1.8 1.8 0 0 0 1.8 1.4h7.4a1.8 1.8 0 0 0 1.7-1.3L20.5 8H6" />
      <circle cx="9.6" cy="19.4" r="1.3" />
      <circle cx="17" cy="19.4" r="1.3" />
    </>
  ),
  "pending-feedback": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 1.9" />
    </>
  ),
  feedback: (
    <path d="M20 15.2a2.3 2.3 0 0 1-2.3 2.3H9.2L4.5 21v-3.5a2.3 2.3 0 0 1-.5-1.4V6.3A2.3 2.3 0 0 1 6.3 4h11.4A2.3 2.3 0 0 1 20 6.3Z" />
  ),
  lists: (
    <>
      <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" />
      <path d="M5 6.5h.01M5 12h.01M5 17.5h.01" />
    </>
  ),
  users: (
    <>
      <circle cx="9.4" cy="8.5" r="3.2" />
      <path d="M3.8 19.5a5.6 5.6 0 0 1 11.2 0" />
      <path d="M16.3 6.3a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.5 14.5a5.6 5.6 0 0 1 2.9 5" />
    </>
  ),
  "menu-settings": (
    <>
      <path d="M5 5.5v13M12 5.5v13M19 5.5v13" />
      <circle cx="5" cy="9.6" r="1.7" />
      <circle cx="12" cy="14.6" r="1.7" />
      <circle cx="19" cy="8.6" r="1.7" />
    </>
  ),
};

export function NavIcon({ navKey, className }: { navKey: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* A nav key added later without an icon still gets a marker rather than a gap. */}
      {PATHS[navKey] ?? <circle cx="12" cy="12" r="3.5" />}
    </svg>
  );
}
