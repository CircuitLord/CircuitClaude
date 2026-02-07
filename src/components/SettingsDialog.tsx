import { useState, useRef, useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { DEFAULT_SETTINGS, ThemeName, SyntaxThemeName } from "../types";
import { THEME_OPTIONS, SYNTAX_THEME_OPTIONS } from "../lib/themes";

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
  value,
  options,
  renderOption,
  onChange,
}: {
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
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="settings-select" ref={ref}>
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
              {renderOption ? renderOption(opt) : opt.label}
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
export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { settings, update } = useSettingsStore();

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-dialog-header">
          <span className="settings-dialog-header-title">settings</span>
          <button className="settings-dialog-close" onClick={onClose} aria-label="Close">
            :esc
          </button>
        </div>

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
            <div className="settings-section-title">~hotkeys</div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-name">new session</span>
              </div>
              <kbd className="settings-hotkey-kbd">ctrl+t</kbd>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-name">switch to tab n</span>
              </div>
              <kbd className="settings-hotkey-kbd">ctrl+1-9</kbd>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-name">close dialog</span>
              </div>
              <kbd className="settings-hotkey-kbd">esc</kbd>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-name">commit</span>
              </div>
              <kbd className="settings-hotkey-kbd">ctrl+enter</kbd>
            </div>
          </div>

          <button
            className="settings-reset-link"
            onClick={() => update(DEFAULT_SETTINGS)}
          >
            :reset defaults
          </button>
        </div>
      </div>
    </div>
  );
}
