import { spawnNewSession } from "../lib/sessions";
import { useSettingsStore } from "../stores/settingsStore";
import { useProjectStore } from "../stores/projectStore";
import { getSessionTypes } from "../lib/sessionTypes";

interface SessionLauncherProps {
  projectPath: string;
}

export function SessionLauncher({ projectPath }: SessionLauncherProps) {
  const editableSessionTypes = useSettingsStore((s) => s.settings.sessionTypes);
  const project = useProjectStore((s) => s.projects.find((p) => p.path === projectPath));
  const sessionTypes = getSessionTypes(editableSessionTypes);

  return (
    <div className="session-launcher">
      <div className="session-launcher-content">
        <div className="session-launcher-ascii">{">"} <span className="session-launcher-cursor">_</span></div>
        <div className="session-launcher-title">start a new session</div>
        <div className="session-launcher-project">~/{project?.name ?? projectPath.split(/[/\\]/).pop()}</div>
        <div className="session-launcher-list">
          {sessionTypes.map((st) => (
            <button
              key={st.id}
              className="session-launcher-entry"
              onClick={() => spawnNewSession(st.id, projectPath)}
            >
              <span className="session-launcher-entry-prefix">{st.prefix ?? ">"}</span>
              <span className="session-launcher-entry-name">{st.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
