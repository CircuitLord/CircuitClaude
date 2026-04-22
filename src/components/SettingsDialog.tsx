import { useState, useRef, useEffect, useCallback } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "../stores/settingsStore";
import { DEFAULT_SETTINGS, ThemeName, SyntaxThemeName, type VoiceEngine, type SpawnableSessionType } from "../types";
import { THEME_OPTIONS, SYNTAX_THEME_OPTIONS } from "../lib/themes";
import { whisperGetAvailableModels, whisperDownloadModel, type ModelInfo, type DownloadProgress } from "../lib/whisper";
import { checkForUpdate, downloadAndInstallUpdate } from "../lib/updater";
import { Channel } from "@tauri-apps/api/core";

export function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const FONT_OPTIONS = [
  { label: "Cascadia Code", value: "'Cascadia Code', 'Consolas', 'Monaco', monospace" },
  { label: "Consolas", value: "'Consolas', 'Monaco', monospace" },
  { label: "Fira Code", value: "'Fira Code', 'Consolas', monospace" },
  { label: "JetBrains Mono", value: "'JetBrains Mono', 'Consolas', monospace" },
];

const SESSION_TYPE_OPTIONS: Array<{ label: string; value: SpawnableSessionType }> = [
  { label: "claude", value: "claude" },
  { label: "codex", value: "codex" },
  { label: "copilot", value: "copilot" },
  { label: "opencode", value: "opencode" },
  { label: "terminal", value: "shell" },
];

const DEFAULT_MIC_OPTIONS = [{ label: "system default", value: "default" }];

const WHISPER_MODEL_OPTIONS: Array<{ label: string; value: string; size: string }> = [
  { label: "tiny.en", value: "tiny.en", size: "~75 MB" },
  { label: "base.en", value: "base.en", size: "~142 MB" },
  { label: "small.en", value: "small.en", size: "~466 MB" },
  { label: "medium.en", value: "medium.en", size: "~1.5 GB" },
];

/* ------------------------------------------------------------------ */
/*  Custom Stepper — text +/-                                         */
/* ------------------------------------------------------------------ */
function Stepper({
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="settings-stepper">
      <button
        className="settings-stepper-btn"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Decrease"
      >
        -
      </button>
      <span className="settings-stepper-value">
        {value}{suffix && <span className="settings-stepper-suffix">{suffix}</span>}
      </span>
      <button
        className="settings-stepper-btn"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom Select — ASCII > trigger, * for selected                   */
/* ------------------------------------------------------------------ */
function CustomSelect<T extends string>({
  className,
  value,
  options,
  renderOption,
  onChange,
}: {
  className?: string;
  value: T;
  options: Array<{ label: string; value: T }>;
  renderOption?: (opt: { label: string; value: T }) => React.ReactNode;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [open]);

  return (
    <div className={`settings-select${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        className="settings-select-trigger"
        onClick={() => setOpen(!open)}
      >
        <span className="settings-select-chevron">{">"}</span>
        <span className="settings-select-label">{selectedLabel}</span>
      </button>
      {open && (
        <div className="settings-select-dropdown">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`settings-select-option ${opt.value === value ? "settings-select-option--active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              >
                <span className="settings-select-option-marker">
                  {opt.value === value ? "*" : " "}
                </span>
                <span className="settings-select-option-content">
                  {renderOption ? renderOption(opt) : opt.label}
                </span>
              </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Terminal Preview                                                   */
/* ------------------------------------------------------------------ */
function TerminalPreview() {
  const { settings } = useSettingsStore();

  return (
    <div className="settings-preview">
      <span
        className="settings-preview-text"
        style={{
          fontFamily: settings.terminalFontFamily,
          fontSize: `${settings.terminalFontSize}px`,
        }}
      >
        {"$ claude --session "}
      </span>
      <span
        className="settings-preview-cursor settings-preview-cursor--bar settings-preview-cursor--blink"
        style={{
          fontSize: `${settings.terminalFontSize}px`,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings Dialog                                                   */
/* ------------------------------------------------------------------ */
type SettingsPage = "main" | "hotkeys";

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { settings, update } = useSettingsStore();
  const [page, setPage] = useState<SettingsPage>("main");
  const [micOptions, setMicOptions] = useState(DEFAULT_MIC_OPTIONS);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [modelStatuses, setModelStatuses] = useState<Record<string, ModelInfo>>({});
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [appVersion, setAppVersion] = useState("");
  const [updateCheckStatus, setUpdateCheckStatus] = useState<"idle" | "checking" | "available" | "installing" | "up-to-date" | "error">("idle");
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);

  const refreshMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMicOptions(DEFAULT_MIC_OPTIONS);
      setMicStatus("microphone list unavailable");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      const seen = new Set<string>();
      const nextOptions = [...DEFAULT_MIC_OPTIONS];

      for (let i = 0; i < audioInputs.length; i += 1) {
        const device = audioInputs[i];
        if (!device.deviceId || device.deviceId === "default") continue;
        if (seen.has(device.deviceId)) continue;
        seen.add(device.deviceId);
        const label = device.label?.trim() || `microphone ${nextOptions.length}`;
        nextOptions.push({ label, value: device.deviceId });
      }

      setMicOptions(nextOptions);
      setMicStatus(nextOptions.length > 1 ? null : "only system default detected");

      if (!nextOptions.some((opt) => opt.value === settings.voiceMicDeviceId)) {
        await update({ voiceMicDeviceId: "default" });
      }
    } catch {
      setMicOptions(DEFAULT_MIC_OPTIONS);
      setMicStatus("unable to load microphones");
    }
  }, [settings.voiceMicDeviceId, update]);

  const refreshModels = useCallback(async () => {
    try {
      const models = await whisperGetAvailableModels();
      const statuses: Record<string, ModelInfo> = {};
      for (const m of models) {
        statuses[m.name] = m;
      }
      setModelStatuses(statuses);
    } catch {
      // Ignore — models just won't show status
    }
  }, []);

  const handleDownloadModel = useCallback(async (modelName: string) => {
    setDownloadingModel(modelName);
    setDownloadPercent(0);

    const progressChannel = new Channel<DownloadProgress>();
    progressChannel.onmessage = (event: DownloadProgress) => {
      if (event.type === "Progress") {
        setDownloadPercent(Math.round(event.data.percent));
      }
    };

    try {
      await whisperDownloadModel(modelName, progressChannel);
      await refreshModels();
    } catch {
      // Error handled by UI state
    } finally {
      setDownloadingModel(null);
      setDownloadPercent(0);
    }
  }, [refreshModels]);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateCheckStatus("checking");
    try {
      const info = await checkForUpdate();
      if (info) {
        setAvailableVersion(info.version);
        setUpdateCheckStatus("available");
      } else {
        setUpdateCheckStatus("up-to-date");
      }
    } catch {
      setUpdateCheckStatus("error");
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    setUpdateCheckStatus("installing");
    try {
      await downloadAndInstallUpdate();
    } catch {
      setUpdateCheckStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    getVersion().then(setAppVersion).catch(() => {});
    void refreshMicrophones();
    if (settings.voiceEngine === "whisper") {
      void refreshModels();
    }

    if (!navigator.mediaDevices?.addEventListener) return;
    const onDeviceChange = () => {
      void refreshMicrophones();
    };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, [isOpen, refreshMicrophones, settings.voiceEngine]);

  useEffect(() => {
    if (!isOpen) setPage("main");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement)?.blur?.();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-dialog-header">
          {page === "main" ? (
            <span className="settings-dialog-header-title">settings</span>
          ) : (
            <button className="settings-dialog-back" onClick={() => setPage("main")}>
              :back
            </button>
          )}
          <button className="settings-dialog-close" onClick={onClose} aria-label="Close">
            :esc
          </button>
        </div>

        {page === "main" ? (
          <div className="settings-dialog-body">
            <TerminalPreview />

            <div className="settings-section">
              <div className="settings-section-title">~theme</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">default-theme</span>
                </div>
                <CustomSelect
                  value={settings.theme}
                  options={THEME_OPTIONS}
                  renderOption={(opt) => {
                    const accent = THEME_OPTIONS.find((t) => t.value === opt.value)?.accent;
                    return (
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: accent, fontFamily: "var(--font-mono)" }}>#</span>
                        {opt.label}
                      </span>
                    );
                  }}
                  onChange={(v) => update({ theme: v as ThemeName })}
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">~syntax</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">syntax-theme</span>
                </div>
                <CustomSelect
                  value={settings.syntaxTheme}
                  options={SYNTAX_THEME_OPTIONS}
                  onChange={(v) => update({ syntaxTheme: v as SyntaxThemeName })}
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">~font</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">font-family</span>
                </div>
                <CustomSelect
                  value={settings.terminalFontFamily}
                  options={FONT_OPTIONS}
                  renderOption={(opt) => (
                    <span style={{ fontFamily: opt.value }}>{opt.label}</span>
                  )}
                  onChange={(v) => update({ terminalFontFamily: v })}
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">font-size</span>
                </div>
                <Stepper
                  value={settings.terminalFontSize}
                  min={10}
                  max={24}
                  suffix="px"
                  onChange={(v) => update({ terminalFontSize: v })}
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">~voice</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">engine</span>
                </div>
                <CustomSelect
                  value={settings.voiceEngine}
                  options={[
                    { label: "whisper (local)", value: "whisper" as VoiceEngine },
                    { label: "edge (browser)", value: "edge" as VoiceEngine },
                  ]}
                  onChange={(v) => update({ voiceEngine: v as VoiceEngine })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">microphone</span>
                </div>
                <CustomSelect
                  className="settings-select--mic"
                  value={settings.voiceMicDeviceId}
                  options={micOptions}
                  onChange={(v) => update({ voiceMicDeviceId: v })}
                />
              </div>
              {micStatus && (
                <div className="settings-row">
                  <div className="settings-row-label">
                    <span className="settings-row-name">{micStatus}</span>
                  </div>
                </div>
              )}

              {settings.voiceEngine === "whisper" && (
                <>
                  <div className="settings-row">
                    <div className="settings-row-label">
                      <span className="settings-row-name">whisper model</span>
                    </div>
                    <CustomSelect
                      value={settings.whisperModel}
                      options={WHISPER_MODEL_OPTIONS.map((m) => {
                        const status = modelStatuses[m.value];
                        const downloaded = status?.downloaded;
                        return {
                          label: `${m.label} (${m.size})${downloaded ? " *" : ""}`,
                          value: m.value,
                        };
                      })}
                      onChange={(v) => update({ whisperModel: v })}
                    />
                  </div>
                  {(() => {
                    const status = modelStatuses[settings.whisperModel];
                    if (downloadingModel === settings.whisperModel) {
                      return (
                        <div className="settings-row">
                          <div className="settings-row-label">
                            <span className="settings-row-name">downloading... {downloadPercent}%</span>
                          </div>
                        </div>
                      );
                    }
                    if (status && !status.downloaded) {
                      return (
                        <div className="settings-row">
                          <div className="settings-row-label">
                            <span className="settings-row-name">model not downloaded</span>
                          </div>
                          <button
                            className="settings-toggle"
                            onClick={() => handleDownloadModel(settings.whisperModel)}
                          >
                            [download]
                          </button>
                        </div>
                      );
                    }
                    if (status?.downloaded) {
                      return (
                        <div className="settings-row">
                          <div className="settings-row-label">
                            <span className="settings-row-name">downloaded</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="settings-row">
                        <div className="settings-row-label">
                          <span className="settings-row-name" style={{ opacity: 0.4 }}>checking...</span>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            <div className="settings-section">
              <div className="settings-section-title">~sound</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">waiting notification</span>
                </div>
                <button
                  className={`settings-toggle ${settings.soundEnabled ? "settings-toggle--on" : ""}`}
                  onClick={() => update({ soundEnabled: !settings.soundEnabled })}
                >
                  {settings.soundEnabled ? "[on]" : "[off]"}
                </button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">~tabs</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">default cli</span>
                </div>
                <CustomSelect
                  value={settings.defaultSessionType}
                  options={SESSION_TYPE_OPTIONS}
                  onChange={(v) => update({ defaultSessionType: v as SpawnableSessionType })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">auto-generate titles</span>
                </div>
                <button
                  className={`settings-toggle ${settings.useGeneratedTitles2 ? "settings-toggle--on" : ""}`}
                  onClick={() => update({ useGeneratedTitles2: !settings.useGeneratedTitles2 })}
                >
                  {settings.useGeneratedTitles2 ? "[on]" : "[off]"}
                </button>
              </div>
            </div>

            <div className="settings-section">
              <button
                className="settings-section-link"
                onClick={() => setPage("hotkeys")}
              >
                <span className="settings-section-link-label">~hotkeys</span>
                <span className="settings-section-link-chevron">{">"}</span>
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">~about</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">version</span>
                </div>
                <span className="settings-row-value">{appVersion || "..."}</span>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">
                    {updateCheckStatus === "checking" ? "checking..." :
                     updateCheckStatus === "available" ? `${availableVersion} available` :
                     updateCheckStatus === "installing" ? "installing..." :
                     updateCheckStatus === "up-to-date" ? "up to date" :
                     updateCheckStatus === "error" ? "check failed" :
                     "updates"}
                  </span>
                </div>
                {updateCheckStatus === "available" ? (
                  <button className="settings-toggle" onClick={handleInstallUpdate}>
                    :install
                  </button>
                ) : updateCheckStatus === "checking" || updateCheckStatus === "installing" ? null : (
                  <button className="settings-toggle" onClick={handleCheckUpdate}>
                    :check now
                  </button>
                )}
              </div>
            </div>

            <button
              className="settings-reset-link"
              onClick={() => update(DEFAULT_SETTINGS)}
            >
              :reset defaults
            </button>
          </div>
        ) : (
          <div className="settings-dialog-body">
            <div className="settings-section">
              <div className="settings-section-title">~hotkeys</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">new session</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+t</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">close tab</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+w</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">next / prev tab</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+pgup/pgdn</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">next / prev project</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+shift+pgup/pgdn</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">command palette</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+p</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">command palette (commands)</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+shift+p</kbd>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">~actions</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">commit message</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+enter</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">voice-to-text</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+space</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">toggle notes</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+n</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">regenerate title</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+r</kbd>
              </div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">save file (editor)</span>
                </div>
                <kbd className="settings-hotkey-kbd">ctrl+s</kbd>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-section-title">~general</div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span className="settings-row-name">close dialog</span>
                </div>
                <kbd className="settings-hotkey-kbd">esc</kbd>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
