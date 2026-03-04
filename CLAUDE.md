# CLAUDE.md

## Project Overview

CircuitClaude is a desktop IDE-like terminal manager for running multiple Claude Code CLI sessions across projects. React/TypeScript frontend + Rust/Tauri v2 backend. Tabbed terminal UI via xterm.js, PTY management via `portable-pty`, with conversation views, git integration, voice input (Whisper), notes, and a markdown editor.

## Notes

This project should follow the UI style guide in `system.md`. Check it anytime you change anything UI-related.

## Commands

```bash
npm run dev              # Vite dev server + Tauri window
tsc --noEmit             # Type-check TypeScript
npm run build            # Build frontend only
npm run tauri build      # Production desktop app (Windows installer)
cd src-tauri && cargo check  # Check Rust compiles
```

No test suites. No linter beyond TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`).

## Architecture

```
React UI (xterm.js, CodeMirror, Zustand stores)
    ↕  Tauri invoke() / Channel<T>
Rust Backend (Tauri commands → managers → portable-pty / whisper-rs)
```

**Frontend** (`src/`): React 19 + Zustand. Stores in `src/stores/` (sessionStore, projectStore, conversationStore, settingsStore, fileTreeStore, notesStore, voiceStore, gitStore, editorStore, claudeMdStore). IPC wrappers in `src/lib/`. Components in `src/components/`.

**Backend** (`src-tauri/src/`): Core modules:
- `lib.rs` — App setup, plugin/command registration
- `commands.rs` — Tauri IPC command handlers
- `pty_manager.rs` — PTY lifecycle: spawn, write, resize, kill
- `config.rs` — JSON persistence (`~/.config/CircuitClaude/`)
- `claude_manager.rs` — Claude API integration
- `conversation.rs` — Conversation state
- `git.rs` — Git operations
- `whisper_manager.rs` — Speech-to-text (CUDA-accelerated)
- `claude_title.rs` / `codex_title.rs` — Title generation

**Terminal I/O flow**: xterm.js → `writeSession()` invoke → Rust PTY stdin. PTY stdout → reader thread → `Channel.send()` → xterm.js `terminal.write()`.

## Key Conventions

- Tauri IPC commands: `snake_case` in Rust, invoked as `snake_case` from TypeScript
- PTY output streamed via Tauri `Channel<T>` (not events/listeners), passed as param to `spawn_session`
- Channel enum variants require `#[serde(tag = "type", content = "data")]`
- Tauri crate version (`~2.9`) must match `@tauri-apps/api` npm package major.minor

## Releases

Tag-triggered CI via `.github/workflows/release.yml`. Push a `v*` tag to build and publish.

- **Version bumps**: Update all three: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`
- **CUDA DLLs**: Bundled via `scripts/copy-cuda-dlls.cjs` (runs in `beforeBuildCommand`). Copies from local CUDA toolkit into `src-tauri/cuda-runtime/` (gitignored). CI must match local CUDA version (**13.1**). If version changes, update: CI workflow `cuda:` field, DLL filenames in `tauri.conf.json` resources, and the copy script.
- **Tauri versions**: Rust crate and npm package major.minor must match (e.g. `tauri ~2.9` ↔ `@tauri-apps/api ^2.9.x`)

## Platform Notes

- Windows-only: PTY spawns via `cmd.exe /c claude` (CLI is an npm global `.cmd` shim)
- `portable-pty` uses ConPTY on Windows 10+
- `predev` script kills existing process on port 1420 before Vite starts
