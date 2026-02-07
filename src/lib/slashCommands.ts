export interface SlashCommand {
  name: string;
  description: string;
  autoSend: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "add", description: "add files to context", autoSend: false },
  { name: "bug", description: "report a bug", autoSend: false },
  { name: "clear", description: "clear conversation", autoSend: true },
  { name: "compact", description: "compact conversation", autoSend: true },
  { name: "config", description: "open config panel", autoSend: true },
  { name: "context", description: "show context window", autoSend: true },
  { name: "copy", description: "copy last response", autoSend: true },
  { name: "cost", description: "show token costs", autoSend: true },
  { name: "diff", description: "show changes diff", autoSend: true },
  { name: "doctor", description: "run diagnostics", autoSend: true },
  { name: "edit", description: "edit a file", autoSend: false },
  { name: "help", description: "show available commands", autoSend: true },
  { name: "hooks", description: "manage hooks", autoSend: true },
  { name: "init", description: "initialize project config", autoSend: true },
  { name: "listen", description: "listen for dictation", autoSend: true },
  { name: "login", description: "authenticate with Claude", autoSend: true },
  { name: "logout", description: "sign out of Claude", autoSend: true },
  { name: "mcp", description: "manage MCP servers", autoSend: true },
  { name: "memory", description: "edit CLAUDE.md memory", autoSend: true },
  { name: "model", description: "switch model", autoSend: false },
  { name: "permissions", description: "manage permissions", autoSend: true },
  { name: "plan", description: "toggle plan mode", autoSend: true },
  { name: "pr-comments", description: "view PR comments", autoSend: true },
  { name: "review", description: "code review", autoSend: true },
  { name: "status", description: "show session status", autoSend: true },
  { name: "terminal-setup", description: "setup terminal theme", autoSend: true },
  { name: "theme", description: "change theme", autoSend: false },
  { name: "vim", description: "toggle vim mode", autoSend: true },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(q));
}
