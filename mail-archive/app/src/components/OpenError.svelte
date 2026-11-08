<script lang="ts">
  import { checkLibraryFolder, errorText, reopenLibrary, revealLibrary, setLibraryPath } from "../lib/api";
  import FolderConfirm from "./FolderConfirm.svelte";
  import { pickFolder } from "../lib/pick";
  import { refreshStatus } from "../lib/refresh";

  /** `path`: the configured library folder; `reason`: the fixed error text from library_status. */
  let { path, reason }: { path: string; reason: string } = $props();

  let error = $state<string | null>(null);
  let working = $state(false);

  let confirmDir = $state<string | null>(null);

  async function open(dir: string | null) {
    confirmDir = null;
    error = null;
    working = true;
    try {
      // null: re-open the configured library (forced, so it also works when
      // the library is open but unreadable); otherwise switch to `dir`.
      if (dir === null) await reopenLibrary();
      else await setLibraryPath(dir);
      await refreshStatus();
    } catch (err) {
      error = errorText(err);
    } finally {
      working = false;
    }
  }

  async function chooseAnother() {
    try {
      const dir = await pickFolder("Open or create a different library");
      if (dir === null) return;
      if (await checkLibraryFolder(dir)) confirmDir = dir;
      else await open(dir);
    } catch (err) {
      error = errorText(err);
    }
  }
</script>

<main class="open-error">
  <h1>The library could not be opened</h1>
  <p role="alert" data-testid="open-error">{reason}</p>
  <p class="path" data-testid="library-path">{path}</p>
  <p><button class="link" onclick={() => revealLibrary().catch(() => {})}>Show in Finder</button></p>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button onclick={() => open(null)} disabled={working}>Try again</button>
    <button onclick={chooseAnother} disabled={working}>Choose another library…</button>
  </div>
  {#if confirmDir}
    <FolderConfirm path={confirmDir} onyes={() => open(confirmDir)} onno={() => (confirmDir = null)} />
  {/if}
  <p class="muted">Choosing a different library does not delete or change this one.</p>
</main>

<style>
  .open-error {
    max-width: 520px;
    margin: 12vh auto 0;
    padding: 0 24px;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 20px;
  }
  .path {
    padding: 8px 10px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12px;
    word-break: break-all;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .error {
    color: #c0392b;
  }
  .muted {
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  button {
    font: inherit;
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input-bg);
    color: var(--fg);
  }
  button.link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    text-decoration: underline;
  }
  .actions button:first-child {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
  }
</style>
