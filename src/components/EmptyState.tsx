export function EmptyState() {
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
