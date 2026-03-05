import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useCommandPaletteStore } from "../stores/commandPaletteStore";
import { useSessionStore } from "../stores/sessionStore";
import { scanProjectFiles, fileColorClass, searchEverything, downloadEsExe, type EverythingResult } from "../lib/files";
import { openFileTab } from "../lib/sessions";
import {
  fuzzyMatch,
  getPaletteCommands,
  type PaletteMode,
  type PaletteCommand,
} from "../lib/commandPalette";

interface FileItem {
  type: "file";
  path: string;
  filename: string;
  dir: string;
  isAbsolute?: boolean;
}

interface CommandItem {
  type: "command";
  command: PaletteCommand;
}

type PaletteItem = FileItem | CommandItem;

const MAX_RESULTS = 50;

export function CommandPalette() {
  const { isOpen, initialMode, close } = useCommandPaletteStore();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PaletteMode>("files");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [everythingResults, setEverythingResults] = useState<EverythingResult[]>([]);
  const [everythingLoading, setEverythingLoading] = useState(false);
  const [everythingAvailable, setEverythingAvailable] = useState(true);
  const [everythingError, setEverythingError] = useState<string | null>(null);
  const [everythingErrorKind, setEverythingErrorKind] = useState<string | null>(null);
  const [esDownloading, setEsDownloading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  const searchQuery = query.trim();

  // Load files when palette opens in file mode
  useEffect(() => {
    if (!isOpen) return;
    const projectPath = useSessionStore.getState().activeProjectPath;
    if (!projectPath) return;

    setFilesLoading(true);
    scanProjectFiles(projectPath)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false));
  }, [isOpen]);

  // Reset state when palette opens/closes
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setMode(initialMode);
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setMode("files");
      setFiles([]);
      setEverythingResults([]);
      setEverythingLoading(false);
      setEverythingError(null);
      setEverythingErrorKind(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }, [isOpen, initialMode]);

  // Debounced Everything search
  useEffect(() => {
    if (mode !== "everything") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery) {
      setEverythingResults([]);
      setEverythingLoading(false);
      setEverythingError(null);
      setEverythingErrorKind(null);
      return;
    }

    setEverythingLoading(true);
    debounceRef.current = setTimeout(() => {
      searchEverything(searchQuery)
        .then((resp) => {
          setEverythingAvailable(resp.available);
          setEverythingError(resp.error);
          setEverythingErrorKind(resp.errorKind);
          setEverythingResults(resp.results);
        })
        .catch(() => {
          setEverythingError("failed to search");
          setEverythingErrorKind(null);
          setEverythingResults([]);
        })
        .finally(() => setEverythingLoading(false));
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mode, searchQuery]);

  // Scroll active item into view
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Build filtered results
  const results: PaletteItem[] = useMemo(() => {
    if (mode === "files") {
      const absItem = isAbsolutePath(searchQuery) ? absolutePathItem(searchQuery) : null;

      if (!searchQuery) {
        // Show first N files when query is empty
        return files.slice(0, MAX_RESULTS).map(pathToFileItem);
      }
      // Score and sort
      const scored = files
        .map((f) => {
          let score = fuzzyMatch(searchQuery, f);
          if (score >= 0 && f.endsWith(".md")) score += 50;
          return { path: f, score };
        })
        .filter((s) => s.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS);
      const items = scored.map((s) => pathToFileItem(s.path));
      if (absItem) items.unshift(absItem);
      return items;
    }

    if (mode === "commands") {
      const commands = getPaletteCommands();
      if (!searchQuery) return commands.map(cmdToItem);
      return commands
        .map((c) => ({ cmd: c, score: fuzzyMatch(searchQuery, c.label) }))
        .filter((s) => s.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS)
        .map((s) => cmdToItem(s.cmd));
    }

    if (mode === "everything") {
      return everythingResults.map((r) => ({
        type: "file" as const,
        path: r.path,
        filename: r.filename,
        dir: r.dir,
        isAbsolute: true,
      }));
    }

    return [];
  }, [mode, searchQuery, files, everythingResults]);

  // Clamp selection when results change
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, results.length - 1)));
  }, [results.length]);

  const executeItem = useCallback(
    (item: PaletteItem) => {
      close();
      switch (item.type) {
        case "file": {
          if (item.isAbsolute) {
            openFileTab(item.path, item.filename, false);
          } else {
            const projectPath = useSessionStore.getState().activeProjectPath;
            if (projectPath) {
              const fullPath = projectPath.replace(/\\/g, "/") + "/" + item.path;
              openFileTab(fullPath, item.filename, false);
            }
          }
          break;
        }
        case "command":
          item.command.action();
          break;
      }
    },
    [close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Backspace" && !query && (mode === "commands" || mode === "everything")) {
        e.preventDefault();
        setMode("files");
        setEverythingResults([]);
        setEverythingError(null);
        setEverythingErrorKind(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          executeItem(results[selectedIndex]);
        }
        return;
      }
    },
    [results, selectedIndex, executeItem, close, query, mode],
  );

  if (!isOpen) return null;

  return (
    <div
      className="command-palette-overlay"
      onMouseDown={(e) => {
        // Close if clicking the overlay itself
        if (e.target === e.currentTarget) {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="command-palette">
        <div className="command-palette-input-row">
          {mode === "commands" && <span className="command-palette-mode-badge">:</span>}
          {mode === "everything" && <span className="command-palette-mode-badge">*</span>}
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            value={query}
            onChange={(e) => {
              let value = e.target.value;
              // Typing ":" in file mode switches to command mode
              if (mode === "files" && value.startsWith(":")) {
                setMode("commands");
                value = value.slice(1);
              }
              // Typing "*" in file mode switches to everything mode
              if (mode === "files" && value.startsWith("*")) {
                setMode("everything");
                value = value.slice(1);
              }
              setQuery(value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={mode === "commands" ? "search commands..." : mode === "everything" ? "search everything..." : "search files..."}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="command-palette-list" ref={listRef}>
          {filesLoading && mode === "files" && (
            <div className="command-palette-empty">scanning files...</div>
          )}
          {everythingLoading && mode === "everything" && (
            <div className="command-palette-empty">searching...</div>
          )}
          {mode === "everything" && !everythingLoading && everythingErrorKind === "not_installed" && (
            <div className="command-palette-empty">
              {esDownloading ? "downloading es.exe..." : (
                <>
                  es.exe not found{" "}
                  <span
                    className="command-palette-action"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEsDownloading(true);
                      downloadEsExe()
                        .then(() => {
                          setEverythingAvailable(true);
                          setEverythingError(null);
                          setEverythingErrorKind(null);
                          setEsDownloading(false);
                        })
                        .catch((err) => {
                          setEverythingError(String(err));
                          setEsDownloading(false);
                        });
                    }}
                  >
                    :download
                  </span>
                </>
              )}
            </div>
          )}
          {mode === "everything" && !everythingLoading && everythingErrorKind === "not_running" && (
            <div className="command-palette-empty">Everything is not running — start it to use search</div>
          )}
          {mode === "everything" && !everythingLoading && everythingErrorKind === "es_error" && (
            <div className="command-palette-empty">{everythingError}</div>
          )}
          {mode === "everything" && !everythingLoading && !searchQuery && everythingAvailable && !everythingError && (
            <div className="command-palette-empty">type to search everything</div>
          )}
          {mode !== "everything" && !filesLoading && results.length === 0 && (
            <div className="command-palette-empty">no results</div>
          )}
          {mode === "everything" && !everythingLoading && !!searchQuery && everythingAvailable && !everythingError && results.length === 0 && (
            <div className="command-palette-empty">no results</div>
          )}
          {results.map((item, i) => (
            <div
              key={itemKey(item)}
              ref={i === selectedIndex ? activeItemRef : undefined}
              className={`command-palette-item${i === selectedIndex ? " command-palette-item--active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                executeItem(item);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="command-palette-item-marker">
                {i === selectedIndex ? ">" : "\u00A0"}
              </span>
              {renderItem(item)}
            </div>
          ))}
        </div>

        <div className="command-palette-footer">
          {mode === "files" && (
            <>
              <span className="command-palette-hint">: commands</span>
              <span className="command-palette-hint">* everything</span>
            </>
          )}
          {mode === "commands" && <span className="command-palette-hint">backspace to go back</span>}
          {mode === "everything" && <span className="command-palette-hint">backspace to go back</span>}
        </div>
      </div>
    </div>
  );
}

function isAbsolutePath(q: string): boolean {
  return /^[A-Za-z]:[/\\]/.test(q) || q.startsWith("/");
}

function absolutePathItem(q: string): FileItem {
  const normalized = q.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const filename = parts.pop() ?? normalized;
  const dir = parts.join("/");
  return { type: "file", path: normalized, filename, dir, isAbsolute: true };
}

function pathToFileItem(path: string): FileItem {
  const parts = path.split("/");
  const filename = parts.pop() ?? path;
  const dir = parts.join("/");
  return { type: "file", path, filename, dir };
}

function cmdToItem(cmd: PaletteCommand): CommandItem {
  return { type: "command", command: cmd };
}

function itemKey(item: PaletteItem): string {
  switch (item.type) {
    case "file":
      return "f:" + item.path;
    case "command":
      return "c:" + item.command.id;
  }
}

function renderItem(item: PaletteItem) {
  switch (item.type) {
    case "file":
      return (
        <>
          <span className={`command-palette-item-label ${fileColorClass(item.filename)}`}>
            {item.filename}
          </span>
          {item.dir && (
            <span className="command-palette-item-detail">
              {item.isAbsolute ? `open ${item.dir}` : item.dir}
            </span>
          )}
        </>
      );
    case "command":
      return (
        <>
          <span className="command-palette-item-label">{item.command.label}</span>
          <span className="command-palette-item-detail">{item.command.category}</span>
          {item.command.shortcut && (
            <kbd className="command-palette-item-kbd">{item.command.shortcut}</kbd>
          )}
        </>
      );
  }
}
