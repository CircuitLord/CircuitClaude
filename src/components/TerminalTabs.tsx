import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { NewSessionMenu } from "./NewSessionMenu";
import { closePtySession } from "../lib/pty";
import { SplitDirection, PaneState } from "../types";

interface TerminalTabsProps {
  projectPath: string;
}

type DropZone = "left" | "right" | "top" | "bottom" | null;

export function TerminalTabs({ projectPath }: TerminalTabsProps) {
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    removeSession,
    tabStatuses,
    sessionTitles,
    requestTitleRegen,
    reorderSessions,
    projectSplits,
    setSplit,
    clearSplit,
    setFocusedPane,
    moveSessionToPane,
    reorderPaneSessions,
  } = useSessionStore();

  const tabBarRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const pane1TabBarRef = useRef<HTMLDivElement>(null);
  const pane2TabBarRef = useRef<HTMLDivElement>(null);
  const pane1Ref = useRef<HTMLDivElement>(null);
  const pane2Ref = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  // Track which pane's tab bar is being dragged (null = unsplit tab bar)
  const [dragPane, setDragPane] = useState<1 | 2 | null>(null);

  // Split drag state (for drag-to-split gesture from unsplit mode)
  const [splitDragActive, setSplitDragActive] = useState(false);
  const [hoveredZone, setHoveredZone] = useState<DropZone>(null);
  const splitDragSessionIdRef = useRef<string | null>(null);

  // Cross-pane drag state
  const [crossPaneDragActive, setCrossPaneDragActive] = useState(false);
  const [crossPaneDropTarget, setCrossPaneDropTarget] = useState<1 | 2 | null>(null);
  const crossPaneDragSessionIdRef = useRef<string | null>(null);

  // Split resize state
  const [splitRatio, setSplitRatio] = useState(50);
  const resizingRef = useRef(false);

  const split = projectSplits.get(projectPath) ?? null;

  const projectSessions = sessions.filter((s) => s.projectPath === projectPath);
  const allVisible = projectSessions;
  const visibleSessionIds = useMemo(() => allVisible.map((s) => s.id), [allVisible]);

  // When unsplit, manage mounted sessions for xterm persistence
  const [mountedSessionIds, setMountedSessionIds] = useState<string[]>(visibleSessionIds);
  // When split, each pane tracks its own mounted sessions
  const [pane1MountedIds, setPane1MountedIds] = useState<string[]>([]);
  const [pane2MountedIds, setPane2MountedIds] = useState<string[]>([]);

  // Reset split ratio when entering split mode
  const prevSplitRef = useRef(split);
  useEffect(() => {
    if (split && !prevSplitRef.current) {
      setSplitRatio(50);
    }
    prevSplitRef.current = split;
  }, [split]);

  // Track mounted sessions for unsplit mode
  useEffect(() => {
    if (split) return; // Skip when split — pane-specific tracking handles it
    setMountedSessionIds((prev) => {
      const visibleSet = new Set(visibleSessionIds);
      const next: string[] = [];

      for (const id of prev) {
        if (visibleSet.has(id)) next.push(id);
      }

      const nextSet = new Set(next);
      for (const id of visibleSessionIds) {
        if (!nextSet.has(id)) {
          next.push(id);
          nextSet.add(id);
        }
      }

      if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
        return prev;
      }
      return next;
    });
  }, [visibleSessionIds, split]);

  // Track mounted sessions for split panes
  useEffect(() => {
    if (!split) return;
    setPane1MountedIds((prev) => syncMounted(prev, split.pane1.sessionIds));
    setPane2MountedIds((prev) => syncMounted(prev, split.pane2.sessionIds));
  }, [split]);

  function syncMounted(prev: string[], current: string[]): string[] {
    const currentSet = new Set(current);
    const next: string[] = [];
    for (const id of prev) {
      if (currentSet.has(id)) next.push(id);
    }
    const nextSet = new Set(next);
    for (const id of current) {
      if (!nextSet.has(id)) {
        next.push(id);
        nextSet.add(id);
      }
    }
    if (next.length === prev.length && next.every((id, idx) => id === prev[idx])) {
      return prev;
    }
    return next;
  }

  const activeInProject = allVisible.find((s) => s.id === activeSessionId);
  const visibleSessionId = activeInProject?.id ?? allVisible[0]?.id ?? null;
  const sessionById = useMemo(
    () => new Map(allVisible.map((session) => [session.id, session])),
    [allVisible]
  );

  async function handleCloseSession(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (session?.sessionId) {
      await closePtySession(session.sessionId).catch(() => {});
    }
    removeSession(id);
  }

  // Compute drop zone from mouse position relative to panels area
  function computeDropZone(clientX: number, clientY: number): DropZone {
    if (!panelsRef.current) return null;
    const rect = panelsRef.current.getBoundingClientRect();

    // Ignore if mouse is outside the panels area
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }

    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;

    if (relX < 0.2) return "left";
    if (relX > 0.8) return "right";
    if (relY < 0.25) return "top";
    if (relY > 0.75) return "bottom";
    return null;
  }

  const hoveredZoneRef = useRef(hoveredZone);
  hoveredZoneRef.current = hoveredZone;

  // --- Resize handle ---
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!split) return;
    // We need the split container element, which is the parent of the resize handle
    const containerEl = (e.currentTarget as HTMLElement).parentElement;
    if (!containerEl) return;
    e.preventDefault();
    resizingRef.current = true;
    const rect = containerEl.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      let ratio: number;
      if (split.direction === "horizontal") {
        ratio = ((ev.clientX - rect.left) / rect.width) * 100;
      } else {
        ratio = ((ev.clientY - rect.top) / rect.height) * 100;
      }
      ratio = Math.max(10, Math.min(90, ratio));
      if (ratio <= 10 || ratio >= 90) {
        resizingRef.current = false;
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        clearSplit(projectPath);
        return;
      }
      setSplitRatio(ratio);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    document.body.style.cursor = split.direction === "horizontal" ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [split, projectPath, clearSplit]);

  const handleResizeDoubleClick = useCallback(() => {
    clearSplit(projectPath);
  }, [projectPath, clearSplit]);

  // --- Unsplit tab bar drag ---
  const handleTabDragStart = useCallback((e: React.MouseEvent, index: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".terminal-tab-close")) return;
    e.preventDefault();

    const currentSessions = useSessionStore.getState().sessions.filter((s) => s.projectPath === projectPath);
    const draggedSessionId = currentSessions[index]?.id;

    setDragIndex(index);
    setDragPane(null);
    splitDragSessionIdRef.current = draggedSessionId ?? null;
    document.body.style.cursor = "grabbing";

    let inSplitMode = false;

    const onMove = (ev: MouseEvent) => {
      if (!tabBarRef.current) return;
      const tabBarRect = tabBarRef.current.getBoundingClientRect();
      const currentState = useSessionStore.getState();
      const hasSplit = currentState.projectSplits.has(projectPath);

      const containerRect = panelsRef.current?.getBoundingClientRect();
      const withinBounds = containerRect
        && ev.clientX >= containerRect.left && ev.clientX <= containerRect.right
        && ev.clientY >= tabBarRect.top && ev.clientY <= containerRect.bottom;

      if (!hasSplit && !inSplitMode && withinBounds && ev.clientY > tabBarRect.bottom + 20 && currentSessions.length >= 2) {
        inSplitMode = true;
        setSplitDragActive(true);
        setDragIndex(null);
        setDropIndex(null);
        dropIndexRef.current = null;
      }

      if (inSplitMode) {
        const zone = computeDropZone(ev.clientX, ev.clientY);
        setHoveredZone(zone);
        hoveredZoneRef.current = zone;
        return;
      }

      const tabs = tabBarRef.current.querySelectorAll<HTMLElement>(".terminal-tab");
      let newDrop = tabs.length;

      for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (ev.clientX < rect.left + rect.width / 2) {
          newDrop = i;
          break;
        }
      }

      dropIndexRef.current = newDrop;
      setDropIndex(newDrop);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";

      if (inSplitMode) {
        const zone = hoveredZoneRef.current;
        setSplitDragActive(false);
        setHoveredZone(null);
        hoveredZoneRef.current = null;

        const storeState = useSessionStore.getState();
        const activeId = storeState.activeSessionId;
        const dragId = splitDragSessionIdRef.current;
        splitDragSessionIdRef.current = null;

        if (zone && dragId) {
          const direction: SplitDirection = (zone === "left" || zone === "right") ? "horizontal" : "vertical";
          const draggedGoesFirst = zone === "left" || zone === "top";

          // Build pane states: dragged tab goes to one pane, remaining tabs to the other
          const allProjectSessions = storeState.sessions.filter((s) => s.projectPath === projectPath);
          const allIds = allProjectSessions.map((s) => s.id);
          const remainingIds = allIds.filter((id) => id !== dragId);

          if (remainingIds.length > 0) {
            // Pick active for the remaining pane: keep current active if it's in remaining, else first
            const remainingActiveId = remainingIds.includes(activeId ?? "")
              ? activeId!
              : remainingIds[0];

            const draggedPane: PaneState = { sessionIds: [dragId], activeSessionId: dragId };
            const remainingPane: PaneState = { sessionIds: remainingIds, activeSessionId: remainingActiveId };

            setSplit(projectPath, {
              direction,
              pane1: draggedGoesFirst ? draggedPane : remainingPane,
              pane2: draggedGoesFirst ? remainingPane : draggedPane,
              focusedPane: draggedGoesFirst ? 1 : 2,
            });
          }
        }

        setDragIndex(null);
        setDropIndex(null);
        dropIndexRef.current = null;
        return;
      }

      const finalDrop = dropIndexRef.current;
      if (finalDrop !== null) {
        let targetIndex = finalDrop;
        if (targetIndex > index) targetIndex--;

        if (targetIndex !== index && targetIndex >= 0 && targetIndex < currentSessions.length) {
          reorderSessions(projectPath, index, targetIndex);
        }
      }

      setDragIndex(null);
      setDropIndex(null);
      dropIndexRef.current = null;
      splitDragSessionIdRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [projectPath, reorderSessions, setSplit]);

  // --- Split pane tab bar drag (within pane + cross-pane) ---
  const handlePaneTabDragStart = useCallback((e: React.MouseEvent, paneNum: 1 | 2, index: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".terminal-tab-close")) return;
    e.preventDefault();

    const currentState = useSessionStore.getState();
    const currentSplit = currentState.projectSplits.get(projectPath);
    if (!currentSplit) return;

    const pane = paneNum === 1 ? currentSplit.pane1 : currentSplit.pane2;
    const draggedSessionId = pane.sessionIds[index];
    if (!draggedSessionId) return;

    setDragIndex(index);
    setDragPane(paneNum);
    crossPaneDragSessionIdRef.current = draggedSessionId;
    document.body.style.cursor = "grabbing";

    let inCrossPaneMode = false;

    const onMove = (ev: MouseEvent) => {
      const myTabBarRef = paneNum === 1 ? pane1TabBarRef : pane2TabBarRef;
      const otherPaneRef = paneNum === 1 ? pane2Ref : pane1Ref;

      if (!myTabBarRef.current) return;

      // Check if mouse is over the other pane's area
      if (otherPaneRef.current) {
        const otherRect = otherPaneRef.current.getBoundingClientRect();
        if (ev.clientX >= otherRect.left && ev.clientX <= otherRect.right &&
            ev.clientY >= otherRect.top && ev.clientY <= otherRect.bottom) {
          if (!inCrossPaneMode) {
            inCrossPaneMode = true;
            setCrossPaneDragActive(true);
            setDragIndex(null);
            setDropIndex(null);
            dropIndexRef.current = null;
          }
          setCrossPaneDropTarget(paneNum === 1 ? 2 : 1);
          return;
        }
      }

      // If we were in cross-pane mode but mouse moved back, cancel it
      if (inCrossPaneMode) {
        inCrossPaneMode = false;
        setCrossPaneDragActive(false);
        setCrossPaneDropTarget(null);
        setDragIndex(index);
        setDragPane(paneNum);
      }

      // Normal within-pane reorder
      const tabs = myTabBarRef.current.querySelectorAll<HTMLElement>(".terminal-tab");
      let newDrop = tabs.length;

      for (let i = 0; i < tabs.length; i++) {
        const rect = tabs[i].getBoundingClientRect();
        if (ev.clientX < rect.left + rect.width / 2) {
          newDrop = i;
          break;
        }
      }

      dropIndexRef.current = newDrop;
      setDropIndex(newDrop);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";

      if (inCrossPaneMode && crossPaneDragSessionIdRef.current) {
        const targetPaneNum = paneNum === 1 ? 2 : 1;
        moveSessionToPane(projectPath, crossPaneDragSessionIdRef.current, targetPaneNum);
        setCrossPaneDragActive(false);
        setCrossPaneDropTarget(null);
        crossPaneDragSessionIdRef.current = null;
        setDragIndex(null);
        setDragPane(null);
        setDropIndex(null);
        dropIndexRef.current = null;
        return;
      }

      const finalDrop = dropIndexRef.current;
      if (finalDrop !== null) {
        let targetIndex = finalDrop;
        if (targetIndex > index) targetIndex--;

        const latestSplit = useSessionStore.getState().projectSplits.get(projectPath);
        if (latestSplit) {
          const latestPane = paneNum === 1 ? latestSplit.pane1 : latestSplit.pane2;
          if (targetIndex !== index && targetIndex >= 0 && targetIndex < latestPane.sessionIds.length) {
            reorderPaneSessions(projectPath, paneNum, index, targetIndex);
          }
        }
      }

      setDragIndex(null);
      setDragPane(null);
      setDropIndex(null);
      dropIndexRef.current = null;
      crossPaneDragSessionIdRef.current = null;
      setCrossPaneDragActive(false);
      setCrossPaneDropTarget(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [projectPath, moveSessionToPane, reorderPaneSessions]);

  // --- Tab rendering helper ---
  function renderTab(
    sessionId: string,
    _index: number,
    isActive: boolean,
    isDragging: boolean,
    showDropBefore: boolean,
    showDropAfter: boolean,
    onMouseDown: (e: React.MouseEvent) => void,
  ) {
    const s = sessionById.get(sessionId);
    if (!s) return null;
    const tabStatus = tabStatuses.get(s.id) ?? null;
    const prefix =
      s.sessionType === "opencode"
        ? "o>"
        : s.sessionType === "codex"
          ? "c>"
          : s.sessionType === "shell"
            ? ">_"
            : ">";
    const label = s.sessionType === "shell" ? "terminal" : (sessionTitles.get(s.id) ?? s.projectName);

    return (
      <div
        key={s.id}
        className={`terminal-tab${isActive ? " terminal-tab--active" : ""}${tabStatus === "thinking" ? " terminal-tab--thinking" : ""}${isDragging ? " terminal-tab--dragging" : ""}${showDropBefore ? " terminal-tab--drop-before" : ""}${showDropAfter ? " terminal-tab--drop-after" : ""}`}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        onClick={() => setActiveSession(s.id)}
        onMouseDown={onMouseDown}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setActiveSession(s.id);
          }
        }}
      >
        <span className="terminal-tab-prefix">{prefix}</span>
        <span
          className="terminal-tab-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (s.sessionType !== "shell") requestTitleRegen(s.id);
          }}
        >{label}</span>
        <span className="terminal-tab-trailing">
          {tabStatus === "thinking" ? (
            <span className="terminal-tab-status terminal-tab-thinking">*</span>
          ) : tabStatus === "waiting" ? (
            <span className="terminal-tab-status terminal-tab-attention">?</span>
          ) : null}
          <button
            type="button"
            className="terminal-tab-close"
            aria-label={`Close ${label} tab`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void handleCloseSession(s.id);
            }}
          >
            x
          </button>
        </span>
      </div>
    );
  }

  // --- Panel rendering helper ---
  function renderPanel(
    sessionId: string,
    visible: boolean,
    onPaneClick?: () => void,
    isFocusedPane?: boolean,
  ) {
    const session = sessionById.get(sessionId);
    if (!session) return null;
    return (
      <div
        key={session.id}
        className={`terminal-tabs-panel${isFocusedPane !== undefined ? " terminal-tabs-panel--pane" : ""}${isFocusedPane ? " terminal-tabs-panel--focused" : ""}`}
        style={{ display: visible ? "flex" : "none" }}
        onMouseDown={onPaneClick}
      >
        <TerminalView
          tabId={session.id}
          projectPath={session.projectPath}
          projectName={session.projectName}
          sessionType={session.sessionType}
          hideTitleBar
          onClose={() => {
            void handleCloseSession(session.id);
          }}
        />
      </div>
    );
  }

  if (projectSessions.length === 0) return null;

  // ===== SPLIT MODE =====
  if (split) {
    const pane1 = split.pane1;
    const pane2 = split.pane2;
    const isHorizontal = split.direction === "horizontal";

    return (
      <div className="terminal-tabs-container">
        <div
          className={`terminal-tabs-split-container terminal-tabs-split-container--${isHorizontal ? "h" : "v"}`}
          ref={panelsRef}
        >
          {/* Pane 1 */}
          <div
            className={`terminal-tabs-pane${split.focusedPane === 1 ? " terminal-tabs-pane--focused" : ""}${crossPaneDragActive && crossPaneDropTarget === 1 ? " terminal-tabs-pane--drop-target" : ""}`}
            style={isHorizontal ? { width: `calc(${splitRatio}% - 1px)` } : { height: `calc(${splitRatio}% - 1px)` }}
            ref={pane1Ref}
            onMouseDown={() => setFocusedPane(projectPath, 1)}
          >
            <div className="terminal-tabs-bar-wrapper">
              <div className="terminal-tabs-bar" ref={pane1TabBarRef}>
                {pane1.sessionIds.map((sid, index) => {
                  const isActive = sid === pane1.activeSessionId;
                  const isDragging = dragPane === 1 && dragIndex === index;
                  let showDropBefore = false;
                  let showDropAfter = false;
                  if (dragPane === 1 && dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
                    if (dropIndex === index) showDropBefore = true;
                    else if (dropIndex === pane1.sessionIds.length && index === pane1.sessionIds.length - 1) showDropAfter = true;
                  }
                  return renderTab(
                    sid, index, isActive, isDragging, showDropBefore, showDropAfter,
                    (e) => handlePaneTabDragStart(e, 1, index),
                  );
                })}
              </div>
              <NewSessionMenu variant="button" targetPane={1} />
            </div>
            <div className="terminal-tabs-panels">
              {pane1MountedIds.map((id) =>
                renderPanel(
                  id,
                  id === pane1.activeSessionId,
                  () => setFocusedPane(projectPath, 1),
                  split.focusedPane === 1,
                )
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div
            className={`split-resize-handle split-resize-handle--${isHorizontal ? "h" : "v"}`}
            onMouseDown={handleResizeStart}
            onDoubleClick={handleResizeDoubleClick}
          />

          {/* Pane 2 */}
          <div
            className={`terminal-tabs-pane${split.focusedPane === 2 ? " terminal-tabs-pane--focused" : ""}${crossPaneDragActive && crossPaneDropTarget === 2 ? " terminal-tabs-pane--drop-target" : ""}`}
            style={isHorizontal ? { width: `calc(${100 - splitRatio}% - 1px)` } : { height: `calc(${100 - splitRatio}% - 1px)` }}
            ref={pane2Ref}
            onMouseDown={() => setFocusedPane(projectPath, 2)}
          >
            <div className="terminal-tabs-bar-wrapper">
              <div className="terminal-tabs-bar" ref={pane2TabBarRef}>
                {pane2.sessionIds.map((sid, index) => {
                  const isActive = sid === pane2.activeSessionId;
                  const isDragging = dragPane === 2 && dragIndex === index;
                  let showDropBefore = false;
                  let showDropAfter = false;
                  if (dragPane === 2 && dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
                    if (dropIndex === index) showDropBefore = true;
                    else if (dropIndex === pane2.sessionIds.length && index === pane2.sessionIds.length - 1) showDropAfter = true;
                  }
                  return renderTab(
                    sid, index, isActive, isDragging, showDropBefore, showDropAfter,
                    (e) => handlePaneTabDragStart(e, 2, index),
                  );
                })}
              </div>
              <NewSessionMenu variant="button" targetPane={2} />
            </div>
            <div className="terminal-tabs-panels">
              {pane2MountedIds.map((id) =>
                renderPanel(
                  id,
                  id === pane2.activeSessionId,
                  () => setFocusedPane(projectPath, 2),
                  split.focusedPane === 2,
                )
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== UNSPLIT MODE =====
  return (
    <div className="terminal-tabs-container">
      <div className="terminal-tabs-bar-wrapper">
        <div className="terminal-tabs-bar" ref={tabBarRef}>
          {allVisible.map((s, index) => {
            const isActive = s.id === visibleSessionId;
            const isDragging = dragPane === null && dragIndex === index;
            let showDropBefore = false;
            let showDropAfter = false;
            if (dragPane === null && dragIndex !== null && dropIndex !== null && dropIndex !== dragIndex && dropIndex !== dragIndex + 1) {
              if (dropIndex === index) showDropBefore = true;
              else if (dropIndex === allVisible.length && index === allVisible.length - 1) showDropAfter = true;
            }
            return renderTab(
              s.id, index, isActive, isDragging, showDropBefore, showDropAfter,
              (e) => handleTabDragStart(e, index),
            );
          })}
        </div>
        <NewSessionMenu variant="button" />
      </div>
      <div className="terminal-tabs-panels" ref={panelsRef}>
        {/* Drop zone overlay during split drag */}
        {splitDragActive && (
          <div className="split-drop-overlay">
            <div className={`split-drop-zone split-drop-zone--left${hoveredZone === "left" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">| split</span>
            </div>
            <div className={`split-drop-zone split-drop-zone--right${hoveredZone === "right" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">split |</span>
            </div>
            <div className={`split-drop-zone split-drop-zone--top${hoveredZone === "top" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">&mdash; split</span>
            </div>
            <div className={`split-drop-zone split-drop-zone--bottom${hoveredZone === "bottom" ? " split-drop-zone--active" : ""}`}>
              <span className="split-drop-label">split &mdash;</span>
            </div>
          </div>
        )}

        {mountedSessionIds.map((id) =>
          renderPanel(id, id === visibleSessionId)
        )}
      </div>
    </div>
  );
}
