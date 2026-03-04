# CircuitClaude — TUI Style Guide

Terminal UI (TUI) aesthetic. The app manages CLI sessions, so the chrome should feel like it belongs in a terminal — monospace type, ASCII indicators, flat rows, no cards or rounded surfaces in navigation. Decorative elements are replaced with typographic ones.

## Principles

- Monospace everywhere (`--font-mono`) — no sans-serif in navigational chrome
- ASCII characters replace SVG icons: `>` for selection, `*` for alive, `:` for clickable command, `+` for actions
- Flat rows, not cards — no background, no border, no border-radius on list items
- Labels read like paths or commands: `~/projects`, `:settings`, `+ new`
- No uppercase transforms, no letter-spacing, normal font weight (400) for labels
- Animations use `step-end` timing for a digital on/off feel, not smooth easing

## Entry Pattern

Each navigable item is a flat row (36px tall), laid out as a single monospace line:

```
> item-name  * [2]
```

- **Prefix `>`**: fixed 14px width, transparent when inactive, `--accent-text` when active
- **Name**: flex:1, 13px mono, `--text-secondary` default, `--text-primary` on hover/active, truncated with ellipsis
- **Alive `*`**: blinking asterisk (`step-end`, 1.2s cycle), `--accent-text` — indicates a live process
- **Count `[N]`**: `--text-tertiary` default, `--accent-text` when active

### Active state
- Background: `var(--accent-muted)`
- `::after` bottom underline: 1px, inset 12px from each side, colored `var(--accent)` with `box-shadow: 0 0 6px var(--accent)` glow
- No left border — the accent underline is the sole active indicator

### Hover state
- Background: `var(--bg-elevated)`, text promoted to `--text-primary`
- No border, no radius

## Action Buttons

Two tiers of action button, both monospace, no SVG icons.

### Inline text buttons (low emphasis)

- Plain text, no background, no border
- `--text-tertiary` default, `--accent-text` on hover
- Examples: `:settings`, `:esc`
- SVG icons hidden via `display: none` if they exist in markup

### Accent pill buttons (high emphasis)

- Background `var(--accent-muted)`, text `var(--accent-text)`
- `border: 1px solid transparent`, `border-radius: 4px`, `padding: 4px 10px`
- 13px `--font-mono`, `cursor: pointer`
- Hover: background `var(--accent-muted-hover)`, `border-color: var(--accent)`
- Transition: `background 0.1s, border-color 0.1s`
- Label starts with `+`: `+ add`, `+ new session`
- Use for primary actions in headers, empty states, and anywhere a call-to-action needs more visual weight than a text button

## `:` Command Prefix

The `:` prefix is a clickable affordance — it always means the element is actionable. If text starts with `:`, the user can click it. If it doesn't, it's a static label.

- **Clickable commands**: `:settings`, `:reset defaults`, `:esc` — these are buttons styled as plain text
- **Static labels**: `settings` (dialog title), `~theme` (section heading) — no `:` prefix, no click handler
- Never use `:` on non-interactive text. Never omit `:` on a text-only button that follows the command pattern.

## Section Headers

- Read like Unix paths or labels: `~/projects`
- 13px, weight 400, `--text-tertiary`
- Separated from content by a `.sidebar-divider`: 1px `--border-subtle` with horizontal inset (`margin: 0 12px`)
- No bottom border on the header element itself

## Separators

- Use `border-top: 1px solid var(--border-subtle)` on footer items (e.g. settings button)
- Use `.sidebar-divider` (standalone 1px line) between header and list content
- No decorative borders on entries themselves

## Scrollbars

- Width: `4px`
- Track: `transparent`
- Thumb: `var(--border-visible)`, `border-radius: 2px`
- Use `-webkit-scrollbar`, `-webkit-scrollbar-track`, `-webkit-scrollbar-thumb` pseudo-elements

## Animations

- `tui-blink`: `step-end` timing, 1.2s cycle — hard on/off for waiting indicators
- `tui-color-cycle`: `step-end` timing, 2.4s cycle — steps through `--text-tertiary` → `--accent-text` → `--accent` → `--accent-text` for alive/thinking indicators. Character stays fully visible, only color changes.
- Avoid `ease`, `ease-in-out`, or smooth fades on TUI elements
- Transitions for hover/color changes stay at 0.1s (fast, not animated)
