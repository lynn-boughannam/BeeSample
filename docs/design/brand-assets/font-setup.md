# Font Setup — Next.js 16 App Router

Add to `src/app/layout.tsx`:

```tsx
import { Inter, Space_Grotesk } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

Add to `tokens.css` (inside the existing `@theme` block, alongside the color tokens):

```css
@theme {
  /* ...existing color tokens... */

  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif;
}
```

Set the default body font in `globals.css`:

```css
body {
  font-family: var(--font-sans);
}
```

## Usage

```jsx
<h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.02em]">
  Sample Library
</h1>

<p className="font-sans text-sm text-neutral-dark">
  14 samples checked out this week
</p>

<td className="font-sans tabular-nums">142</td>
```

`font-sans` is the Tailwind default (`font-sans` utility), so body text doesn't need
the class explicitly in most cases — only `font-display` needs to be applied deliberately
on headings.
