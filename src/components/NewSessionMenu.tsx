import { useState, useRef, useEffect } from "react";
import { spawnNewSession } from "../lib/sessions";

interface NewSessionMenuProps {
  variant: "button" | "pill";
}

const OPTIONS = [
  { type: "claude" as const, label: "claude" },
  { type: "opencode" as const, label: "opencode" },
  { type: "terminal" as const, label: "terminal" },
] as const;

export function NewSessionMenu({ variant }: NewSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleSelect(type: "claude" | "opencode" | "terminal") {
    setOpen(false);
    spawnNewSession(type === "terminal" ? "shell" : type);
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
