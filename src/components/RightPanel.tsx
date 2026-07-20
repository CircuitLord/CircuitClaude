import { useEffect, useRef } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { NotesPanel } from "./NotesPanel";
import { PinsPanel } from "./PinsPanel";
import { GitPanel } from "./GitPanel";
import { FilesPanel } from "./FilesPanel";

const MIN_WIDTH = 200;
const MAX_WIDTH = 800;

export function RightPanel() {
  const tab = useSettingsStore((s) => s.settings.rightPanelTab);
  const width = useSettingsStore((s) => s.settings.rightPanelWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - e.clientX;
      const newWidth = Math.min(Math.max(MIN_WIDTH, dragRef.current.startWidth + delta), MAX_WIDTH);
      useSettingsStore.getState().update({ rightPanelWidth: newWidth });
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
    dragRef.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  if (!tab) return null;

  return (
    <div className="right-panel" style={{ width, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}>
      <div className="resize-handle-vertical" onMouseDown={onResizeStart} />
      {tab === "files" && <FilesPanel />}
      {tab === "source" && <GitPanel />}
      {tab === "notes" && <NotesPanel />}
      {tab === "pins" && <PinsPanel />}
    </div>
  );
}
