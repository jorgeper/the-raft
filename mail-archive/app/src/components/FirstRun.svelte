<script lang="ts">
  import { errorText, setLibraryPath } from "../lib/api";
  import { pickFolder } from "../lib/pick";

  /** `path`: the default library folder. `onimport`: called once the library is set up. */
  let { path, onimport }: { path: string; onimport: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let chosen = $state(path);
  let warning = $state<string | null>(null);
  let error = $state<string | null>(null);
  let working = $state(false);

  async function choose() {
    error = null;
    try {
      const dir = await pickFolder("Choose a folder for your mail library");
      if (dir === null) return;
      working = true;
      warning = await setLibraryPath(dir);
      chosen = dir;
    } catch (err) {
      error = errorText(err);
    } finally {
      working = false;
    }
  }

  async function start() {
    error = null;
    working = true;
    try {
      warning = await setLibraryPath(chosen);
      onimport();
    } catch (err) {
      error = errorText(err);
    } finally {
      working = false;
    }
  }
</script>

<main class="first-run">
  <h1>Mail Archive</h1>
  <p>Search your Gmail Takeout archive. Everything stays on this Mac.</p>
  <p class="label">Your library will be stored in</p>
  <p class="path" data-testid="library-path">{chosen}</p>
  {#if warning}<p class="warning" role="alert">{warning}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button onclick={choose} disabled={working}>Choose another…</button>
    <button class="primary" onclick={start} disabled={working}>Import Takeout…</button>
  </div>
</main>

<style>
  .first-run {
    max-width: 520px;
    margin: 12vh auto 0;
    padding: 0 24px;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 24px;
  }
  .label {
    margin: 20px 0 4px;
    color: var(--muted);
  }
  .path {
    margin: 0;
    padding: 8px 10px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12px;
    word-break: break-all;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .warning {
    margin: 12px 0 0;
    padding: 10px 12px;
    border: 1px solid #c77700;
    border-radius: 6px;
    background: rgba(255, 170, 0, 0.14);
  }
  .error {
    color: #c0392b;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }
  button {
    font: inherit;
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input-bg);
    color: var(--fg);
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.6;
  }
</style>
