# CircuitClaude

A desktop terminal session manager for running multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI sessions across different projects. Built with React/TypeScript and Rust/Tauri v2, featuring a tabbed terminal UI powered by xterm.js.

## Install

Download the latest installer from [GitHub Releases](https://github.com/CircuitLord/CircuitClaude/releases/latest).

**Requirements:**
- Windows 10+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed globally (`npm i -g @anthropic-ai/claude-code`)

CUDA runtime DLLs are bundled with the installer — no separate CUDA install needed. Voice transcription will use GPU acceleration automatically if you have an NVIDIA GPU, otherwise it falls back to CPU.

The app auto-checks for updates on launch and prompts you when a new version is available.

## Architecture

```
React UI (xterm.js terminals, Zustand stores)
    ↕  Tauri invoke() / Channel<T>
Rust Backend (Tauri commands → PtyManager → portable-pty)
```

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| UI       | React 19, TypeScript, xterm.js      |
| State    | Zustand                             |
| Desktop  | Tauri v2                            |
| Backend  | Rust, portable-pty                  |
| Build    | Vite, Cargo                         |

---

## Development

Everything below is for building from source.

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed globally (`npm i -g @anthropic-ai/claude-code`)
- [CMake](https://cmake.org/download/) on PATH (required by `whisper-rs-sys` to compile whisper.cpp)
- Windows 10+ (uses ConPTY for terminal emulation)

### CUDA Setup (GPU-accelerated voice transcription)

Voice input uses [whisper.cpp](https://github.com/ggerganov/whisper.cpp) for local speech-to-text. CUDA support is enabled by default, which requires the NVIDIA CUDA Toolkit to compile.

1. **Install the [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)** (v13.x required — must match CI)
   - At minimum, install: **CUDA Runtime**, **Development (cuBLAS, headers)**, and **NVCC compiler**
   - You can skip the driver update, Nsight tools, and samples

2. **Verify the install:**
   ```bash
   nvcc --version          # should print CUDA compilation tools info
   echo $CUDA_PATH         # should point to the toolkit, e.g. C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.x
   ```

3. **Restart your terminal** after install so `CUDA_PATH` is picked up.

To build without CUDA (CPU-only whisper):
```bash
npm run tauri build -- --no-default-features
```

### Setup

```bash
npm install
```

### Run

```bash
npm run tauri dev
```

Starts the Vite dev server and opens the Tauri desktop window with hot-reload.

### Build

```bash
# Type-check TypeScript
tsc --noEmit

# Check Rust compiles
cd src-tauri && cargo check && cd ..

# Build production desktop app (Windows MSI/NSIS installer)
npm run tauri build
```

The installer output will be in `src-tauri/target/release/bundle/`.

The build automatically copies CUDA runtime DLLs from your local CUDA toolkit into the installer via `scripts/copy-cuda-dlls.cjs`. If CUDA isn't installed, empty placeholders are created and the build proceeds without GPU support.

### Releases

Releases are automated via GitHub Actions. To publish a new version:

1. Bump version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json`
2. Commit, tag, and push:
   ```bash
   git tag v0.x.0
   git push origin master --tags
   ```
3. CI builds the installer with CUDA DLLs bundled and publishes to GitHub Releases
4. Existing installations detect the update on next launch

> **Important:** The CI CUDA toolkit version (in `.github/workflows/release.yml`) must match the major version used locally (currently 13.1). A mismatch produces binaries that look for the wrong DLLs at runtime.
