# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CircuitClaude is a desktop terminal session manager for running multiple Claude Code CLI sessions across different projects. Built with a React/TypeScript frontend and a Rust/Tauri v2 backend, it provides a tabbed terminal UI powered by xterm.js with PTY management via `portable-pty`.

## Commands

```bash
# Development (starts Vite dev server + Tauri window)
npm run dev

# Type-check TypeScript
tsc --noEmit

# Build frontend only
npm run build

# Build production desktop app (Windows MSI/NSIS installer)
npm run tauri build

# Check Rust backend compiles
cd src-tauri && cargo check
```

There are no test suites configured. No linter beyond TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`).

## Architecture

```
React UI (xterm.js terminals, Zustand stores)
    ↕  Tauri invoke() / Channel<T>
Rust Backend (Tauri commands → PtyManager → portable-pty)
```

**Frontend** (`src/`): React 19 + Zustand for state. Two stores: `sessionStore` (terminal session CRUD) and `projectStore` (project list persistence). IPC wrappers live in `src/lib/pty.ts` and `src/lib/config.ts`.

**Backend** (`src-tauri/src/`): Four Rust modules:
- `lib.rs` - Tauri app setup, plugin registration, command handler registration
- `commands.rs` - Tauri IPC command handlers (thin wrappers over managers)
- `pty_manager.rs` - Core PTY lifecycle: spawn (`cmd.exe /c claude`), write, resize, kill. Uses a reader thread to stream output to the frontend via `tauri::ipc::Channel<PtyOutputEvent>`
- `config.rs` - JSON persistence to `~/.config/CircuitClaude/projects.json`

**Data flow for terminal I/O**: User types in xterm.js → `writeSession()` invoke → Rust writes to PTY stdin. PTY stdout → reader thread → `Channel.send()` → xterm.js `terminal.write()`.

## Key Conventions

- Tauri IPC commands use `snake_case` in Rust, invoked as `snake_case` strings from TypeScript via `invoke()`
- PTY output is streamed using Tauri's `Channel<T>` pattern (not events/listeners). The channel is passed as a parameter to `spawn_session`
- Enum variants sent over Channel require `#[serde(tag = "type", content = "data")]` for JS deserialization
- Tauri Rust crate version (`~2.9` in Cargo.toml) must match `@tauri-apps/api` npm package major.minor version

## Platform Notes

- Windows-only PTY invocation: `cmd.exe /c claude` (Claude CLI is an npm global `.cmd` shim)
- `portable-pty` uses ConPTY on Windows 10+
- The `predev` script kills any existing process on port 1420 before starting Vite
