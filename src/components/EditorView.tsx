import { useEffect, useRef, useState } from "react";
import StatusPill from "./StatusPill";
import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { bracketMatching } from "@codemirror/language";
import { listen } from "@tauri-apps/api/event";
import { useEditorStore } from "../stores/editorStore";
import { pinTab } from "../lib/sessions";
import { markdownLivePreview, markdownLinkClick } from "./editorLivePreview";

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
  "& .cm-selectionLayer": {
    zIndex: "1 !important",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-panels": {
    backgroundColor: "var(--bg-surface)",
    borderBottom: "1px solid var(--border-subtle)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    color: "var(--text-secondary)",
  },
  ".cm-search": {
    padding: "4px 8px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  ".cm-textfield": {
    backgroundColor: "var(--bg-base)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "2px",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    padding: "3px 6px",
    outline: "none",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--accent)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--accent-muted)",
    color: "var(--accent-text)",
    border: "1px solid transparent",
    borderRadius: "4px",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    padding: "4px 10px",
    cursor: "pointer",
    transition: "background 0.1s, border-color 0.1s",
  },
  ".cm-button:hover": {
    backgroundColor: "var(--accent-muted-hover)",
    borderColor: "var(--accent)",
    color: "var(--accent-text)",
  },
  ".cm-button:active": {
    backgroundImage: "none",
    backgroundColor: "var(--accent-muted-hover)",
    borderColor: "var(--accent)",
    color: "var(--accent-text)",
  },
  ".cm-search label": {
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "3px",
    transition: "color 0.1s",
  },
  ".cm-search label:hover": {
    color: "var(--accent-text)",
  },
  ".cm-search input[type=checkbox]": {
    appearance: "none",
    width: "13px",
    height: "13px",
    border: "1px solid var(--border-visible)",
    borderRadius: "2px",
    backgroundColor: "transparent",
    cursor: "pointer",
    position: "relative" as const,
    transition: "border-color 0.1s, background 0.1s",
    verticalAlign: "middle",
  },
  ".cm-search input[type=checkbox]:checked": {
    backgroundColor: "var(--accent-muted)",
    borderColor: "var(--accent)",
  },
  ".cm-search input[type=checkbox]:checked::after": {
    content: "'\\2713'",
    position: "absolute" as const,
    top: "-1px",
    left: "1px",
    fontSize: "11px",
    lineHeight: "13px",
    color: "var(--accent-text)",
    fontFamily: "var(--font-mono)",
  },
  ".cm-search input[type=checkbox]:hover": {
    borderColor: "var(--accent)",
  },
  ".cm-search br": {
    flexBasis: "100%",
    height: "0",
    margin: "0",
    border: "none",
  },
  "& .cm-search-replace-row": {
    display: "flex",
    gap: "6px",
    alignItems: "center",
  },
  ".cm-searchMatch": {
    backgroundColor: "rgba(255, 200, 50, 0.35)",
    outline: "1px solid rgba(255, 200, 50, 0.5)",
    borderRadius: "1px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "rgba(255, 200, 50, 0.7)",
    outline: "1px solid rgba(255, 200, 50, 0.9)",
  },
}, { dark: true });

/** Disable browser autocomplete on search panel inputs */
const disableAutocomplete = ViewPlugin.define((view) => {
  function patch() {
    for (const el of view.dom.querySelectorAll<HTMLInputElement>(".cm-textfield")) {
      if (el.getAttribute("autocomplete") !== "off") el.setAttribute("autocomplete", "off");
    }
  }
  patch();
  return { update: patch };
});

/** Wrap replace row elements into a grouped div so they wrap as a single unit */
const searchPanelLayout = ViewPlugin.define((view) => {
  function restructure() {
    const editor = view.dom.closest(".cm-editor");
    if (!editor) return;
    const panel = editor.querySelector(".cm-search");
    if (!panel || panel.querySelector(".cm-search-replace-row")) return;
    const br = panel.querySelector("br");
    if (!br) return;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-search-replace-row";
    let node = br.nextSibling;
    while (node) {
      const next = node.nextSibling;
      wrapper.appendChild(node);
      node = next;
    }
    br.after(wrapper);
  }
  return { update: restructure };
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
  const [showCopied, setShowCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { files, loadFile, updateContent, saveFile, checkExternalChange } = useEditorStore();
  const fileState = files.get(tabId);

  // Listen for path-copied events targeting this tab
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === tabId) {
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        setShowCopied(true);
        copiedTimerRef.current = setTimeout(() => setShowCopied(false), 1500);
      }
    };
    window.addEventListener("editor-path-copied", handler);
    return () => {
      window.removeEventListener("editor-path-copied", handler);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, [tabId]);

  // Load file on mount
  useEffect(() => {
    loadFile(tabId, filePath);
  }, [tabId, filePath, loadFile]);

  // Re-read file from disk when native file watcher detects a change
  useEffect(() => {
    const unlisten = listen<{ filePath: string }>("file-changed", async (event) => {
      if (event.payload.filePath !== filePath) return;
      const newContent = await checkExternalChange(tabId, filePath);
      if (newContent != null && editorViewRef.current) {
        const view = editorViewRef.current;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: newContent },
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [tabId, filePath, checkExternalChange]);

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
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        search({ top: true }),
        disableAutocomplete,
        searchPanelLayout,
        markdown(),
        markdownLivePreview,
        markdownLinkClick(filePath),
        circuitTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            updateContent(tabId, update.state.doc.toString());
            pinTab(tabId);
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

  return (
    <div ref={containerRef} className="editor-view">
      <StatusPill visible={showCopied}>* path copied to clipboard</StatusPill>
    </div>
  );
}
