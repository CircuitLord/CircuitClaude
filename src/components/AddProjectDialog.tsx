import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../stores/projectStore";
import { getNextProjectTheme } from "../lib/themes";

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
      const theme = getNextProjectTheme(useProjectStore.getState().projects);
      await addProject({ name, path: selected, theme });
    }
  }

  return handleAdd;
}

