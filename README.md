# CircuitClaude

A desktop terminal session manager for running multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions across different projects. Built with React/TypeScript and Rust/Tauri v2, featuring a tabbed terminal UI powered by xterm.js.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed globally (`npm i -g @anthropic-ai/claude-code`)
- [CMake](https://cmake.org/download/) on PATH (required by `whisper-rs-sys` to compile whisper.cpp)
- Windows 10+ (uses ConPTY for terminal emulation)

### CUDA Setup (GPU-accelerated voice transcription)

Voice input uses [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for local speech-to-text. It is built with CUDA support by default, which requires the NVIDIA CUDA Toolkit to compile.

1. **Install the [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)** (v13.x required — must match the version used in CI builds)
   - Select: Windows → x86_64 → your OS version → exe (local)
   - At minimum, install: **CUDA Runtime**, **Development (cuBLAS, headers)**, and **NVCC compiler**
   - You can skip the driver update, Nsight tools, and samples

2. **Verify the install:**
   ```bash
   nvcc --version          # should print CUDA compilation tools info
   echo $CUDA_PATH         # should point to the toolkit, e.g. C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.x
   ```

3. **Restart your terminal** after install so the new `CUDA_PATH` environment variable is picked up.

> **Important:** The CUDA major version must match between your local install and the CI build (currently CUDA 13.1). If you install a pre-built release, you need the same CUDA major version or the app will fail with missing DLL errors (e.g. `cublas64_13.dll not found`).

If you don't have an NVIDIA GPU or don't want to install the CUDA Toolkit, build with CPU-only whisper:
```bash
npm run tauri build -- --no-default-features
```
CPU mode still works but is significantly slower for larger models (medium.en: ~5s/pass on CPU vs <0.5s with CUDA).

## Install (pre-built)

Download the latest installer from [GitHub Releases](https://github.com/CircuitLord/CircuitClaude/releases/latest).

Requirements for pre-built releases:
- Windows 10+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed globally
- [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) v13.x (for GPU-accelerated voice transcription)

The app will auto-check for updates on launch and prompt you when a new version is available.

## Build from source

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
