import type { IBufferLine, IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const MAX_LINK_LENGTH = 2048;

interface LineSegment {
  y: number;
  line: IBufferLine;
  text: string;
  start: number;
}

function isContinuation(terminal: Terminal, previousIndex: number, currentIndex: number): boolean {
  const previous = terminal.buffer.active.getLine(previousIndex);
  const current = terminal.buffer.active.getLine(currentIndex);
  if (!previous || !current) return false;
  if (current.isWrapped) return true;

  const previousText = previous.translateToString(true);
  const currentText = current.translateToString(true);
  return previousText.length >= Math.max(1, terminal.cols - 10)
    && previousText.length > 0
    && currentText.length > 0
    && !/\s$/.test(previousText)
    && !/^\s/.test(currentText);
}

function collectSegments(terminal: Terminal, lineIndex: number): LineSegment[] {
  const buffer = terminal.buffer.active;
  let top = lineIndex;
  let bottom = lineIndex;
  let length = buffer.getLine(lineIndex)?.translateToString(true).length ?? 0;

  while (top > 0 && length < MAX_LINK_LENGTH && isContinuation(terminal, top - 1, top)) {
    top--;
    length += buffer.getLine(top)?.translateToString(true).length ?? 0;
  }

  while (length < MAX_LINK_LENGTH && isContinuation(terminal, bottom, bottom + 1)) {
    bottom++;
    length += buffer.getLine(bottom)?.translateToString(true).length ?? 0;
  }

  const segments: LineSegment[] = [];
  let start = 0;
  for (let y = top; y <= bottom; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    segments.push({ y, line, text, start });
    start += text.length;
  }
  return segments;
}

function cellBoundary(line: IBufferLine, stringOffset: number): number {
  let stringIndex = 0;
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    const width = cell.getWidth();
    if (!width) continue;
    if (stringIndex === stringOffset) return x;
    stringIndex += cell.getChars().length || 1;
    if (stringIndex >= stringOffset) return x + width;
  }
  return line.length;
}

function mapStart(segments: LineSegment[], index: number): { x: number; y: number } | null {
  for (const segment of segments) {
    if (index < segment.start + segment.text.length) {
      return {
        x: cellBoundary(segment.line, index - segment.start) + 1,
        y: segment.y + 1,
      };
    }
  }
  return null;
}

function mapEnd(segments: LineSegment[], index: number): { x: number; y: number } | null {
  for (const segment of segments) {
    if (index > segment.start && index <= segment.start + segment.text.length) {
      return {
        x: cellBoundary(segment.line, index - segment.start),
        y: segment.y + 1,
      };
    }
  }
  return null;
}

function trimUrl(text: string): string {
  return text.replace(/[,.!?;:)}\]]+$/, "");
}

class TerminalLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly activate: (event: MouseEvent, url: string) => void,
  ) {}

  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const segments = collectSegments(this.terminal, y - 1);
    const content = segments.map((segment) => segment.text).join("");
    const links: ILink[] = [];

    for (const match of content.matchAll(URL_RE)) {
      const text = trimUrl(match[0]);
      const startIndex = match.index;
      const endIndex = startIndex + text.length;
      const start = mapStart(segments, startIndex);
      const end = mapEnd(segments, endIndex);
      if (!start || !end) continue;

      try {
        new URL(text);
      } catch {
        continue;
      }

      links.push({ range: { start, end }, text, activate: this.activate });
    }

    callback(links);
  }
}

export function registerTerminalLinkProvider(
  terminal: Terminal,
  activate: (event: MouseEvent, url: string) => void,
): IDisposable {
  return terminal.registerLinkProvider(new TerminalLinkProvider(terminal, activate));
}
