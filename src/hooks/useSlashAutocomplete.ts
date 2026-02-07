import { useState, useMemo, useCallback } from "react";
import { filterSlashCommands, SLASH_COMMANDS } from "../lib/slashCommands";
import type { SlashCommand } from "../lib/slashCommands";

interface UseSlashAutocompleteArgs {
  inputValue: string;
  setInputValue: (value: string) => void;
  sendDirect: (text: string) => void;
}

export function useSlashAutocomplete({ inputValue, setInputValue, sendDirect }: UseSlashAutocompleteArgs) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Slash mode: input starts with `/` and has no space yet (still typing command name)
  const isSlashMode = inputValue.startsWith("/") && !inputValue.includes(" ");
  const query = isSlashMode ? inputValue.slice(1) : "";

  const matches: SlashCommand[] = useMemo(() => {
    if (!isSlashMode || dismissed) return [];
    if (query === "") return SLASH_COMMANDS;
    return filterSlashCommands(query);
  }, [isSlashMode, dismissed, query]);

  const isOpen = matches.length > 0;

  const selectCommand = useCallback((cmd: SlashCommand) => {
    if (cmd.autoSend) {
      setInputValue("");
      sendDirect("/" + cmd.name);
    } else {
      setInputValue("/" + cmd.name + " ");
    }
    setDismissed(true);
  }, [setInputValue, sendDirect]);

  const selectByIndex = useCallback((index: number) => {
    const cmd = matches[index];
    if (cmd) selectCommand(cmd);
  }, [matches, selectCommand]);

  const handleKey = useCallback((e: React.KeyboardEvent): boolean => {
    if (!isOpen) return false;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev <= 0 ? matches.length - 1 : prev - 1));
      return true;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev >= matches.length - 1 ? 0 : prev + 1));
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectByIndex(selectedIndex);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
      return true;
    }
    return false;
  }, [isOpen, matches.length, selectedIndex, selectByIndex]);

  const updateFromInput = useCallback((_value: string) => {
    setDismissed(false);
    setSelectedIndex(0);
  }, []);

  return {
    isOpen,
    matches,
    selectedIndex,
    handleKey,
    updateFromInput,
    selectByIndex,
  };
}
