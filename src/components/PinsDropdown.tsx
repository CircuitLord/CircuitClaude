import { useState, useRef, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { usePinnedFilesStore } from "../stores/pinnedFilesStore";
import { openFileTab } from "../lib/sessions";

export function PinsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pins = usePinnedFilesStore((s) => s.pins);
  const addPin = usePinnedFilesStore((s) => s.addPin);
  const removePin = usePinnedFilesStore((s) => s.removePin);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement)?.blur?.();
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  async function handleAdd() {
    const selected = await open({
      multiple: true,
      directory: false,
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const name = filePath.replace(/\\/g, "/").split("/").pop() || filePath;
      await addPin({ path: filePath, name });
    }
  }

  // Group pins: ungrouped first, then by group
  const ungrouped = pins.filter((p) => !p.group);
  const groups = new Map<string, typeof pins>();
  for (const pin of pins) {
    if (pin.group) {
      const list = groups.get(pin.group) || [];
      list.push(pin);
      groups.set(pin.group, list);
    }
  }

  return (
    <div className="pins-menu" ref={containerRef}>
      <button
        className={`project-header-text-btn${isOpen ? " active" : ""}`}
        onClick={() => setIsOpen((v) => !v)}
        title="Pinned files"
      >
        :pins
      </button>
      {isOpen && (
        <div className="pins-dropdown">
          {pins.length === 0 ? (
            <div className="pins-empty">no pinned files</div>
          ) : (
            <div className="pins-list">
              {ungrouped.map((pin) => (
                <PinRow key={pin.path} pin={pin} onRemove={removePin} onClose={() => setIsOpen(false)} />
              ))}
              {[...groups.entries()].map(([group, groupPins]) => (
                <div key={group}>
                  <div className="pins-group-header">~{group}</div>
                  {groupPins.map((pin) => (
                    <PinRow key={pin.path} pin={pin} onRemove={removePin} onClose={() => setIsOpen(false)} />
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="pins-add-row">
            <button className="pins-add-btn" onClick={handleAdd}>
              + add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PinRow({
  pin,
  onRemove,
  onClose,
}: {
  pin: { path: string; name: string };
  onRemove: (path: string) => void;
  onClose: () => void;
}) {
  const displayPath = pin.path.replace(/\\/g, "/");
  return (
    <div className="pins-item">
      <button
        className="pins-item-btn"
        onClick={() => {
          openFileTab(pin.path, pin.name, false);
          onClose();
        }}
        title={displayPath}
      >
        <span className="pins-item-marker">{">"}</span>
        <span className="pins-item-name">{pin.name}</span>
      </button>
      <button
        className="pins-item-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(pin.path);
        }}
        title="Remove pin"
      >
        x
      </button>
    </div>
  );
}
