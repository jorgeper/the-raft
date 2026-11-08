// Typed wrappers for every Tauri command. Struct fields arrive in snake_case,
// command arguments are camelCase. Commands reject with plain strings.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Byte offsets (UTF-8) into the query. */
export interface Chip {
  start: number;
  end: number;
  label: string;
}
export interface Hint {
  start: number;
  end: number;
  message: string;
}
/** Gmail thread id as a decimal string: real ids (~1.9e18) are past 2^53, which a JS number
 * cannot hold. Use it only as an opaque key; never convert it to a number. */
export type ThreadId = string;
export interface ThreadHit {
  thrid: ThreadId;
  latest_date: number;
  senders: string[];
  message_count: number;
  subject: string;
  snippet: string;
  has_attachment: boolean;
  matched: number[];
}
export interface SearchResults {
  threads: ThreadHit[];
  total_messages: number;
  /** More messages matched than the newest MAX_COLLECTED that results are grouped from. */
  capped: boolean;
  elapsed_ms: number;
  chips: Chip[];
  hints: Hint[];
  terms: string[];
}
export interface Address {
  name: string | null;
  addr: string;
}
export interface AttachmentInfo {
  part_index: number;
  filename: string | null;
  mime_type: string;
  size: number;
  content_id: string | null;
}
export interface MessageView {
  id: number;
  thrid: ThreadId;
  from: Address | null;
  to: Address[];
  cc: Address[];
  date: number;
  labels: string[];
  subject: string;
  attachments: AttachmentInfo[];
  body_url: string;
  blocked_remote: number;
}
export interface ScanReport {
  kind: "Full" | "Partial";
  source_label: string;
  total: number;
  new: number;
  label_changes: number;
  unchanged: number;
  removed: number;
  removed_fraction: number;
  matched_by_content: number;
  matched_by_header: number;
  parse_errors: number;
  duplicates_in_source: number;
  looks_older: boolean;
}
export interface ImportSummary {
  import_id: number;
  added: number;
  relabelled: number;
  removed_marked: number;
  parse_errors: number;
  elapsed_secs: number;
}
export interface Progress {
  phase: string;
  processed: number;
  bytes: number;
  total_bytes: number | null;
  rate_per_sec: number;
  errors: number;
}
export interface LibraryStatus {
  path: string;
  configured: boolean;
  message_count: number;
  needs_rebuild: boolean;
  open_error: string | null;
}
export type SuggestKind = "label" | "address";

/** The error text a command rejects with while an import/scan/rebuild holds the library. */
export const BUSY_MESSAGE = "library is busy";

export function errorText(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}
export function isBusy(err: unknown): boolean {
  return errorText(err) === BUSY_MESSAGE;
}

export const search = (q: string, offset: number, limit: number) =>
  invoke<SearchResults>("search", { q, offset, limit });
export const getThread = (thrid: ThreadId, terms: string[]) =>
  invoke<MessageView[]>("get_thread", { thrid, terms });
export const autocomplete = (kind: SuggestKind, prefix: string) =>
  invoke<string[]>("autocomplete", { kind, prefix });
export const openAttachment = (msgId: number, part: number) =>
  invoke<void>("open_attachment", { msgId, part });
export const saveAttachment = (msgId: number, part: number, dest: string) =>
  invoke<void>("save_attachment", { msgId, part, dest });
export const openLink = (url: string) => invoke<void>("open_link", { url });
export const importScan = (paths: string[]) => invoke<ScanReport>("import_scan", { paths });
export const importApply = () => invoke<ImportSummary>("import_apply", {});
export const importCancel = () => invoke<void>("import_cancel", {});
export const rebuildIndex = () => invoke<void>("rebuild_index", {});
export const libraryStatus = () => invoke<LibraryStatus>("library_status", {});
/** Resolves to a cloud-sync warning, or null. The path must be absolute. */
export const setLibraryPath = (path: string) =>
  invoke<string | null>("set_library_path", { path });
export const onProgress = (cb: (p: Progress) => void): Promise<UnlistenFn> =>
  listen<Progress>("progress", (e) => cb(e.payload));
/** Fired when handing a link to the default browser failed. */
export const onOpenFailed = (cb: () => void): Promise<UnlistenFn> => listen("open-failed", () => cb());
/** Reveal the library folder in Finder. */
export const revealLibrary = () => invoke<void>("reveal_library", {});
/** Menu events from the native menu bar (see src-tauri/src/menu.rs). */
export const onMenuImport = (cb: () => void): Promise<UnlistenFn> => listen("menu-import-takeout", () => cb());
export const onMenuRebuild = (cb: () => void): Promise<UnlistenFn> => listen("menu-rebuild-index", () => cb());
/** Close and re-open the configured library (works even when it opened but is unreadable). */
export const reopenLibrary = () => invoke<void>("reopen_library", {});
/** Drop the scan that is waiting for confirmation. */
export const importDiscard = () => invoke<void>("import_discard", {});
/** True when the folder is non-empty and does not look like a Mail Archive library. */
export const checkLibraryFolder = (path: string) => invoke<boolean>("check_library_folder", { path });
