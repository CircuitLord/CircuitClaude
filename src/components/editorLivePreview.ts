import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";

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
  "QuoteMark",
]);

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const tree = syntaxTree(state);
  const cursor = state.selection.main.head;
  const cursorLine = state.doc.lineAt(cursor).number;

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
      if (hiddenMarkers.has(name)) {
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
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

export const markdownLivePreview = livePreviewPlugin;
