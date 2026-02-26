// Copies CUDA runtime DLLs from the local CUDA toolkit to src-tauri/cuda-runtime/
// so Tauri can bundle them with the installer.
const fs = require("fs");
const path = require("path");

const DLLS = ["cublas64_13.dll", "cublasLt64_13.dll", "cudart64_13.dll"];
const destDir = path.join(__dirname, "..", "src-tauri", "cuda-runtime");

function findCudaBin() {
  const cudaPath = process.env.CUDA_PATH;
  if (cudaPath) {
    // CUDA 13+ puts DLLs in bin/x64/
    const x64 = path.join(cudaPath, "bin", "x64");
    if (fs.existsSync(x64)) return x64;
    return path.join(cudaPath, "bin");
  }
  // Common default location
  const defaultPath = "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v13.1\\bin\\x64";
  if (fs.existsSync(defaultPath)) return defaultPath;
  return null;
}

const cudaBin = findCudaBin();
if (!cudaBin) {
  console.log("CUDA toolkit not found — creating empty placeholders for Tauri build");
  fs.mkdirSync(destDir, { recursive: true });
  for (const dll of DLLS) {
    const dest = path.join(destDir, dll);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, "");
  }
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const dll of DLLS) {
  const src = path.join(cudaBin, dll);
  const dest = path.join(destDir, dll);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const sizeMB = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
    console.log(`  ${dll} (${sizeMB} MB)`);
    copied++;
  } else {
    console.warn(`  WARNING: ${dll} not found at ${src}`);
  }
}

console.log(`Copied ${copied}/${DLLS.length} CUDA DLLs to src-tauri/cuda-runtime/`);
