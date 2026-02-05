import hljs from "highlight.js/lib/common";

export const EXT_TO_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", mts: "typescript",
  py: "python", rb: "ruby", rs: "rust", go: "go",
  java: "java", kt: "kotlin", cs: "csharp",
  c: "c", cpp: "cpp", cc: "cpp", h: "c", hpp: "cpp",
  css: "css", scss: "scss", less: "less",
  html: "xml", htm: "xml", xml: "xml", svg: "xml",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini",
  md: "markdown", sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  php: "php", swift: "swift", lua: "lua", r: "r",
  makefile: "makefile", dockerfile: "dockerfile",
};

export function detectLanguage(path: string): string | undefined {
  const name = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (name === "makefile") return "makefile";
  if (name === "dockerfile") return "dockerfile";
  const ext = name.split(".").pop() ?? "";
  return EXT_TO_LANG[ext];
}

export function highlightCode(code: string, language?: string): string {
  if (!code) return "";
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
