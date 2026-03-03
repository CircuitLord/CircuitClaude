import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, bracketMatching } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { useEditorStore } from "../stores/editorStore";

const circuitHighlight = HighlightStyle.define([
  { tag: tags.heading1, color: "#a78bfa", fontWeight: "bold" },
  { tag: tags.heading2, color: "#a78bfa", fontWeight: "bold" },
  { tag: tags.heading3, color: "#a78bfa", fontWeight: "bold" },
  { tag: tags.heading4, color: "#a78bfa" },
  { tag: tags.heading5, color: "#a78bfa" },
  { tag: tags.heading6, color: "#a78bfa" },
  { tag: tags.emphasis, fontStyle: "italic", color: "#c4b5fd" },
  { tag: tags.strong, fontWeight: "bold", color: "#ededf0" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "#7e7e8e" },
  { tag: tags.link, color: "#58a6ff", textDecoration: "underline" },
  { tag: tags.url, color: "#58a6ff" },
  { tag: tags.monospace, color: "#3fb950" },
  { tag: tags.quote, color: "#9898a6", fontStyle: "italic" },
  { tag: tags.keyword, color: "#c4b5fd" },
  { tag: tags.string, color: "#3fb950" },
  { tag: tags.number, color: "#e5a50a" },
  { tag: tags.comment, color: "#7e7e8e", fontStyle: "italic" },
  { tag: tags.meta, color: "#7e7e8e" },
  { tag: tags.processingInstruction, color: "#9898a6" },
  { tag: tags.contentSeparator, color: "#7e7e8e" },
]);

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
    padding: "8px 0",
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
        syntaxHighlighting(circuitHighlight),
        circuitTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            updateContent(tabId, update.state.doc.toString());
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
