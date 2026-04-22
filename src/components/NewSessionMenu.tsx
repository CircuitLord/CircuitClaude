import { useState, useRef, useEffect } from "react";
import { spawnNewSession } from "../lib/sessions";

interface NewSessionMenuProps {
  variant: "button" | "pill";
  targetPane?: 1 | 2;
}

const OPTIONS = [
  { type: "claude" as const, label: "claude" },
  { type: "codex" as const, label: "codex" },
  { type: "copilot" as const, label: "copilot" },
  { type: "opencode" as const, label: "opencode" },
  { type: "terminal" as const, label: "terminal" },
] as const;

export function NewSessionMenu({ variant, targetPane }: NewSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement)?.blur?.();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function handleSelect(type: "claude" | "codex" | "copilot" | "opencode" | "terminal") {
    setOpen(false);
    spawnNewSession(type === "terminal" ? "shell" : type, targetPane);
  }

  if (variant === "button") {
    return (
      <div className="new-session-menu" ref={containerRef}>
        <button
          className="terminal-tab-add"
          onClick={() => setOpen((v) => !v)}
          title="New session"
        >
          +
        </button>
        {open && (
          <div className="new-session-dropdown new-session-dropdown--tab">
            {OPTIONS.map((opt) => (
              <button
                key={opt.type}
                className="new-session-option"
                onClick={() => handleSelect(opt.type)}
              >
                <span className="new-session-option-marker">{">"}</span>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="new-session-menu" ref={containerRef}>
      <button
        className="project-header-spawn"
        onClick={() => setOpen((v) => !v)}
      >
        + new session
      </button>
      {open && (
        <div className="new-session-dropdown new-session-dropdown--pill">
          {OPTIONS.map((opt) => (
            <button
              key={opt.type}
              className="new-session-option"
              onClick={() => handleSelect(opt.type)}
            >
              <span className="new-session-option-marker">{">"}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
