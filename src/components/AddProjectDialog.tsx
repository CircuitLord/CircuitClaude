import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../stores/projectStore";

export function useAddProject() {
  const addProject = useProjectStore((s) => s.addProject);

  async function handleAdd() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select project folder",
    });

    if (selected && typeof selected === "string") {
      const parts = selected.replace(/\\/g, "/").split("/");
      const name = parts[parts.length - 1] || selected;
      await addProject({ name, path: selected });
    }
  }

  return handleAdd;
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M7 3V11M3 7H11" />
    </svg>
  );
}

export function AddProjectDialog() {
  const handleAdd = useAddProject();

  return (
    <button className="sidebar-add-card" onClick={handleAdd}>
      <PlusIcon />
      + new
    </button>
  );
}
