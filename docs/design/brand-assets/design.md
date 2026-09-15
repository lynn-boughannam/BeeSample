# Design Guardrails — SLT (BeeSample)

**Invoke the `frontend-design` skill before writing any UI code** — every session, no exceptions. It already governs typography, layout, and anti-genericism in depth; the rules below are SLT-specific additions on top of it.

## Brand Assets

- Check `docs/design/brand-assets/` before designing any screen. It contains the BeeSample logo files, `palette.json`, and `tokens.css`.
- Use the exact hex values defined in `tokens.css` — never invent or substitute brand colors.
- If an asset you need doesn't exist yet for a given surface (e.g. a dark-mode logo variant), flag it and ask rather than guessing.

## Color Usage Rules

- **Primary (`#CCFF00`, Electric Lime) always pairs with dark text** (`--color-on-primary`, `#132A13`). Never use white text on primary — it fails contrast (1.18:1). This applies to any lime/accent-colored surface.
- Use the `--color-on-*` tokens instead of hardcoding `text-white` / `text-black` on any brand or semantic color — they're pre-verified against WCAG AA.
- Semantic colors (`success`, `warning`, `danger`, `info`) are not part of the original brand palette — they were derived to match the lime/forest/cream family. Treat them as the fixed vocabulary for status states; don't introduce new ad hoc status colors.

## Anti-Generic Guardrails

- **Colors:** never default to Tailwind's stock indigo/blue/violet. Use only the tokens defined in `tokens.css`.
- **Shadows:** no flat `shadow-md` everywhere. Use a layering system — base surface, elevated (cards/table rows), floating (modals/dropdowns) — each with its own shadow depth.
- **Typography:** one sans-serif family for both UI chrome and data, with a clear scale (page title / section header / table header / body / caption) and consistent weights. This is a data-dense internal tool, not a marketing page — legibility beats personality.
- **Motion:** animate only `transform`/`opacity`. No `transition-all`. Reserve motion for state changes that matter (checkout confirmed, order approved) — not decorative hover flourishes on every row.
- **Interactive states:** every button, table row action, and nav item needs hover, focus-visible, active, and disabled states — disabled matters more here than on a marketing site (e.g. "Approve" disabled until all fields are validated).

## Data-App Specific Rules

- **Tables are primary UI**, not an afterthought. Design the sample list / shelf grid / procurement queue table first — column density, sort/filter affordances, row-level actions — before styling anything else.
- **Every async flow needs all four states designed up front:** loading, empty, error, and success. Example: sample checkout — show what "no samples found," "checkout in progress," "checkout failed (network/permission)," and "checked out successfully" each look like, not just the happy path.
- **RBAC drives layout, not just visibility.** Nav items, dashboard widgets, and available actions differ by role (Admin / Formulator / Director) — design each role's shell separately rather than hiding/showing elements on one shared layout as an afterthought.
- **Forms validate inline**, field-by-field, with specific error copy (e.g. "INCI name is required" not "Invalid input") — procurement and sample-creation forms have real business rules (multi-supplier rule, ~70-value function list) that need to surface clearly.

## Review Loop

- Run the actual dev server (`npm run dev` / `next dev`), never review static HTML.
- After building a screen, take a screenshot at both desktop and a mobile/narrow breakpoint — formulators may check samples from a shelf floor on a tablet.
- Compare against the brand assets and previous screens for consistency (spacing, color reuse, component shape) before moving to the next screen — SLT will have many screens; drift between them is the main risk, more than any single screen looking bad in isolation.

## Hard Rules

- Do not introduce a second color palette or typeface pairing partway through the app — extend the existing token system.
- Do not use default Tailwind blue/indigo as primary or accent color.
- Do not use white text on `--color-brand-primary` or `--color-brand-accent`.
- Do not skip the loading/empty/error states "for now" — they're cheap to design and expensive to retrofit once real data volume shows the gaps.
