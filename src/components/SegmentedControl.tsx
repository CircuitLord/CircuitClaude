export function SegmentedControl<T extends string>({
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
