// IPC layer: real Tauri when available, mock shim in plain browsers (Playwright).

import type {
  AppInfo,
  HistoryEntry,
  ModelStatus,
  Settings,
  UserTheme,
} from "./types";

export type Unlisten = () => void;

export interface Ipc {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten>;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let ipc: Ipc | null = null;

async function getIpc(): Promise<Ipc> {
  if (ipc) return ipc;
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    ipc = {
      invoke: (command, args) => invoke(command, args),
      listen: async (event, handler) => {
        const unlisten = await listen(event, (e) => handler(e.payload as never));
        return unlisten;
      },
    };
  } else {
    const { mockIpc } = await import("./mock");
    ipc = mockIpc;
  }
  return ipc;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return (await getIpc()).invoke<T>(command, args);
}

export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<Unlisten> {
  return (await getIpc()).listen(event, handler);
}

// --- Typed command wrappers (names match src-tauri/src/commands.rs) ---

export const api = {
  getSettings: () => call<Settings>("get_settings"),
  setSettings: (settings: Settings) => call<void>("set_settings", { settings }),
  listModels: () => call<ModelStatus[]>("list_models"),
  downloadModel: (modelId: string) => call<void>("download_model", { modelId }),
  cancelDownload: (modelId: string) => call<boolean>("cancel_download", { modelId }),
  deleteModel: (modelId: string) => call<void>("delete_model", { modelId }),
  setActiveModel: (modelId: string) => call<void>("set_active_model", { modelId }),
  getHistory: () => call<HistoryEntry[]>("get_history"),
  clearHistory: () => call<void>("clear_history"),
  copyText: (text: string) => call<void>("copy_text", { text }),
  retryLastTranscription: () => call<void>("retry_last_transcription"),
  toggleDictation: () => call<void>("toggle_dictation"),
  cancelDictation: () => call<void>("cancel_dictation"),
  testEnhancement: (sample: string) => call<string>("test_enhancement", { sample }),
  listInputDevices: () => call<string[]>("list_input_devices"),
  startHotkeyCapture: () => call<void>("start_hotkey_capture"),
  stopHotkeyCapture: () => call<void>("stop_hotkey_capture"),
  initializeCapture: () => call<boolean>("initialize_capture"),
  getAppInfo: () => call<AppInfo>("get_app_info"),
  openSettings: (section?: string) => call<void>("open_settings", { section }),
  listUserThemes: () => call<UserTheme[]>("list_user_themes"),
};
