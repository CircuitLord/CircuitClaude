import { useEffect, useCallback, useRef } from "react";
import { useNotesStore } from "../stores/notesStore";

export function NotesEditor() {
  const { isOpen, projectPath, content, loading, saving, close, setContent, save } =
    useNotesStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    },
    [close, save]
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  useEffect(() => {
    if (isOpen && !loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen, loading]);

  if (!isOpen) return null;

  const projectName = projectPath.replace(/\\/g, "/").split("/").pop() ?? "notes";

  return (
    <div className="dialog-overlay" onMouseDown={close}>
      <div className="notes-editor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="notes-editor-header">
          <span className="notes-editor-path">~/notes/{projectName}</span>
          <div className="notes-editor-actions">
            {saving && <span className="notes-editor-status">saving...</span>}
            <button
              className="notes-editor-save-btn"
              onClick={save}
              disabled={saving}
            >
              :save
            </button>
            <button className="notes-editor-close" onClick={close}>
              :esc
            </button>
          </div>
        </div>
        <div className="notes-editor-body">
          {loading ? (
            <div className="notes-editor-loading">loading...</div>
          ) : (
            <textarea
              ref={textareaRef}
              className="notes-editor-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="jot ideas here..."
              spellCheck={false}
            />
          )}
        </div>
        <div className="notes-editor-footer">
          <span className="notes-editor-hint">ctrl+s save</span>
          <span className="notes-editor-hint">esc close</span>
        </div>
      </div>
    </div>
  );
}
