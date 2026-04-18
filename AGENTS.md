# Agent Guidelines

## Mandatory: Documentation Updates

**After every change to the app, you MUST update these docs before finishing your task:**

1. **[docs/APP.md](./docs/APP.md)** — Update if you changed or added: oRPC handlers, processor functions, IPC schemas, UI components, configuration knobs, custom protocol behavior, or any architectural pattern. This is the primary reference for all future agents.

**What to update:**

- New oRPC handlers → add to the oRPC Router and Webtoon Handlers tables in APP.md
- New/changed processor functions → update the Processor section in APP.md
- New Zod schemas → update the relevant handler description in APP.md
- New UI components → add to the Repository Layout tree in APP.md
- New configuration knobs → add to the Configuration Knobs section in APP.md
- Changed split/merge behavior → update the Manual Segment Split and Undo / Merge sections
- New gotchas or patterns discovered → add to the relevant architecture section

**If you skip this step, future agents will work from stale documentation and introduce bugs.**

## Mandatory: Inline Code Comments

**Every file you create or substantially modify MUST have clear comments for future agents:**

1. **Top-level module comment** — A JSDoc/block comment at the top of the file explaining its purpose, responsibilities, and how it fits into the architecture. Example:
   ```typescript
   /**
    * oRPC handlers for the webtoon namespace.
    *
    * Each handler corresponds to a user-facing action in the renderer:
    *   pickInput / pickOutput  — native folder picker dialogs
    *   processWebtoon          — full stitch + auto-split pipeline
    *   splitSegment            — manual multi-breakpoint split
    */
   ```

2. **Function/component doc comments** — Every exported function, component, or class gets a JSDoc comment explaining what it does, its key parameters, and any non-obvious return values.

3. **Inline "why" comments** — Add comments for non-obvious logic: trade-offs, workarounds, business rules, algorithm explanations, and anything a future agent would need context to understand. Do NOT add comments that just restate what the code does.

4. **NEVER remove existing comments that are still correct.** When refactoring or rewriting code, preserve every inline comment that still accurately describes the logic it annotates. Only remove a comment if the code it describes has been deleted or the comment is factually wrong. Losing a correct comment means losing context that future agents depend on.

**Why this matters:** Future agents read code comments before documentation. Well-commented code prevents them from misunderstanding intent and introducing regressions.

## Essentials

- Stack: TypeScript + Electron + React 19, with oRPC for IPC, Sharp for image processing, Tailwind 4 + shadcn/ui for styling.
- **Read [docs/APP.md](./docs/APP.md) first** before making any changes — it contains the full architecture, all handlers, processor functions, custom protocol details, and configuration knobs.
- Always prefer shadcn/ui wrapper components (`@/components/ui/*`) over importing `@radix-ui` primitives directly. Check `src/components/ui/` for available components before building custom UI. Install new components with `npx shadcn add <component>`.
- Use `lucide-react` for UI icons.
- Don't build after every little change. If `npm run check` passes, assume changes work.

## Topic-specific Guidelines

- [Application documentation](./docs/APP.md) - **Start here.** Architecture, handlers, processor, protocol, components, config knobs
- [IPC patterns](.agents/ipc-patterns.md) - oRPC router, handlers, schemas, actions, context middleware
- [UI patterns](.agents/ui-patterns.md) - Tailwind v4 CSS-first config, shadcn/ui radix-mira style, semantic colors
- [Electron patterns](.agents/electron-patterns.md) - Main process, preload, custom protocol, native modules, packaging
- [TypeScript conventions](.agents/typescript.md) - Casting rules, prefer type inference
- [Workflow](.agents/workflow.md) - Build commands, validation approach, dev workflow
