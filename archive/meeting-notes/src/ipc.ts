// Typed bridge to the Rust engine. With ?mock=1 in the URL a scripted fake
// backend drives the UI instead (used by Playwright and browser-only dev).

import type { Conversation, EngineStatus, Item, Speaker } from "./types";

export interface OpenedConversation {
  conversation: Conversation;
  /** item.file → displayable URL for bundled images */
  assetUrls: Record<string, string>;
}

export interface Backend {
  startRecording(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stopRecording(): Promise<Conversation>;
  saveAs(): Promise<string | null>; // returns saved path or null if cancelled
  openFile(): Promise<OpenedConversation | null>;
  addImage(
    path: string,
    afterItemId: string | null,
  ): Promise<{ item: Item; url: string }>;
  /** Fires with absolute file paths when files are dropped on the window. */
  onDragDrop(cb: (paths: string[]) => void): () => void;
  renameSpeaker(speakerId: string, name: string): Promise<void>;
  checkRecovery(): Promise<Conversation | null>;
  recover(): Promise<Conversation>;
  discardRecovery(): Promise<void>;
  onPartial(cb: (utteranceId: string, text: string) => void): () => void;
  onFinal(cb: (item: import("./types").Item) => void): () => void;
  onLevel(cb: (rms: number) => void): () => void;
  onStatus(cb: (state: EngineStatus) => void): () => void;
  onSpeakerUpdated(cb: (speaker: Speaker) => void): () => void;
}

function isMock(): boolean {
  return new URLSearchParams(window.location.search).has("mock");
}

// ---------------------------------------------------------------- real ----

function realBackend(): Backend {
  type Listener<T> = (payload: T) => void;
  const make = () => {
    // Lazy imports so the mock path never touches @tauri-apps in a browser.
    return {
      invoke: (cmd: string, args?: Record<string, unknown>) =>
        import("@tauri-apps/api/core").then((m) => m.invoke(cmd, args)),
      listen: <T,>(event: string, cb: Listener<T>) =>
        import("@tauri-apps/api/event").then((m) =>
          m.listen<T>(event, (e) => cb(e.payload)),
        ),
    };
  };
  const t = make();

  const sub = <T,>(event: string, cb: Listener<T>): (() => void) => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    t.listen<T>(event, cb).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  };

  return {
    startRecording: () => t.invoke("start_recording") as Promise<void>,
    pause: () => t.invoke("pause") as Promise<void>,
    resume: () => t.invoke("resume") as Promise<void>,
    stopRecording: () => t.invoke("stop") as Promise<Conversation>,
    saveAs: async () => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "Untitled.mnote",
        filters: [{ name: "Minutes conversation", extensions: ["mnote"] }],
      });
      if (!path) return null;
      await t.invoke("save", { path });
      return path;
    },
    openFile: async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        filters: [{ name: "Minutes conversation", extensions: ["mnote"] }],
      });
      if (!path || Array.isArray(path)) return null;
      const res = (await t.invoke("open", { path })) as {
        conversation: Conversation;
        asset_dir: string;
      };
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const assetUrls: Record<string, string> = {};
      for (const item of res.conversation.items) {
        if (item.type === "image") {
          const base = item.file.replace(/^assets\//, "");
          assetUrls[item.file] = convertFileSrc(`${res.asset_dir}/${base}`);
        }
      }
      return { conversation: res.conversation, assetUrls };
    },
    addImage: async (path, afterItemId) => {
      const item = (await t.invoke("add_image", { path, afterItemId })) as Item;
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      return { item, url: convertFileSrc(path) };
    },
    onDragDrop: (cb) => {
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
        getCurrentWebview()
          .onDragDropEvent((event) => {
            if (event.payload.type === "drop") cb(event.payload.paths);
          })
          .then((u) => {
            if (cancelled) u();
            else unlisten = u;
          }),
      );
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
    renameSpeaker: (speakerId, name) =>
      t.invoke("rename_speaker", { speakerId, name }) as Promise<void>,
    checkRecovery: () => t.invoke("check_recovery") as Promise<Conversation | null>,
    recover: () => t.invoke("recover") as Promise<Conversation>,
    discardRecovery: () => t.invoke("discard_recovery") as Promise<void>,
    onPartial: (cb) =>
      sub<{ utteranceId: string; text: string }>("timeline/partial", (p) =>
        cb(p.utteranceId, p.text),
      ),
    onFinal: (cb) => sub("timeline/final", cb),
    onLevel: (cb) => sub<{ rms: number }>("audio/level", (p) => cb(p.rms)),
    onStatus: (cb) =>
      sub<{ state: EngineStatus }>("engine/status", (p) => cb(p.state)),
    onSpeakerUpdated: (cb) => sub<Speaker>("timeline/speaker-updated", cb),
  };
}

// ---------------------------------------------------------------- mock ----

function mockBackend(): Backend {
  const partialCbs: ((id: string, text: string) => void)[] = [];
  const finalCbs: ((item: import("./types").Item) => void)[] = [];
  const levelCbs: ((rms: number) => void)[] = [];
  const statusCbs: ((s: EngineStatus) => void)[] = [];
  const speakerCbs: ((sp: Speaker) => void)[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];
  let levelTimer: ReturnType<typeof setInterval> | undefined;

  const conv: Conversation = {
    schema_version: 1,
    id: "mock",
    title: "Untitled conversation",
    started_at: new Date().toISOString(),
    ended_at: null,
    engine: {
      stt: { engine: "whisper.cpp", model: "small" },
      diarization: { engine: "none", model: "none" },
    },
    speakers: [
      { id: "spk-1", name: "Speaker 1", color: "#5B8DEF", auto_named: false },
    ],
    items: [],
  };

  const utt = (id: string, text: string, t0: number, t1: number, spk = "spk-1") =>
    ({
      type: "utterance",
      id,
      speaker_id: spk,
      text,
      t_start: t0,
      t_end: t1,
      wall_time: new Date().toISOString(),
    }) as const;

  return {
    async startRecording() {
      statusCbs.forEach((cb) => cb("recording"));
      levelTimer = setInterval(
        () => levelCbs.forEach((cb) => cb(0.05 + 0.2 * Math.abs(Math.sin(Date.now() / 300)))),
        66,
      );
      const script: [number, () => void][] = [
        [400, () => partialCbs.forEach((cb) => cb("utt-0001", "This is the"))],
        [900, () => partialCbs.forEach((cb) => cb("utt-0001", "This is the first sentence"))],
        [
          1400,
          () => {
            // Real engine emits SpeakerUpdated when a speaker first appears.
            speakerCbs.forEach((cb) => cb({ ...conv.speakers[0] }));
            const item = utt("utt-0001", "This is the first sentence.", 0.4, 2.1);
            conv.items.push(item as never);
            finalCbs.forEach((cb) => cb(item));
          },
        ],
        [1900, () => partialCbs.forEach((cb) => cb("utt-0002", "And after a pause"))],
        [
          2400,
          () => {
            const sp2: Speaker = {
              id: "spk-2",
              name: "Speaker 2",
              color: "#E0716C",
              auto_named: false,
            };
            conv.speakers.push(sp2);
            speakerCbs.forEach((cb) => cb(sp2));
            const item = utt(
              "utt-0002",
              "And after a pause, this is the second sentence.",
              3.0,
              5.2,
              "spk-2",
            );
            conv.items.push(item as never);
            finalCbs.forEach((cb) => cb(item));
          },
        ],
        [
          3000,
          () => {
            // Scripted "I am Alice" auto-rename of speaker 1.
            const sp = conv.speakers[0];
            sp.name = "Alice";
            sp.auto_named = true;
            speakerCbs.forEach((cb) => cb({ ...sp }));
          },
        ],
      ];
      timers = script.map(([ms, fn]) => setTimeout(fn, ms));
    },
    async pause() {
      statusCbs.forEach((cb) => cb("paused"));
    },
    async resume() {
      statusCbs.forEach((cb) => cb("recording"));
    },
    async stopRecording() {
      timers.forEach(clearTimeout);
      if (levelTimer) clearInterval(levelTimer);
      statusCbs.forEach((cb) => cb("stopped"));
      conv.ended_at = new Date().toISOString();
      return conv;
    },
    async saveAs() {
      return "/tmp/mock.mnote";
    },
    async openFile() {
      // Include an image item so image rendering is exercisable in tests.
      const png =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#5B8DEF"/><text x="16" y="66" fill="#fff" font-family="sans-serif">whiteboard.png</text></svg>',
        );
      const img = {
        type: "image",
        id: "img-0001",
        file: "assets/img-0001.png",
        wall_time: new Date().toISOString(),
        caption: null,
      } as const;
      return {
        conversation: {
          ...conv,
          title: "Reopened conversation",
          items: [...conv.items, img],
        },
        assetUrls: { "assets/img-0001.png": png },
      };
    },
    async addImage(path, _afterItemId) {
      const n = conv.items.filter((i) => i.type === "image").length + 1;
      const item = {
        type: "image",
        id: `img-${String(n).padStart(4, "0")}`,
        file: `assets/img-${String(n).padStart(4, "0")}.png`,
        wall_time: new Date().toISOString(),
        caption: null,
      } as const;
      conv.items.push(item as never);
      return { item, url: path };
    },
    onDragDrop() {
      return () => {};
    },
    async renameSpeaker(speakerId, name) {
      const sp = conv.speakers.find((s) => s.id === speakerId);
      if (!sp) throw new Error("unknown speaker");
      sp.name = name;
      sp.auto_named = false;
      speakerCbs.forEach((cb) => cb({ ...sp }));
    },
    onPartial(cb) {
      partialCbs.push(cb);
      return () => partialCbs.splice(partialCbs.indexOf(cb), 1);
    },
    onFinal(cb) {
      finalCbs.push(cb);
      return () => finalCbs.splice(finalCbs.indexOf(cb), 1);
    },
    onLevel(cb) {
      levelCbs.push(cb);
      return () => levelCbs.splice(levelCbs.indexOf(cb), 1);
    },
    onStatus(cb) {
      statusCbs.push(cb);
      return () => statusCbs.splice(statusCbs.indexOf(cb), 1);
    },
    onSpeakerUpdated(cb) {
      speakerCbs.push(cb);
      return () => speakerCbs.splice(speakerCbs.indexOf(cb), 1);
    },
    async checkRecovery() {
      return null;
    },
    async recover() {
      return conv;
    },
    async discardRecovery() {},
  };
}

export const backend: Backend = isMock() ? mockBackend() : realBackend();
