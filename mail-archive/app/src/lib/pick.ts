import { open } from "@tauri-apps/plugin-dialog";

/** Folder picker (dialog open in directory mode); null when cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  const r = await open({ directory: true, multiple: false, title });
  return typeof r === "string" ? r : null;
}

/** Takeout picker: one or more .zip or .mbox files; empty when cancelled. */
export async function pickTakeoutFiles(): Promise<string[]> {
  const r = await open({
    directory: false,
    multiple: true,
    title: "Choose Gmail Takeout files",
    filters: [{ name: "Gmail Takeout (zip or mbox)", extensions: ["zip", "mbox"] }],
  });
  return r === null ? [] : Array.isArray(r) ? r : [r];
}
