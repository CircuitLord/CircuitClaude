import { useEffect, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { formatAge } from "../lib/time";

// pinned above the footer, expands upward so the header row never moves
export function SidebarArchive() {
  const archivedSessions = useSessionStore((s) => s.archivedSessions);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const sessionTitles = useSessionStore((s) => s.sessionTitles);
  const lastActivity = useSessionStore((s) => s.lastActivity);
  const [open, setOpen] = useState(false);

  // re-render so the "x ago" stamps stay honest
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  if (archivedSessions.length === 0) return null;

  return (
    <div className="sidebar-archive">
      {open && (
        <div className="sidebar-archive-list">
          {archivedSessions.map((s) => {
            const label = sessionTitles.get(s.id) ?? s.projectName;
            return (
              <div
                key={s.id}
                className="sidebar-archived"
                role="button"
                tabIndex={0}
                title={`${label} — click to restore`}
                onClick={() => restoreSession(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    restoreSession(s.id);
                  }
                }}
              >
                <span className="sidebar-archived-name">{label}</span>
                <span className="sidebar-archived-age">{formatAge(lastActivity.get(s.id) ?? s.createdAt)}</span>
                <span className="sidebar-archived-undo">undo</span>
              </div>
            );
          })}
        </div>
      )}
      <button className="sidebar-archive-header" onClick={() => setOpen((v) => !v)}>
        <span className="sidebar-archive-caret">{open ? "^" : ">"}</span>
        <span className="sidebar-archive-label">~/archive</span>
        <span className="sidebar-archive-count">[{archivedSessions.length}]</span>
      </button>
    </div>
  );
}
