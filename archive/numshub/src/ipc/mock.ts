// Browser mock of the Tauri IPC surface. Drives the E2E suite (SPEC §8.3):
// simulated download state machine, hotkey capture, enhancement test, and a
// window.__mock handle so Playwright can steer failure paths and overlay events.

import type { Ipc } from "./api";
import type {
  DownloadProgress,
  HistoryEntry,
  ModelStatus,
  Settings,
} from "./types";
import { defaultSettings } from "./types";

type Handler = (payload: unknown) => void;

const listeners = new Map<string, Set<Handler>>();

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h(payload));
}

const CATALOG: Omit<ModelStatus, "downloaded" | "downloading" | "partial_bytes" | "active">[] = [
  {
    id: "parakeet-tdt-0.6b-v3",
    display_name: "Parakeet V3",
    engine: "parakeet",
    url: "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
    sha256: "43d37191602727524a7d8c6da0eef11c4ba24320f5b4730f1a2497befc2efa77",
    size_bytes: 478517071,
    languages: "25 European languages",
    description: "Fast and accurate — the best balance of speed and quality. Recommended.",
    recommended: true,
    kind: "archive",
    filename: "",
  },
  {
    id: "whisper-large-v3-turbo",
    display_name: "Whisper Large v3 Turbo",
    engine: "whisper",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    size_bytes: 1624555275,
    languages: "99 languages",
    description: "Best multilingual coverage. Larger download, slower than Parakeet.",
    recommended: false,
    kind: "file",
    filename: "ggml-large-v3-turbo.bin",
  },
  {
    id: "whisper-small",
    display_name: "Whisper Small",
    engine: "whisper",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    size_bytes: 487601967,
    languages: "99 languages",
    description: "Mid-size multilingual Whisper. Good quality on modest hardware.",
    recommended: false,
    kind: "file",
    filename: "ggml-small.bin",
  },
  {
    id: "whisper-tiny",
    display_name: "Whisper Tiny",
    engine: "whisper",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    size_bytes: 77691713,
    languages: "99 languages",
    description: "Quick start — small download, fastest transcription, lowest accuracy.",
    recommended: false,
    kind: "file",
    filename: "ggml-tiny.bin",
  },
];

interface MockModelState {
  downloaded: boolean;
  downloading: boolean;
  partial_bytes: number;
  timer: ReturnType<typeof setInterval> | null;
}

const params = new URLSearchParams(window.location.search);
const onboardingMode = params.get("onboarding") === "1";
// ?grant=microphone,accessibility,capture,menubar pre-grants permissions
// (E9e resume tests).
const preGranted = new Set((params.get("grant") ?? "").split(",").filter(Boolean));

// Settings survive a reload within a test tab (E13a) via sessionStorage.
function loadPersistedSettings(): Partial<Settings> {
  try {
    return JSON.parse(sessionStorage.getItem("mock-settings") ?? "{}");
  } catch {
    return {};
  }
}

const state = {
  settings: {
    ...defaultSettings(),
    onboarding_complete: !onboardingMode,
    // Onboarding mode starts with no model at all (the model step is a gate).
    active_model: onboardingMode || params.get("noModel") === "1" ? null : "whisper-tiny",
    ...loadPersistedSettings(),
  } as Settings,
  // Onboarding mode starts ungranted; the normal mode simulates a healthy,
  // fully configured app (recovery tests break it via __mock.revoke).
  permissions: {
    microphone: !onboardingMode || preGranted.has("microphone"),
    accessibility: !onboardingMode || preGranted.has("accessibility"),
    captureReady: !onboardingMode || preGranted.has("capture"),
    menubar: !onboardingMode || preGranted.has("menubar"),
  },
  models: new Map<string, MockModelState>(
    CATALOG.map((m) => [
      m.id,
      {
        downloaded:
          m.id === "whisper-tiny" && !onboardingMode && params.get("noModel") !== "1",
        downloading: false,
        partial_bytes: 0,
        timer: null,
      },
    ]),
  ),
  history: [
    "Ship the release notes on Wednesday.",
    "Remember to water the ficus before standup.",
    "The quarterly numbers look better than expected.",
    "Draft an intro paragraph for the design doc.",
    "Call the dentist about rescheduling Thursday.",
  ].map(
    (text, i): HistoryEntry => ({
      text,
      timestamp: new Date(Date.now() - i * 3_600_000).toISOString(),
      model_id: "whisper-tiny",
    }),
  ),
  failNextDownload: null as string | null,
  calls: [] as { command: string; args: Record<string, unknown> | undefined }[],
  captureTimer: null as ReturnType<typeof setTimeout> | null,
};

function modelList(): ModelStatus[] {
  return CATALOG.map((m) => {
    const s = state.models.get(m.id)!;
    return {
      ...m,
      downloaded: s.downloaded,
      downloading: s.downloading,
      partial_bytes: s.partial_bytes,
      active: state.settings.active_model === m.id,
    };
  });
}

function startDownload(modelId: string): Promise<void> {
  const meta = CATALOG.find((m) => m.id === modelId);
  const s = state.models.get(modelId);
  if (!meta || !s) return Promise.reject(new Error(`unknown model '${modelId}'`));
  if (s.downloading) return Promise.reject(new Error("already downloading"));
  s.downloading = true;
  const shouldFail = state.failNextDownload === modelId;

  return new Promise<void>((resolve, reject) => {
    let pct = Math.round((s.partial_bytes / meta.size_bytes) * 100);
    s.timer = setInterval(() => {
      pct += 10;
      s.partial_bytes = Math.round((pct / 100) * meta.size_bytes);
      if (shouldFail && pct >= 40) {
        clearInterval(s.timer!);
        s.timer = null;
        s.downloading = false;
        state.failNextDownload = null;
        emit("model-download-failed", {
          model_id: modelId,
          error: "checksum mismatch — the download was corrupt and has been removed",
        });
        reject(new Error("checksum mismatch"));
        return;
      }
      if (pct >= 100) {
        clearInterval(s.timer!);
        s.timer = null;
        emit("model-download-progress", {
          model_id: modelId,
          downloaded: meta.size_bytes,
          total: meta.size_bytes,
          percentage: 100,
        } satisfies DownloadProgress);
        emit("model-verification-started", modelId);
        setTimeout(() => {
          emit("model-verification-completed", modelId);
          s.downloading = false;
          s.downloaded = true;
          s.partial_bytes = 0;
          emit("model-download-complete", modelId);
          resolve();
        }, 600);
        return;
      }
      emit("model-download-progress", {
        model_id: modelId,
        downloaded: s.partial_bytes,
        total: meta.size_bytes,
        percentage: pct,
      } satisfies DownloadProgress);
    }, 60);
  });
}

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  state.calls.push({ command, args });
  switch (command) {
    case "get_settings":
      return structuredClone(state.settings);
    case "set_settings": {
      // Mirrors the Rust command: active_model is server-owned and a
      // whole-object UI write never clobbers it.
      const incoming = structuredClone(args!.settings as Settings);
      incoming.active_model = state.settings.active_model;
      state.settings = incoming;
      try {
        sessionStorage.setItem("mock-settings", JSON.stringify(state.settings));
      } catch {
        /* storage unavailable */
      }
      return;
    }
    case "list_models":
      return modelList();
    case "download_model":
      return startDownload(args!.modelId as string);
    case "cancel_download": {
      const s = state.models.get(args!.modelId as string);
      if (s?.timer) {
        clearInterval(s.timer);
        s.timer = null;
        s.downloading = false;
        emit("model-download-cancelled", args!.modelId);
        return true;
      }
      return false;
    }
    case "delete_model": {
      const s = state.models.get(args!.modelId as string)!;
      s.downloaded = false;
      s.partial_bytes = 0;
      if (state.settings.active_model === args!.modelId) {
        state.settings.active_model = null;
      }
      emit("model-deleted", args!.modelId);
      return;
    }
    case "set_active_model": {
      const s = state.models.get(args!.modelId as string);
      if (!s?.downloaded) throw new Error("model is not downloaded");
      state.settings.active_model = args!.modelId as string;
      return;
    }
    case "get_history":
      return structuredClone(state.history);
    case "clear_history":
      state.history = [];
      emit("history-changed", null);
      return;
    case "copy_text":
      return;
    case "retry_last_transcription":
    case "toggle_dictation":
    case "cancel_dictation":
      return;
    case "test_enhancement": {
      const sample = (args?.sample as string) || "";
      if (!state.settings.enhancement.endpoint.match(/^https?:\/\/(localhost|127\.0\.0\.1)/)) {
        throw new Error("enhancement endpoint must be localhost");
      }
      await new Promise((r) => setTimeout(r, 150));
      return sample
        ? "I think we should ship it on Wednesday."
        : "Cleaned sample text.";
    }
    case "list_input_devices":
      return ["MacBook Pro Microphone", "External USB Mic"];
    case "start_hotkey_capture":
      if (!state.permissions.captureReady) {
        throw new Error("keyboard capture is not initialized (grant Accessibility first)");
      }
      state.captureTimer = setTimeout(() => {
        emit("hotkey-capture-event", { hotkey_string: "command_right", is_key_down: true });
        setTimeout(() => {
          emit("hotkey-capture-event", { hotkey_string: "command_right", is_key_down: false });
        }, 120);
      }, 250);
      return;
    case "stop_hotkey_capture":
      if (state.captureTimer) clearTimeout(state.captureTimer);
      return;
    case "initialize_capture":
      return state.permissions.captureReady;
    case "get_app_info":
      return {
        version: "0.1.0-mock",
        can_paste: state.permissions.accessibility,
        capture_ready: state.permissions.captureReady,
        platform: "macos",
      };
    case "open_settings":
      return;
    case "tray_item_visible":
      return state.permissions.menubar;
    case "open_menu_bar_settings":
      return;
    case "list_user_themes":
      return [
        {
          id: "user:midnight-ocean",
          name: "Midnight Ocean",
          variant: "dark",
          css: ".nh-theme { --nh-pill-bg: rgba(11, 22, 34, 0.92); --nh-fx-primary: rgba(74, 168, 255, 1); --nh-fx-accent: rgba(159, 208, 255, 1); --nh-fx-glow: rgba(74, 168, 255, 0.8); --nh-text: rgba(216, 226, 236, 1); --nh-pill-border: rgba(74, 168, 255, 0.25); --nh-tentative-opacity: 0.55; --nh-placeholder: rgba(216, 226, 236, 0.45); --nh-timer: rgba(216, 226, 236, 0.7); --nh-rec-dot: rgba(255, 92, 119, 1); --nh-font: system-ui; }",
          reason: null,
        },
        {
          id: "user:broken-remote",
          name: "Broken Remote",
          variant: "dark",
          css: "",
          reason: "references a remote url() — Numshub themes are offline-only",
        },
      ];
    default:
      throw new Error(`mock: unhandled command '${command}'`);
  }
}

export const mockIpc: Ipc = {
  invoke: invoke as Ipc["invoke"],
  listen: async (event, handler) => {
    const set = listeners.get(event) ?? new Set();
    set.add(handler as Handler);
    listeners.set(event, set);
    return () => set.delete(handler as Handler);
  },
};

// The permission facade used in browser mode (SPEC2 §4).
export const mockPerms = {
  checkMicrophone: async () => state.permissions.microphone,
  requestMicrophone: async () => {},
  checkAccessibility: async () => state.permissions.accessibility,
  requestAccessibility: async () => {},
  checkTrayVisible: async () => state.permissions.menubar,
  openMenuBarSettings: async () => {
    state.calls.push({ command: "open_menu_bar_settings", args: undefined });
  },
  checkCaptureReady: async () => state.permissions.captureReady,
};

export type Grantable = "microphone" | "accessibility" | "capture" | "menubar";

// Playwright drives failure paths, permission grants, and overlay events
// through this handle.
declare global {
  interface Window {
    __mock?: {
      emit: (event: string, payload: unknown) => void;
      failNextDownload: (modelId: string) => void;
      calls: () => { command: string; args: Record<string, unknown> | undefined }[];
      captureKeys: (hotkeyString: string) => void;
      grant: (what: Grantable) => void;
      revoke: (what: Grantable) => void;
      seedDeferrals: (steps: string[]) => void;
    };
  }
}

window.__mock = {
  emit,
  failNextDownload: (modelId: string) => {
    state.failNextDownload = modelId;
  },
  calls: () => state.calls,
  captureKeys: (hotkeyString: string) => {
    emit("hotkey-capture-event", { hotkey_string: hotkeyString, is_key_down: true });
    setTimeout(() => {
      emit("hotkey-capture-event", { hotkey_string: hotkeyString, is_key_down: false });
    }, 50);
  },
  grant: (what: Grantable) => {
    if (what === "microphone") state.permissions.microphone = true;
    if (what === "accessibility") state.permissions.accessibility = true;
    if (what === "menubar") state.permissions.menubar = true;
    if (what === "capture") {
      state.permissions.captureReady = true;
      emit("capture-ready", true);
    }
  },
  revoke: (what: Grantable) => {
    if (what === "microphone") state.permissions.microphone = false;
    if (what === "accessibility") state.permissions.accessibility = false;
    if (what === "menubar") state.permissions.menubar = false;
    if (what === "capture") state.permissions.captureReady = false;
  },
  seedDeferrals: (steps: string[]) => {
    state.settings.onboarding_skips = [...steps];
  },
};
