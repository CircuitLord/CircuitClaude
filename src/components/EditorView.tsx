import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { useEditorStore } from "../stores/editorStore";
import { markdownLivePreview } from "./editorLivePreview";

const circuitTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-base)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "14px",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "var(--accent-text)",
    padding: "8px 0 8px 12px",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--accent-text)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-muted) !important",
  },
  ".cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--accent-muted) !important",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-surface)",
    color: "var(--text-tertiary)",
    border: "none",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text-secondary)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--bg-elevated)",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
});

interface EditorViewProps {
  tabId: string;
  filePath: string;
  fileName: string;
}

export function EditorViewComponent({ tabId, filePath, fileName: _fileName }: EditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { files, loadFile, updateContent, saveFile } = useEditorStore();
  const fileState = files.get(tabId);

  // Load file on mount
  useEffect(() => {
    loadFile(tabId, filePath);
  }, [tabId, filePath, loadFile]);

  // Initialize/update CodeMirror
  useEffect(() => {
    if (!containerRef.current || !fileState || fileState.loading) return;

    // If editor already exists, don't recreate (content is managed internally)
    if (editorViewRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          saveFile(tabId, filePath);
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: fileState.content,
      extensions: [
        saveKeymap,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        markdown(),
        markdownLivePreview,
        circuitTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            updateContent(tabId, update.state.doc.toString());
            if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
            autosaveTimer.current = setTimeout(() => saveFile(tabId, filePath), 1500);
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      view.destroy();
      editorViewRef.current = null;
    };
    // Only run when loading completes — editor manages its own state after that
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileState?.loading]);

  if (!fileState || fileState.loading) {
    return (
      <div className="editor-view editor-view--loading">
        <span className="editor-loading-text">loading...</span>
      </div>
    );
  }

  if (fileState.error) {
    return (
      <div className="editor-view editor-view--error">
        <span className="editor-error-text">error: {fileState.error}</span>
      </div>
    );
  }

  return <div ref={containerRef} className="editor-view" />;
}
