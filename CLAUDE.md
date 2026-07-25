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

**Frontend** (`src/`): React 19 + Zustand. Stores in `src/stores/` (sessionStore, projectStore, conversationStore, settingsStore, fileTreeStore, notesStore, voiceStore, gitStore, editorStore, commandPaletteStore). IPC wrappers in `src/lib/`. Components in `src/components/`.

**Backend** (`src-tauri/src/`): Core modules:
- `lib.rs` — App setup, plugin/command registration
- `commands.rs` — Tauri IPC command handlers
- `pty_manager.rs` — PTY lifecycle: spawn, write, resize, kill
- `config.rs` — JSON persistence (`~/.config/CircuitClaude/`)
- `claude_manager.rs` — Claude API integration
- `conversation.rs` — Conversation state
- `git.rs` — Git operations
- `remote.rs` — Remote (ssh) projects: `ssh://user@host:port/path` project paths, persistent command channel
- `whisper_manager.rs` — Speech-to-text (CUDA-accelerated)
- `file_watcher.rs` — File system watching with debouncing
- `claude_title.rs` / `codex_title.rs` — Title generation

**Terminal I/O flow**: xterm.js → `writeSession()` invoke → Rust PTY stdin. PTY stdout → reader thread → `Channel.send()` → xterm.js `terminal.write()`.

## Remote projects

A project path starting with `ssh://` is remote. Everything that touches the project (PTY spawn, git,
file tree, file read/write, notes) branches on `remote::locate(path)`.

- **Commands** (git, ls, cat) share one long-lived `ssh <host> bash -l` per host, framed by exit-code
  markers. Windows OpenSSH has no connection multiplexing, so per-command connects would re-handshake
- **Sessions** spawn through the same ConPTY as local ones, wrapped in ssh
- Credentials live in `remotes.json` keyed by authority (`user@host:port`); ssh-agent and `~/.ssh/config`
  cover everything else. The command channel runs with `BatchMode=yes`, so keys must not prompt
- Local-only features are gated off for remote projects: pi chat, file watching, Everything search

Both remote flavors are supported, distinguished by the path shape (a drive letter means windows):

| | unix remote (`/srv/app`) | windows remote (`C:/Projects/app`) |
|---|---|---|
| session | `cd '<path>' && exec bash -lc '<cmd>'` | `cd /d "<path>" && <cmd>` (cmd.exe, same as local) |
| command channel | `bash -l` | `"C:\Program Files\Git\bin\bash.exe" -l` |
| requires | bash, git, coreutils | Git for Windows (msys bash + coreutils) |

`Conn::open` tries the shell launchers in order and keeps the one that works. A windows host must land
on an msys shell (`uname -s` starting MINGW/MSYS/CYGWIN) or `C:/...` paths would resolve against the
wrong filesystem, so a WSL bash on PATH is rejected. `host_is_windows` settles the ambiguous case
(browsing before a path is picked) by checking whether the server expands `%COMSPEC%`.

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
