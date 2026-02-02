function TerminalIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="10" width="36" height="28" rx="4" />
      <path d="M16 22L22 26L16 30" />
      <path d="M26 30H32" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 3V13M3 8H13" />
    </svg>
  );
}

interface EmptyStateProps {
  variant?: "no-project" | "no-sessions";
  onSpawn?: () => void;
}

export function EmptyState({ variant = "no-project", onSpawn }: EmptyStateProps) {
  if (variant === "no-sessions") {
    return (
      <div className="empty-state">
        <div className="empty-state-content">
          <div className="empty-state-icon">
            <TerminalIcon />
          </div>
          <h2>No sessions</h2>
          <p>This project has no active sessions. Spawn one to get started.</p>
          {onSpawn && (
            <button className="empty-state-spawn" onClick={onSpawn}>
              <PlusIcon />
              <span>New Session</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <div className="empty-state-content">
        <div className="empty-state-icon">
          <TerminalIcon />
        </div>
        <h2>No active sessions</h2>
        <p>Select a project from the sidebar to launch a new Claude Code session.</p>
        <div className="empty-state-hint">
          <span className="empty-state-kbd">Click</span>
          a project to get started
        </div>
      </div>
    </div>
  );
}
