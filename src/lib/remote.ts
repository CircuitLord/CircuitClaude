import { invoke } from "@tauri-apps/api/core";
import type { RemoteConfig, RemoteSpec } from "../types";

export const SSH_SCHEME = "ssh://";

export function isRemotePath(path: string): boolean {
  return path.startsWith(SSH_SCHEME);
}

export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:/.test(path);
}

/** Drive roots and "/" have no parent to browse up to. */
export function isRootPath(path: string): boolean {
  return path === "/" || /^[A-Za-z]:\/?$/.test(path);
}

/** Splits "ssh://user@host:2222/srv/app" into its authority and path. */
export function splitRemotePath(path: string): { authority: string; path: string } | null {
  if (!isRemotePath(path)) return null;
  const rest = path.slice(SSH_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return { authority: rest, path: "/" };
  const tail = rest.slice(slash);
  // windows paths keep their drive letter: "/C:/app" is really "C:/app"
  const normalized = isWindowsPath(tail.slice(1)) ? tail.slice(1) : tail;
  return { authority: rest.slice(0, slash), path: normalized };
}

export function remoteAuthority(spec: RemoteSpec): string {
  const user = spec.user ? `${spec.user}@` : "";
  const port = spec.port && spec.port !== 22 ? `:${spec.port}` : "";
  return `${user}${spec.host}${port}`;
}

export function remoteUrl(spec: RemoteSpec, path: string): string {
  return `${SSH_SCHEME}${remoteAuthority(spec)}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Host portion of a remote project path, for badges and titles. */
export function remoteHostLabel(path: string): string | null {
  const parsed = splitRemotePath(path);
  if (!parsed) return null;
  return parsed.authority.split("@").pop() ?? parsed.authority;
}

/** How a project path reads in the UI — remote paths lose the scheme noise. */
export function displayPath(path: string): string {
  const parsed = splitRemotePath(path);
  return parsed ? `${parsed.authority}:${parsed.path}` : path;
}

export function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const parent = slash <= 0 ? trimmed.slice(0, 2) : trimmed.slice(0, slash);
  if (isWindowsPath(parent)) return parent.length === 2 ? `${parent}/` : parent;
  return slash <= 0 ? "/" : parent;
}

export function baseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

export interface RemoteListing {
  path: string;
  dirs: string[];
  isGitRepo: boolean;
}

export function listRemoteDirs(spec: RemoteSpec, path?: string): Promise<RemoteListing> {
  return invoke<RemoteListing>("list_remote_dirs", { spec, path: path ?? null });
}

export function loadRemotes(): Promise<RemoteConfig[]> {
  return invoke<RemoteConfig[]>("load_remotes");
}

export function saveRemotes(remotes: RemoteConfig[]): Promise<void> {
  return invoke("save_remotes", { remotes });
}

/** Records the key for an authority so the backend can reconnect to it later. */
export async function rememberRemote(spec: RemoteSpec): Promise<void> {
  const authority = remoteAuthority(spec);
  const existing = await loadRemotes();
  const prior = existing.find((r) => r.authority === authority);
  const next = existing.filter((r) => r.authority !== authority);
  next.push({ authority, keyPath: spec.keyPath || prior?.keyPath || null });
  await saveRemotes(next);
}
