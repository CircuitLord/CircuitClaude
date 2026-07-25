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

## Sidebar Header

`~/sessions` on the left, actions on the right: `:edit` (text button, only with projects) and `+ add` (accent pill). Edit mode swaps the label to `~/projects` and the actions to a single `:done`.

## New Chat Button

`+ new chat` sits at the top of the session list, above every project section, as an accent pill button inset 12px to match the divider. It is an action, not a list entry, so it carries no selected state — nothing in the sidebar lights up for the new-chat page. Project headers never take a fill either; only session rows do.

## Project Sections

The sidebar groups sessions under the project they belong to. A section exists if the project is pinned or currently holds sessions, so one-offs disappear when their last session closes.

```
~/ProjectName                    [2]
 │ > session title text here      *
 │ > another session title
```

- **Header**: 38px tall, `padding: 0 12px`, 13px `--text-primary` with a fixed 18px `~/` prefix column in `--text-tertiary`. Hover fills with `--bg-elevated`. While it is the active project, prefix and name take the project's `--accent-text`. Clicking it makes the project active and lands on the new-session launcher. The name button is `align-self: stretch` so the full row height is the click target
- **Pinned marker `[*]`**: 11px, directly after the name, `--text-tertiary` (project `--accent-text` when active). Same glyph the launcher and edit mode use for the pin toggle, so `[*]` means pinned everywhere. Unpinned sections show nothing
- **Count `[N]`**: 11px, far right, same colors as the marker, hidden when the section is empty
- **Guide line**: 1px `--border-subtle` vertical rule from the children container's `::before`, `left: 16px`, which lands between the header's `~/` prefix and the rows' 26px text indent. That line is what marks the rows as children, so they carry no project label of their own
- Pinned sections come first in project order and never move; unpinned ones follow, most recently active first
- An empty pinned section is just its header — no placeholder row. Clicking the header is how you start a session there
- Pinning is toggled in edit mode (or the launcher's project picker), not from the section itself

## Edit Mode

`:edit` replaces the session list with the full project list — the one place projects are managed.

```
≡ ProjectName            [*] # x
```

- **Row**: 34px flat row, `padding: 0 12px`, 18px `≡` drag handle column (`cursor: grab`) that reorders projects and therefore the order of pinned sections
- **Pin `[*]`/`[ ]`**: filled when pinned and colored `--accent-text`, empty brackets when not
- **Theme `#`**: colored with the project's accent, opens a compact dropdown of `> # label` options
- **Remove `x`**: `--git-deleted` on hover, then swaps the row for an inline `remove? y/n` confirm that also takes y/n/Escape from the keyboard
- Drop indicators reuse the standard 1px accent line with glow, inset 12px
- Per-project colors come from `THEMES[project.theme].css`, forwarded as `--sidebar-project-*` inline vars on the section wrapper so both the header and its rows inherit them

## Session Entry Pattern

Session rows follow the standard flat-row entry, one monospace line each, nested under their project section.

```
> session title text here     [1] *
```

- **Row**: 34px tall, `padding: 0 8px 0 26px` so the text clears the guide line, no radius or border
- **Prefix**: the session type's own glyph (`>` claude, `c>` codex, `>_` terminal, `#` file) in `--text-tertiary` at `opacity: 0.6`, promoted to the project `--accent-text` at full opacity when active
- **Name**: flex:1, truncated, `--text-secondary` rising to `--text-primary` on hover/active. Preview (single-click file) tabs are italic
- **Trailing**: pane marker `[1]`/`[2]`, then one status glyph — `*` dirty (`--text-secondary`), `*` thinking (`tui-color-cycle`), `?` waiting (blinking amber). The status is swapped for the `x` close button on hover
- **Active**: filled with the project's own `--accent-muted` (passed down as `--sidebar-project-accent-muted`), no underline — the section header above owns the path context, so the fill alone carries selection

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
