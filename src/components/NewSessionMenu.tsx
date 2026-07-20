import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { spawnNewSession } from "../lib/sessions";
import { useSettingsStore } from "../stores/settingsStore";
import { getSessionTypes } from "../lib/sessionTypes";

interface NewSessionMenuProps {
  variant: "pill" | "sidebar";
  projectPath?: string;
}

export function NewSessionMenu({ variant, projectPath }: NewSessionMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const editableSessionTypes = useSettingsStore((s) => s.settings.sessionTypes);
  const sessionTypes = getSessionTypes(editableSessionTypes);

  // sidebar clips overflow, so that dropdown is portaled and positioned from the button rect
  useLayoutEffect(() => {
    if (!open || variant !== "sidebar") return;
    const rect = containerRef.current?.getBoundingClientRect();
    const width = dropdownRef.current?.offsetWidth ?? 160;
    if (!rect) return;
    setMenuPos({
      top: rect.bottom + 2,
      left: Math.min(rect.left, window.innerWidth - width - 8),
    });
  }, [open, variant]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const inside = containerRef.current?.contains(target) || dropdownRef.current?.contains(target);
      if (!inside) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement)?.blur?.();
        setOpen(false);
      }
    }
    function close() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function handleSelect(id: string) {
    setOpen(false);
    spawnNewSession(id, projectPath);
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

  if (variant === "sidebar") {
    return (
      <div className="new-session-menu" ref={containerRef} onClick={(e) => e.stopPropagation()}>
        <button
          className="sidebar-entry-spawn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title="New session"
        >
          +
        </button>
        {open && createPortal(
          <div
            className="new-session-dropdown new-session-dropdown--sidebar"
            ref={dropdownRef}
            style={{ top: menuPos.top, left: menuPos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            {dropdownContent}
          </div>,
          document.body
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
