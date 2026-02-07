import { NewSessionMenu } from "./NewSessionMenu";

interface EmptyStateProps {
  variant?: "no-project" | "no-sessions";
}

export function EmptyState({ variant = "no-project" }: EmptyStateProps) {
  if (variant === "no-sessions") {
    return (
      <div className="empty-state">
        <div className="empty-state-content">
          <div className="empty-state-ascii">{">"} <span className="empty-state-cursor">_</span></div>
          <div className="empty-state-label">no sessions</div>
          <div className="empty-state-desc">spawn a session to get started.</div>
          <div className="empty-state-action">
            <NewSessionMenu variant="pill" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <div className="empty-state-content">
        <div className="empty-state-ascii">{">"} <span className="empty-state-cursor">_</span></div>
        <div className="empty-state-label">no active sessions</div>
        <div className="empty-state-desc">select a project from the sidebar.</div>
        <div className="empty-state-hint">click a project to get started</div>
      </div>
    </div>
  );
}
