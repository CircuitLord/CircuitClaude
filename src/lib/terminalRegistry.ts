import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";

interface TerminalEntry {
  terminal: Terminal;
  serializeAddon: SerializeAddon;
}

const registry = new Map<string, TerminalEntry>();

export function registerTerminal(
  tabId: string,
  terminal: Terminal,
  serializeAddon: SerializeAddon
): void {
  registry.set(tabId, { terminal, serializeAddon });
}

export function unregisterTerminal(tabId: string): void {
  registry.delete(tabId);
}

export function serializeAllTerminals(): Map<string, string> {
  const result = new Map<string, string>();
  for (const [tabId, entry] of registry) {
    try {
      result.set(tabId, entry.serializeAddon.serialize());
    } catch {
      // Terminal may have been disposed
    }
  }
  return result;
}
