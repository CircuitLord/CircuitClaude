import { useEffect, useRef } from "react";
import type { SlashCommand } from "../lib/slashCommands";

interface SlashCommandMenuProps {
  matches: SlashCommand[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SlashCommandMenu({ matches, selectedIndex, onSelect }: SlashCommandMenuProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="slash-command-menu">
      {matches.map((cmd, i) => (
        <div
          key={cmd.name}
          ref={i === selectedIndex ? activeRef : undefined}
          className={`slash-command-option ${i === selectedIndex ? "slash-command-option--active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
        >
          <span className="slash-command-option-marker">{i === selectedIndex ? ">" : "\u00A0"}</span>
          <span className="slash-command-option-name">/{cmd.name}</span>
          <span className="slash-command-option-desc">{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}
