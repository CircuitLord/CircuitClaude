import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../stores/projectStore";
import { getNextProjectTheme } from "../lib/themes";
import { SegmentedControl } from "./SegmentedControl";
import {
  baseName,
  isRootPath,
  listRemoteDirs,
  parentDir,
  rememberRemote,
  remoteUrl,
  type RemoteListing,
} from "../lib/remote";
import type { Project, RemoteSpec } from "../types";

type Mode = "local" | "remote";

interface AddProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded?: (project: Project) => void;
}

export function AddProjectDialog({ isOpen, onClose, onAdded }: AddProjectDialogProps) {
  const addProject = useProjectStore((s) => s.addProject);

  const [mode, setMode] = useState<Mode>("local");
  const [localPath, setLocalPath] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [listing, setListing] = useState<RemoteListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode("local");
    setLocalPath("");
    setPassword("");
    setName("");
    setNameEdited(false);
    setListing(null);
    setError(null);
    setBusy(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && mode === "remote") hostRef.current?.focus();
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const spec: RemoteSpec = {
    host: host.trim(),
    user: user.trim() || undefined,
    port: port.trim() ? Number(port.trim()) : undefined,
    keyPath: keyPath.trim() || undefined,
    password: password || undefined,
  };

  function applyPath(path: string) {
    if (!nameEdited) setName(baseName(path));
  }

  async function pickLocalFolder() {
    const selected = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (typeof selected !== "string") return;
    setLocalPath(selected);
    applyPath(selected.replace(/\\/g, "/"));
  }

  async function pickKeyFile() {
    const selected = await open({ multiple: false, title: "Select ssh private key" });
    if (typeof selected === "string") setKeyPath(selected);
  }

  async function browse(path?: string) {
    if (!spec.host) {
      setError("host is required");
      return;
    }
    if (port.trim() && !Number.isInteger(spec.port)) {
      setError("port must be a number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await listRemoteDirs(spec, path);
      setListing(result);
      applyPath(result.path);
    } catch (e) {
      setListing(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const targetPath = mode === "local" ? localPath : listing?.path ?? "";
  // say why the button is dead instead of leaving it mysteriously grey
  const blockedReason = busy
    ? null
    : !targetPath
      ? mode === "local"
        ? "pick a folder"
        : ":connect to pick a folder"
      : !name.trim()
        ? "name required"
        : null;
  const canAdd = !blockedReason && !busy;

  async function handleAdd() {
    if (!canAdd) return;
    const theme = getNextProjectTheme(useProjectStore.getState().projects);
    try {
      const path = mode === "remote" ? remoteUrl(spec, targetPath) : targetPath;
      if (mode === "remote") await rememberRemote(spec);
      const project: Project = { name: name.trim(), path, theme };
      await addProject(project);
      onClose();
      onAdded?.(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="dialog-overlay add-project-overlay" onMouseDown={onClose}>
      <div className="add-project-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="add-project-header">
          <span className="add-project-title">~/add-project</span>
          <SegmentedControl<Mode>
            value={mode}
            options={[
              { label: "local", value: "local" },
              { label: "remote", value: "remote" },
            ]}
            onChange={(next) => { setMode(next); setError(null); }}
          />
          <button className="settings-dialog-close" onClick={onClose}>:esc</button>
        </div>

        <div className="add-project-body">
          {mode === "local" ? (
            <button className="add-project-row add-project-row--button" onClick={pickLocalFolder}>
              <span className="add-project-marker">&gt;</span>
              <span className="add-project-label">folder</span>
              <span className={`add-project-value${localPath ? "" : " add-project-value--empty"}`} title={localPath}>
                {localPath || "none selected"}
              </span>
              <span className="add-project-action">:browse</span>
            </button>
          ) : (
            <>
              <label className="add-project-row">
                <span className="add-project-marker">&gt;</span>
                <span className="add-project-label">host</span>
                <input
                  ref={hostRef}
                  className="add-project-input"
                  value={host}
                  placeholder="10.0.0.5 or box.local"
                  spellCheck={false}
                  onChange={(e) => setHost(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") browse(); }}
                />
              </label>
              <label className="add-project-row">
                <span className="add-project-marker">&gt;</span>
                <span className="add-project-label">user</span>
                <input
                  className="add-project-input"
                  value={user}
                  placeholder="defaults to ssh config"
                  spellCheck={false}
                  onChange={(e) => setUser(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") browse(); }}
                />
              </label>
              <label className="add-project-row">
                <span className="add-project-marker">&gt;</span>
                <span className="add-project-label">port</span>
                <input
                  className="add-project-input"
                  value={port}
                  placeholder="22"
                  spellCheck={false}
                  onChange={(e) => setPort(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") browse(); }}
                />
              </label>
              <label className="add-project-row">
                <span className="add-project-marker">&gt;</span>
                <span className="add-project-label">key</span>
                <input
                  className="add-project-input"
                  value={keyPath}
                  placeholder="agent / ~/.ssh config"
                  spellCheck={false}
                  onChange={(e) => setKeyPath(e.target.value)}
                />
                <button
                  className="add-project-action"
                  onClick={(e) => { e.preventDefault(); pickKeyFile(); }}
                >
                  :browse
                </button>
              </label>
              <label className="add-project-row">
                <span className="add-project-marker">&gt;</span>
                <span className="add-project-label">password</span>
                <input
                  className="add-project-input"
                  type="password"
                  value={password}
                  placeholder="kept until app closes"
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") browse(); }}
                />
              </label>

              <div className="add-project-row add-project-row--static">
                <span className="add-project-marker">{" "}</span>
                <button className="add-project-action" disabled={busy} onClick={() => browse()}>
                  {busy ? ":connecting..." : listing ? ":reconnect" : ":connect"}
                </button>
                {listing && (
                  <span className="add-project-cwd" title={listing.path}>
                    {listing.path}
                    {listing.isGitRepo && <span className="add-project-git"> [git]</span>}
                  </span>
                )}
              </div>

              {listing && (
                <div className="add-project-browser">
                  {!isRootPath(listing.path) && (
                    <button
                      className="add-project-dir"
                      onClick={() => browse(parentDir(listing.path))}
                    >
                      <span className="add-project-dir-marker">^</span>..
                    </button>
                  )}
                  {listing.dirs.length === 0 && (
                    <div className="add-project-empty">no subdirectories</div>
                  )}
                  {listing.dirs.map((dir) => (
                    <button
                      key={dir}
                      className="add-project-dir"
                      onClick={() => browse(`${listing.path.replace(/\/+$/, "")}/${dir}`)}
                    >
                      <span className="add-project-dir-marker">&gt;</span>
                      {dir}/
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <label className="add-project-row">
            <span className="add-project-marker">&gt;</span>
            <span className="add-project-label">name</span>
            <input
              className="add-project-input"
              value={name}
              placeholder="project name"
              spellCheck={false}
              onChange={(e) => { setName(e.target.value); setNameEdited(true); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            />
          </label>

          {error && <div className="add-project-error">{error}</div>}
        </div>

        <div className="add-project-footer">
          {blockedReason && <span className="add-project-hint">{blockedReason}</span>}
          <button className="add-project-submit" disabled={!canAdd} onClick={handleAdd}>
            + add{mode === "remote" ? " remote" : ""} project
          </button>
        </div>
      </div>
    </div>
  );
}
