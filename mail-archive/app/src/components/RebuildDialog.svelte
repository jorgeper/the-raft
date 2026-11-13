<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "../lib/api";
  import { progressLine } from "../lib/importFormat";
  import { afterLibraryChange } from "../lib/refresh";
  import Modal from "./Modal.svelte";

  /** `confirm`: ask first (menu). The needs-rebuild banner passes false. */
  let { confirm, onclose }: { confirm: boolean; onclose: () => void } = $props();

  type Step = "confirm" | "running" | "done" | "error";
  // svelte-ignore state_referenced_locally
  let step = $state<Step>(confirm ? "confirm" : "running");
  let progress = $state<api.Progress | null>(null);
  let message = $state("");

  onMount(() => {
    const un = api.onProgress((p) => (progress = p));
    if (!confirm) void run();
    return () => void un.then((f) => f());
  });

  async function run() {
    step = "running";
    progress = null;
    try {
      await api.rebuildIndex();
      step = "done";
    } catch (err) {
      message = api.errorText(err);
      step = "error";
    } finally {
      void afterLibraryChange();
    }
  }
</script>

<Modal title="Rebuild Index">
  {#if step === "confirm"}
    <p>
      Rebuild the search index from the stored mail? This can take several minutes, and search is unavailable until it
      finishes. Your mail is not changed.
    </p>
    <div class="actions">
      <button onclick={onclose}>Cancel</button>
      <button class="primary" onclick={run}>Rebuild</button>
    </div>
  {:else if step === "running"}
    <p class="summary">Rebuilding…</p>
    <p class="muted" data-testid="progress">{progressLine(progress)}</p>
  {:else if step === "done"}
    <p class="summary">The search index was rebuilt.</p>
    <div class="actions"><button class="primary" onclick={onclose}>Done</button></div>
  {:else}
    <p class="summary" role="alert">{message}</p>
    <div class="actions"><button onclick={onclose}>Close</button></div>
  {/if}
</Modal>

<style>
  button {
    font: inherit;
    padding: 5px 14px;
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
</style>
