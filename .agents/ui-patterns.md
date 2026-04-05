# UI Patterns

## Tailwind v4 — CSS-First Configuration

This project uses **Tailwind v4**. There is no `tailwind.config.js` or `tailwind.config.ts`. All configuration lives in `src/styles/global.css`.

### What NOT to do

- Do NOT create a `tailwind.config.js` or `tailwind.config.ts` file.
- Do NOT use `@tailwind base`, `@tailwind components`, or `@tailwind utilities` directives.
- Do NOT hardcode colors (no `bg-gray-800`, `text-white`, etc.). Exception: domain-specific colors like the split-line palette (emerald, sky, amber, etc.) that don't map to semantic tokens.
- Do NOT use Tailwind v3 dark mode syntax like `dark:bg-gray-900`. Use semantic color classes — they auto-adapt via CSS variables.

### Semantic color classes

Always use these semantic classes. They auto-adapt to light/dark theme:

| Purpose | Background | Text | Border |
|---------|------------|------|--------|
| Page background | `bg-background` | `text-foreground` | — |
| Cards / surfaces | `bg-card` | `text-card-foreground` | `border-border` |
| Muted areas | `bg-muted` | `text-muted-foreground` | — |
| Primary actions | `bg-primary` | `text-primary-foreground` | — |
| Secondary actions | `bg-secondary` | `text-secondary-foreground` | — |
| Destructive actions | `bg-destructive` | `text-destructive` | — |

## shadcn/ui — "radix-mira" Style

This project uses the **radix-mira** style of shadcn/ui with Radix primitives.

### Adding new components

```bash
npx shadcn add <component-name>
```

Or use the existing `npm run bump-ui` script to update all installed components.

### Currently installed components

Check `src/components/ui/` for what's available: `button`, `toggle`, `toggle-group`, `navigation-menu`. Install others as needed.

### After adding a component

Read the generated file in `src/components/ui/` before using it. The source shows available props, variants, and how it integrates with the color system.

## Code Patterns

### Class name merging

Use `cn()` from `@/utils/tailwind` for conditional or merged class names:

```tsx
import { cn } from "@/utils/tailwind";

<div className={cn("bg-card rounded-lg p-4", isActive && "ring-2 ring-primary")} />
```

### Icon usage

Use `lucide-react`:

```tsx
import { FolderOpen, Plus, Minus, Undo2 } from "lucide-react";
```

### Local file URLs

Use the shared `toLocalFileUrl()` from `src/components/webtoon/types.ts` for image sources:

```tsx
import { toLocalFileUrl } from "@/components/webtoon/types";

<img src={toLocalFileUrl(segment.path)} />
// Produces: local-file://localhost/absolute/path/to/file.png
```

The `localhost` host is mandatory — see `docs/APP.md` for why.

### Showing files in the OS file manager

Use `showInFolder` from `src/actions/webtoon.ts` instead of `<a href>` navigation:

```tsx
import { showInFolder } from "@/actions/webtoon";

<button onClick={() => showInFolder(filePath)}>Open</button>
```

This calls `shell.showItemInFolder()` in the main process, which reveals the file in Finder/Explorer without navigating the Electron window away.
