import { Panel, Group, Separator } from "react-resizable-panels";
import type { ReactNode } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { TerminalView } from "./TerminalView";
import { killSession } from "../lib/pty";
import { deleteScrollback } from "../lib/config";
import type { TerminalSession } from "../types";

function getColumnCount(count: number): number {
  if (count <= 1) return 1;
  if (count <= 6) return 2;
  return 3;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

interface TerminalGridProps {
  projectPath: string;
}

export function TerminalGrid({ projectPath }: TerminalGridProps) {
  const { sessions, removeSession } = useSessionStore();

  const projectSessions = sessions.filter(
    (s) => s.projectPath === projectPath
  );

  async function handleCloseSession(id: string) {
    const session = projectSessions.find((s) => s.id === id);
    if (session?.sessionId) {
      try {
        await killSession(session.sessionId);
      } catch {
        // Session may already be dead
      }
    }
    deleteScrollback(id).catch(() => {});
    removeSession(id);
  }

  function renderTerminal(s: (typeof projectSessions)[number]) {
    return (
      <TerminalView
        tabId={s.id}
        projectPath={s.projectPath}
        projectName={s.projectName}
        claudeSessionId={s.claudeSessionId}
        isRestored={s.restored}
        onClose={() => handleCloseSession(s.id)}
      />
    );
  }

  const cols = getColumnCount(projectSessions.length);
  const rows = chunkArray(projectSessions, cols);

  return (
    <div className="terminal-grid-container">
      <Group orientation="vertical">
        {rows.map((row, rowIdx) => (
          <RowPanel
            key={rowIdx}
            row={row}
            rowIdx={rowIdx}
            totalRows={rows.length}
            renderTerminal={renderTerminal}
          />
        ))}
      </Group>
    </div>
  );
}

function RowPanel({
  row,
  rowIdx,
  totalRows,
  renderTerminal,
}: {
  row: TerminalSession[];
  rowIdx: number;
  totalRows: number;
  renderTerminal: (s: TerminalSession) => ReactNode;
}) {
  return (
    <>
      <Panel minSize={10}>
        <Group orientation="horizontal">
          {row.map((s, colIdx) => (
            <ColPanel
              key={s.id}
              session={s}
              colIdx={colIdx}
              totalCols={row.length}
              renderTerminal={renderTerminal}
            />
          ))}
        </Group>
      </Panel>
      {rowIdx < totalRows - 1 && (
        <Separator className="resize-handle-horizontal" />
      )}
    </>
  );
}

function ColPanel({
  session,
  colIdx,
  totalCols,
  renderTerminal,
}: {
  session: TerminalSession;
  colIdx: number;
  totalCols: number;
  renderTerminal: (s: TerminalSession) => ReactNode;
}) {
  return (
    <>
      <Panel minSize={10}>{renderTerminal(session)}</Panel>
      {colIdx < totalCols - 1 && (
        <Separator className="resize-handle-vertical" />
      )}
    </>
  );
}
