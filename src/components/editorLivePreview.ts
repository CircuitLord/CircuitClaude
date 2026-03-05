import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import { searchPanelOpen } from "@codemirror/search";
import { openFileTab } from "../lib/sessions";

/** Heading node names that get both a mark decoration (text styling) and a line decoration (full-width border) */
const headingClasses: Record<string, string> = {
  ATXHeading1: "cm-md-h1",
  ATXHeading2: "cm-md-h2",
  ATXHeading3: "cm-md-h3",
  ATXHeading4: "cm-md-h4",
  ATXHeading5: "cm-md-h5",
  ATXHeading6: "cm-md-h6",
};

/** Map lezer markdown node names to CSS classes for visual styling */
const markClasses: Record<string, string> = {
  Emphasis: "cm-md-emphasis",
  StrongEmphasis: "cm-md-strong",
  InlineCode: "cm-md-code",
  Link: "cm-md-link",
  Blockquote: "cm-md-blockquote",
  HorizontalRule: "cm-md-hr",
};

/** Node names whose text content should be hidden when the cursor is on a different line */
const hiddenMarkers = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "QuoteMark",
]);

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const tree = syntaxTree(state);
  const cursor = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursor).number;
  const isSearching = searchPanelOpen(state);

  // Collect mark/replace decorations (inline, sorted by position)
  const decos: { from: number; to: number; deco: Decoration }[] = [];
  // Collect line decorations separately (keyed by line start to dedupe)
  const lineDecos = new Map<number, Decoration>();

  tree.iterate({
    enter(node) {
      const name = node.name;

      // Heading decorations — mark for text styling + line for full-width border
      const headingCls = headingClasses[name];
      if (headingCls) {
        const line = state.doc.lineAt(node.from);
        decos.push({
          from: line.from,
          to: line.to,
          deco: Decoration.mark({ class: headingCls }),
        });
        lineDecos.set(line.from, Decoration.line({ class: headingCls + "-line" }));
      }

      // Task list decorations — style completed tasks
      if (name === "TaskMarker") {
        const text = state.doc.sliceString(node.from, node.to);
        const checked = text === "[x]" || text === "[X]";
        decos.push({
          from: node.from,
          to: node.to,
          deco: Decoration.mark({ class: checked ? "cm-md-task-checked" : "cm-md-task-unchecked" }),
        });
        if (checked) {
          // Style the rest of the line after the marker as completed
          const line = state.doc.lineAt(node.from);
          if (node.to < line.to) {
            decos.push({
              from: node.to,
              to: line.to,
              deco: Decoration.mark({ class: "cm-md-task-done" }),
            });
          }
        }
      }

      // Fenced code blocks — apply line decoration to every line in the block
      if (name === "FencedCode") {
        const startLine = state.doc.lineAt(node.from).number;
        const endLine = state.doc.lineAt(node.to).number;
        for (let ln = startLine; ln <= endLine; ln++) {
          const line = state.doc.line(ln);
          lineDecos.set(line.from, Decoration.line({ class: "cm-md-fenced-code-line" }));
        }
      }

      // Mark decorations — visual styling for rendered markdown
      const cls = markClasses[name];
      if (cls) {
        decos.push({
          from: node.from,
          to: node.to,
          deco: Decoration.mark({ class: cls }),
        });
      }

      // Replace decorations — hide syntax markers when cursor is elsewhere
      // Skip when search panel is open to prevent replace decorations from
      // conflicting with search match highlights
      if (hiddenMarkers.has(name) && !isSearching) {
        const markerLine = state.doc.lineAt(node.from).number;
        if (markerLine !== cursorLine && node.from < node.to) {
          let end = node.to;
          // Also consume the trailing space after header marks (e.g. "## ")
          if (name === "HeaderMark" && end < state.doc.length && state.doc.sliceString(end, end + 1) === " ") {
            end++;
          }
          decos.push({
            from: node.from,
            to: end,
            deco: Decoration.replace({}),
          });
        }
      }
    },
  });

  // Sort by start position (required by RangeSetBuilder)
  decos.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();

  // Merge line decorations (sorted by position) and mark decorations
  const sortedLineStarts = [...lineDecos.keys()].sort((a, b) => a - b);
  let lineIdx = 0;

  for (const { from, to, deco } of decos) {
    // Insert any line decorations that come before this mark decoration
    while (lineIdx < sortedLineStarts.length && sortedLineStarts[lineIdx] <= from) {
      builder.add(sortedLineStarts[lineIdx], sortedLineStarts[lineIdx], lineDecos.get(sortedLineStarts[lineIdx])!);
      lineIdx++;
    }
    builder.add(from, to, deco);
  }
  // Add remaining line decorations
  while (lineIdx < sortedLineStarts.length) {
    builder.add(sortedLineStarts[lineIdx], sortedLineStarts[lineIdx], lineDecos.get(sortedLineStarts[lineIdx])!);
    lineIdx++;
  }

  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        searchPanelOpen(update.startState) !== searchPanelOpen(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/** Creates a click handler that opens markdown links as editor tabs.
 *  Requires the current file's path to resolve relative links. */
export function markdownLinkClick(currentFilePath: string) {
  const dir = currentFilePath.replace(/[\\/][^\\/]*$/, "");

  return EditorView.domEventHandlers({
    click(event, view) {
      // Only handle ctrl/cmd+click
      if (!event.ctrlKey && !event.metaKey) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;

      const tree = syntaxTree(view.state);
      let url: string | null = null;

      // Walk up from click position to find a Link node, then extract its URL child
      let node = tree.resolveInner(pos, 1);
      while (node) {
        if (node.name === "Link") {
          const urlNode = node.getChild("URL");
          if (urlNode) {
            url = view.state.doc.sliceString(urlNode.from, urlNode.to);
          }
          break;
        }
        if (!node.parent) break;
        node = node.parent;
      }

      if (!url) return false;

      // Skip external URLs
      if (/^https?:\/\//.test(url)) return false;

      // Resolve relative path against current file's directory
      const resolved = dir + "/" + url.replace(/^\.\//, "");
      const fileName = url.split(/[\\/]/).pop() ?? url;

      event.preventDefault();
      openFileTab(resolved, fileName, true);
      return true;
    },
  });
}

export const markdownLivePreview = livePreviewPlugin;
