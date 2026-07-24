import { useEffect, useRef } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";

const MIN_HEIGHT = 100;
const MAX_HEIGHT = 700;

export function BottomTerminal() {
  const height = useSettingsStore((s) => s.settings.bottomTerminalHeight);
  const activeProjectPath = useSessionStore((s) => s.activeProjectPath);
  const openProjects = useSessionStore((s) => s.bottomTerminalProjects);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const next = Math.min(Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta), MAX_HEIGHT);
      useSettingsStore.getState().update({ bottomTerminalHeight: next });
    }
    function onMouseUp() {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: height };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  // panel is only visible when the active project has its terminal open, but all
  // open projects stay mounted so their shells survive project switches
  const activeOpen = !!activeProjectPath && openProjects.has(activeProjectPath);
  if (openProjects.size === 0) return null;

  return (
    <div className="bottom-terminal" style={{ height, display: activeOpen ? "flex" : "none" }}>
      <div className="resize-handle-horizontal bottom-terminal-resize" onMouseDown={onResizeStart} />
      <div className="bottom-terminal-body">
        {[...openProjects].map((path) => (
          <div
            key={path}
            className="bottom-terminal-instance"
            style={{ display: path === activeProjectPath ? "flex" : "none" }}
          >
            <TerminalView
              tabId={`docked-shell:${path}`}
              projectPath={path}
              projectName={path.split(/[/\\]/).pop() ?? path}
              sessionType="terminal"
              ephemeral
              hideTitleBar
              onClose={() => useSessionStore.getState().toggleBottomTerminal(path)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
