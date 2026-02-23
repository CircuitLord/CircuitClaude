# CircuitClaude

A desktop terminal session manager for running multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions across different projects. Built with React/TypeScript and Rust/Tauri v2, featuring a tabbed terminal UI powered by xterm.js.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed globally (`npm i -g @anthropic-ai/claude-code`)
- Windows 10+ (uses ConPTY for terminal emulation)

## Setup

```bash
npm install
```

## Development

```bash
npm run tauri dev
```

This starts the Vite dev server and opens the Tauri desktop window with hot-reload.

## Build

```bash
# Type-check TypeScript
tsc --noEmit

# Check Rust compiles
cd src-tauri && cargo check && cd ..

# Build production desktop app (Windows MSI/NSIS installer)
npm run tauri build
```

The installer output will be in `src-tauri/target/release/bundle/`.

## Architecture

```
React UI (xterm.js terminals, Zustand stores)
    ↕  Tauri invoke() / Channel<T>
Rust Backend (Tauri commands → PtyManager → portable-pty)
```

- **Frontend** (`src/`): React 19, Zustand for state management, xterm.js for terminal rendering
- **Backend** (`src-tauri/src/`): Tauri v2 commands, PTY lifecycle management via `portable-pty`, JSON config persistence

## Tech Stack

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| UI       | React 19, TypeScript, xterm.js      |
| State    | Zustand                             |
| Desktop  | Tauri v2                            |
| Backend  | Rust, portable-pty                  |
| Build    | Vite, Cargo                         |
