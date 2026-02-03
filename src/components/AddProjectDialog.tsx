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

