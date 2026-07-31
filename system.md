# CircuitClaude — TUI Style Guide

Terminal UI aesthetic. The app manages CLI sessions, so the chrome should feel like it belongs in a terminal: monospace type, ASCII indicators, flat rows, no cards or rounded surfaces in navigation. Decorative elements are replaced with typographic ones.

Scope: this file holds the rules that generalize. Individual components are not documented here, and new ones do not get a section just for existing.

## Principles

- Monospace everywhere (`--font-mono`), no sans-serif in navigational chrome
- ASCII replaces SVG icons: `>` selection, `*` alive, `?` waiting, `:` clickable command, `+` action, `[*]` pinned, `[N]` count, `≡` drag handle
- Flat rows, not cards: no background, no border, no border-radius on list items
- Labels read like paths or commands: `~/projects`, `:settings`, `+ new`
- No uppercase transforms, no letter-spacing, weight 400 for labels
- Nothing gets more visual weight than it needs. Secondary affordances shrink and dim rather than gaining chrome

## Type & Sizing

- 13px is the default for rows, labels, and buttons
- 11-12px for metadata and demoted sections (counts, pin markers, timestamps, archive)
- Rows are flat single lines, 34-38px for primary navigation, 26px for dense or secondary lists
- Horizontal padding is 12px, and it is also the inset for dividers and active underlines so everything lines up on one vertical rhythm
- Nested rows indent their text past the parent's prefix column rather than carrying a label of their own

## Color

Everything comes from CSS vars. Never hardcode a hex in component CSS.

- Text: `--text-primary` (active/hover), `--text-secondary` (default row text), `--text-tertiary` (metadata, idle affordances)
- Surfaces: `--bg-surface`, `--bg-elevated` (hover)
- Accent: `--accent` (lines, glow), `--accent-text` (text/glyphs), `--accent-muted` / `--accent-muted-hover` (fills)
- Borders: `--border-subtle` (dividers), `--border-visible` (scrollbar thumb, dialog edges)

Per-project theming: `THEMES[project.theme].css` is forwarded as inline `--sidebar-project-*` vars on the section wrapper, so a section and its rows inherit the project's accent. Anything project-scoped reads those vars with the global accent as fallback.

## Entry Pattern

Every navigable item is one monospace line:

```
> item-name                    * [2]
```

- **Prefix**: fixed-width column, `--text-tertiary` at reduced opacity when idle, promoted to `--accent-text` at full opacity when active
- **Name**: `flex: 1`, truncated with ellipsis
- **Trailing**: status glyph and/or count, `--text-tertiary`, taking the accent when active
- **Hover**: `--bg-elevated` fill, text to `--text-primary`. Destructive affordances (`x`) may replace a status glyph on hover
- **Active**: either an `--accent-muted` fill or a 1px `--accent` underline inset 12px with `box-shadow: 0 0 6px var(--accent)` glow. Pick one per context, never both. Drop indicators reuse that same underline

## Buttons

Two tiers, both monospace, no SVG icons.

- **Text buttons** (low emphasis): plain text, no background or border, `--text-tertiary` going to `--accent-text` on hover. Labelled with the `:` prefix
- **Accent pills** (high emphasis): `--accent-muted` background, `--accent-text` label, `1px solid transparent` border, `border-radius: 4px`, `padding: 4px 10px`. Hover swaps to `--accent-muted-hover` with `border-color: var(--accent)`. Labelled with a `+` prefix. Reserved for primary actions in headers and empty states

## The `:` Prefix

`:` means clickable, always. `:settings`, `:reset defaults`, `:esc` are buttons styled as plain text. Static labels never take it (`settings` as a dialog title, `~theme` as a heading). Never use `:` on non-interactive text, never omit it on a text-only button.

## Structure

- Section headers read like paths (`~/projects`), 13px weight 400 `--text-tertiary`, no bottom border of their own
- `.sidebar-divider` (1px `--border-subtle`, `margin: 0 12px`) separates a header from its content
- Footers use `border-top: 1px solid var(--border-subtle)`
- Entries themselves never carry decorative borders
- Scrollbars: 4px wide, transparent track, `--border-visible` thumb at `border-radius: 2px`, via `-webkit-scrollbar*` pseudo-elements

## Motion

- Hover and color transitions are 0.1s. Fast, not animated
- Indicator animations use `step-end` for a digital on/off feel: `tui-blink` (1.2s) for waiting, `tui-color-cycle` (2.4s) stepping `--text-tertiary` to `--accent-text` to `--accent` for alive/thinking. Color changes only, the glyph stays fully visible
- No `ease`, `ease-in-out`, or smooth fades on TUI elements
