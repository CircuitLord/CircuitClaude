import { useState, useRef, useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { DEFAULT_SETTINGS, ThemeName } from "../types";
import { THEME_OPTIONS } from "../lib/themes";

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

const CURSOR_STYLE_OPTIONS: Array<{ label: string; value: "bar" | "block" | "underline" }> = [
  { label: "bar", value: "bar" },
  { label: "block", value: "block" },
  { label: "underline", value: "underline" },
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
/*  Toggle — text [x] / [ ]                                          */
/* ------------------------------------------------------------------ */
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`settings-toggle ${checked ? "settings-toggle--on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      {checked ? "[x]" : "[ ]"}
    </button>
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
/*  Segmented Control — bracket selection [bar] block underline       */
/* ------------------------------------------------------------------ */
function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings-segmented">
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            className={[
              "settings-segmented-btn",
              isActive ? "settings-segmented-btn--active" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => onChange(opt.value)}
          >
            {isActive ? `[${opt.label}]` : ` ${opt.label} `}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Terminal Preview                                                   */
/* ------------------------------------------------------------------ */
function TerminalPreview() {
  const { settings } = useSettingsStore();

  const cursorClass = [
    "settings-preview-cursor",
    `settings-preview-cursor--${settings.terminalCursorStyle}`,
    settings.terminalCursorBlink ? "settings-preview-cursor--blink" : "",
  ].filter(Boolean).join(" ");

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
        className={cursorClass}
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
                <span className="settings-row-name">color-theme</span>
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
            <div className="settings-section-title">~cursor</div>
            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-name">cursor-style</span>
              </div>
              <SegmentedControl
                value={settings.terminalCursorStyle}
                options={CURSOR_STYLE_OPTIONS}
                onChange={(v) => update({ terminalCursorStyle: v })}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span className="settings-row-name">cursor-blink</span>
              </div>
              <Toggle
                checked={settings.terminalCursorBlink}
                onChange={(v) => update({ terminalCursorBlink: v })}
              />
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
