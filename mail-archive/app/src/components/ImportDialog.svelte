<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "../lib/api";
  import {
    OLDER_EXPORT_WARNING,
    doneLine,
    parseErrorLine,
    progressLine,
    removedWarning,
    summaryLine,
  } from "../lib/importFormat";
  import { pickTakeoutFiles } from "../lib/pick";
  import { afterLibraryChange } from "../lib/refresh";
  import Modal from "./Modal.svelte";

  let { onclose }: { onclose: () => void } = $props();

  type Step = "picking" | "scanning" | "summary" | "applying" | "done" | "error";
  let step = $state<Step>("picking");
  let progress = $state<api.Progress | null>(null);
  let report = $state<api.ScanReport | null>(null);
  let summary = $state<api.ImportSummary | null>(null);
  let message = $state("");
  let cancelling = $state(false);

  onMount(() => {
    const un = api.onProgress((p) => (progress = p));
    void start();
    return () => void un.then((f) => f());
  });

  function fail(err: unknown) {
    message = api.errorText(err);
    step = "error";
  }

  async function start() {
    let paths: string[];
    try {
      paths = await pickTakeoutFiles();
    } catch (err) {
      return fail(err);
    }
    if (paths.length === 0) return onclose();
    step = "scanning";
    progress = null;
    cancelling = false;
    try {
      report = await api.importScan(paths);
      step = "summary";
    } catch (err) {
      if (cancelling) onclose();
      else fail(err);
    }
  }

  async function apply() {
    step = "applying";
    progress = null;
    cancelling = false;
    try {
      summary = await api.importApply();
      step = "done";
    } catch (err) {
      // A cancelled apply is rolled back completely (core apply: any error,
      // cancel included, runs recover()); other errors show their own text.
      const text = api.errorText(err);
      message = text === "cancelled" ? "Import cancelled. Nothing was changed." : text;
      step = "error";
    } finally {
      // Batches may have been committed even when the import did not finish.
      void afterLibraryChange();
    }
  }

  /** Cancel on the summary: forget the scan that was waiting. */
  function discard() {
    void api.importDiscard();
    onclose();
  }

  function cancel() {
    cancelling = true;
    void api.importCancel();
  }

  const removedMsg = $derived(report ? removedWarning(report) : null);
  const errorsMsg = $derived(report ? parseErrorLine(report.parse_errors) : null);
</script>

<Modal title="Import Takeout">
  {#if step === "picking"}
    <p class="muted">Choosing files…</p>
  {:else if step === "scanning"}
    <p class="summary">Scanning…</p>
    <p class="muted" data-testid="progress">{progressLine(progress)}</p>
    <div class="actions">
      <button onclick={cancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel"}</button>
    </div>
  {:else if step === "summary" && report}
    <p class="summary" data-testid="summary">{summaryLine(report)}</p>
    {#if report.kind === "Partial"}
      <p class="muted">This is not a full Gmail export, so it adds new mail only and never changes labels.</p>
    {/if}
    {#if errorsMsg}<p class="muted">{errorsMsg}</p>{/if}
    {#if report.looks_older}<p class="warning" role="alert">{OLDER_EXPORT_WARNING}</p>{/if}
    {#if removedMsg}<p class="warning" role="alert">{removedMsg}</p>{/if}
    <div class="actions">
      <button onclick={discard}>Cancel</button>
      <button class="primary" onclick={apply}>Import</button>
    </div>
  {:else if step === "applying"}
    <p class="summary">Importing…</p>
    <p class="muted" data-testid="progress">{progressLine(progress)}</p>
    <div class="actions">
      <button onclick={cancel} disabled={cancelling}>{cancelling ? "Cancelling…" : "Cancel"}</button>
    </div>
  {:else if step === "done" && summary}
    <p class="summary" data-testid="done">{doneLine(summary)}</p>
    {#if parseErrorLine(summary.parse_errors)}<p class="muted">{parseErrorLine(summary.parse_errors)}</p>{/if}
    <div class="actions"><button class="primary" onclick={onclose}>Done</button></div>
  {:else if step === "error"}
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
  button:disabled {
    opacity: 0.6;
  }
</style>
