import { Marked } from "marked";
import { highlightCode } from "./highlight";

const marked = new Marked({
  renderer: {
    code({ text, lang }) {
      const highlighted = highlightCode(text, lang || undefined);
      return `<pre class="companion-code"><code>${highlighted}</code></pre>`;
    },
  },
  gfm: true,
  breaks: false,
});

export function renderMarkdown(md: string): string {
  return marked.parse(md) as string;
}
