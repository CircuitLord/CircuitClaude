import { useState, useRef, useEffect } from "react";
import { spawnNewSession } from "../lib/sessions";
import { useSettingsStore } from "../stores/settingsStore";

interface NewSessionMenuProps {
  variant: "button" | "pill";
  targetPane?: 1 | 2;
}

export function NewSessionMenu({ variant, targetPane }: NewSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionTypes = useSettingsStore((s) => s.settings.sessionTypes);

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

  function handleSelect(id: string) {
    setOpen(false);
    spawnNewSession(id, targetPane);
  }

  const dropdownContent = (
    <>
      {sessionTypes.map((st) => (
        <button
          key={st.id}
          className="new-session-option"
          onClick={() => handleSelect(st.id)}
        >
          <span className="new-session-option-marker">{">"}</span>
          {st.name}
        </button>
      ))}
    </>
  );

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
            {dropdownContent}
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
          {dropdownContent}
        </div>
      )}
    </div>
  );
}
