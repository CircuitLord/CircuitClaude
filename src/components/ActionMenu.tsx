import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useActionMenuStore, type ActionId } from "../stores/actionMenuStore";
import { useProjectStore } from "../stores/projectStore";
import { AddProjectDialog } from "./AddProjectDialog";
import { spawnNewSession } from "../lib/sessions";
import { getProjectSessionTypes } from "../lib/sessionTypes";
import { fuzzyMatch } from "../lib/fuzzy";
import type { Project, SessionTypeConfig } from "../types";

type Step = "action" | "project" | "tool";

interface ActionDef {
  id: ActionId;
  label: string;
  detail: string;
}

const ACTIONS: ActionDef[] = [
  { id: "new-chat", label: "new chat", detail: "start a session in a project" },
];

interface MenuItem {
  key: string;
  label: string;
  detail?: string;
  execute: () => void;
}

export function ActionMenu() {
  const { isOpen, initialAction, openCount, close } = useActionMenuStore();
  if (!isOpen) return null;
  return <ActionMenuPanel key={openCount} initialAction={initialAction} close={close} />;
}

function ActionMenuPanel({ initialAction, close }: { initialAction: ActionId | null; close: () => void }) {
  const projects = useProjectStore((s) => s.projects);
  const [step, setStep] = useState<Step>(initialAction === "new-chat" ? "project" : "action");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  const searchQuery = query.trim();

  // focus on mount and again when returning from the add-project dialog
  useEffect(() => {
    if (!addOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [addOpen]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const enterProjectStep = useCallback(() => {
    setStep("project");
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const selectProject = useCallback((p: Project) => {
    setProject(p);
    setStep("tool");
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const launchSession = useCallback(
    (type: SessionTypeConfig, projectPath: string) => {
      close();
      spawnNewSession(type.id, projectPath);
    },
    [close],
  );

  const results: MenuItem[] = useMemo(() => {
    if (step === "action") {
      return filterByLabel(ACTIONS, searchQuery, (a) => a.label).map((a) => ({
        key: "a:" + a.id,
        label: a.label,
        detail: a.detail,
        execute: enterProjectStep,
      }));
    }
    if (step === "project") {
      return filterByLabel(projects, searchQuery, (p) => p.name + " " + p.path).map((p) => ({
        key: "p:" + p.path,
        label: p.name,
        detail: p.path,
        execute: () => selectProject(p),
      }));
    }
    if (!project) return [];
    return filterByLabel(getProjectSessionTypes(project.path), searchQuery, (t) => t.name).map((t) => ({
      key: "t:" + t.id,
      label: t.name,
      detail: t.command,
      execute: () => launchSession(t, project.path),
    }));
  }, [step, searchQuery, projects, project, enterProjectStep, selectProject, launchSession]);

  // in the project step the pinned add row sits one index past the results
  const addRowIndex = step === "project" ? results.length : -1;
  const maxIndex = step === "project" ? results.length : Math.max(0, results.length - 1);

  // clamp selection when results change
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, maxIndex));
  }, [maxIndex]);

  const goBack = useCallback(() => {
    if (step === "tool") {
      setProject(null);
      setStep("project");
    } else if (step === "project") {
      setStep("action");
    }
    setSelectedIndex(0);
  }, [step]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "Backspace" && !query && step !== "action") {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, maxIndex));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex === addRowIndex) {
          setAddOpen(true);
        } else {
          results[selectedIndex]?.execute();
        }
        return;
      }
    },
    [results, selectedIndex, close, query, step, goBack, maxIndex, addRowIndex],
  );

  const placeholder =
    step === "action" ? "select action..." : step === "project" ? "select project..." : "select tool...";

  // the dialog replaces the menu while open so it owns focus and escape, menu state survives underneath
  if (addOpen) {
    return (
      <AddProjectDialog
        isOpen
        onClose={() => setAddOpen(false)}
        onAdded={(p) => {
          setAddOpen(false);
          selectProject(p);
        }}
      />
    );
  }

  return (
    <div
      className="action-menu-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="action-menu">
        <div className="action-menu-input-row">
          {step !== "action" && <span className="action-menu-token">new chat</span>}
          {step === "tool" && project && <span className="action-menu-token">{project.name}</span>}
          <input
            ref={inputRef}
            className="action-menu-input"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="action-menu-list">
          {results.length === 0 && <div className="action-menu-empty">no results</div>}
          {results.map((item, i) => (
            <div
              key={item.key}
              ref={i === selectedIndex ? activeItemRef : undefined}
              className={`action-menu-item${i === selectedIndex ? " action-menu-item--active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                item.execute();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="action-menu-item-marker">{i === selectedIndex ? ">" : " "}</span>
              <span className="action-menu-item-label">{item.label}</span>
              {item.detail && <span className="action-menu-item-detail">{item.detail}</span>}
            </div>
          ))}
        </div>

        {step === "project" && (
          <div
            className={`action-menu-item action-menu-add${selectedIndex === addRowIndex ? " action-menu-item--active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setAddOpen(true);
            }}
            onMouseEnter={() => setSelectedIndex(addRowIndex)}
          >
            <span className="action-menu-item-marker">{selectedIndex === addRowIndex ? ">" : "+"}</span>
            <span className="action-menu-add-label">add project</span>
          </div>
        )}

        <div className="action-menu-footer">
          <span className="action-menu-hint">enter select</span>
          {step !== "action" && <span className="action-menu-hint">backspace back</span>}
          <span className="action-menu-hint">esc close</span>
        </div>
      </div>
    </div>
  );
}

function filterByLabel<T>(items: T[], query: string, label: (item: T) => string): T[] {
  if (!query) return items;
  return items
    .map((item) => ({ item, score: fuzzyMatch(query, label(item)) }))
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}
