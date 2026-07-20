import { open } from "@tauri-apps/plugin-dialog";
import { usePinnedFilesStore } from "../stores/pinnedFilesStore";
import { openFileTab } from "../lib/sessions";

export function PinsPanel() {
  const pins = usePinnedFilesStore((s) => s.pins);
  const addPin = usePinnedFilesStore((s) => s.addPin);
  const removePin = usePinnedFilesStore((s) => s.removePin);

  async function handleAdd() {
    const selected = await open({ multiple: true, directory: false });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const name = filePath.replace(/\\/g, "/").split("/").pop() || filePath;
      await addPin({ path: filePath, name });
    }
  }

  // ungrouped first, then by group
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
    <>
      <div className="right-panel-header">
        <span className="right-panel-title">~/pins</span>
        <div className="right-panel-header-actions">
          <button className="right-panel-action" onClick={handleAdd}>
            + add
          </button>
        </div>
      </div>
      <div className="sidebar-divider" />
      <div className="right-panel-body">
        {pins.length === 0 ? (
          <div className="pins-empty">no pinned files</div>
        ) : (
          <div className="pins-list">
            {ungrouped.map((pin) => (
              <PinRow key={pin.path} pin={pin} onRemove={removePin} />
            ))}
            {[...groups.entries()].map(([group, groupPins]) => (
              <div key={group}>
                <div className="pins-group-header">~{group}</div>
                {groupPins.map((pin) => (
                  <PinRow key={pin.path} pin={pin} onRemove={removePin} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PinRow({
  pin,
  onRemove,
}: {
  pin: { path: string; name: string };
  onRemove: (path: string) => void;
}) {
  const displayPath = pin.path.replace(/\\/g, "/");
  return (
    <div className="pins-item">
      <button
        className="pins-item-btn"
        onClick={() => openFileTab(pin.path, pin.name, false)}
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
