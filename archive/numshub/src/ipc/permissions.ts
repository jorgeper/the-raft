// Permission checks/requests: routes to tauri-plugin-macos-permissions in the
// real app, to the mock's permission state machine in plain browsers (E2E).

import { api, isTauri } from "./api";

export interface Permissions {
  checkMicrophone(): Promise<boolean>;
  requestMicrophone(): Promise<void>;
  checkAccessibility(): Promise<boolean>;
  requestAccessibility(): Promise<void>;
  /** Ground truth from the Rust CGWindowList probe (SPEC2 FR-O2c). */
  checkTrayVisible(): Promise<boolean>;
  openMenuBarSettings(): Promise<void>;
  /** Is the global hotkey listener actually armed? */
  checkCaptureReady(): Promise<boolean>;
}

async function tauriPermissions(): Promise<Permissions> {
  const plugin = await import("tauri-plugin-macos-permissions-api");
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    checkMicrophone: () => plugin.checkMicrophonePermission(),
    requestMicrophone: async () => {
      await plugin.requestMicrophonePermission();
    },
    checkAccessibility: () => plugin.checkAccessibilityPermission(),
    requestAccessibility: async () => {
      await plugin.requestAccessibilityPermission();
    },
    checkTrayVisible: () => invoke<boolean>("tray_item_visible"),
    openMenuBarSettings: async () => {
      await invoke("open_menu_bar_settings");
    },
    checkCaptureReady: async () => (await api.getAppInfo()).capture_ready,
  };
}

async function mockPermissions(): Promise<Permissions> {
  const { mockPerms } = await import("./mock");
  return mockPerms;
}

let cached: Promise<Permissions> | null = null;
export function permissions(): Promise<Permissions> {
  if (!cached) cached = isTauri() ? tauriPermissions() : mockPermissions();
  return cached;
}
