<script lang="ts">
  import { onMount } from "svelte";
  import { onMenuImport, onMenuRebuild, onOpenFailed } from "./lib/api";
  import FirstRun from "./components/FirstRun.svelte";
  import ImportDialog from "./components/ImportDialog.svelte";
  import OpenError from "./components/OpenError.svelte";
  import RebuildDialog from "./components/RebuildDialog.svelte";
  import ReadingPane from "./components/ReadingPane.svelte";
  import ResultsList from "./components/ResultsList.svelte";
  import SearchBox from "./components/SearchBox.svelte";
  import { copyText } from "./lib/format";
  import { refreshStatus } from "./lib/refresh";
  import { handleKey, type KeyTarget } from "./lib/keys";
  import { store } from "./lib/store.svelte";
  import { clearThreadCache, prefetchThread } from "./lib/threads";

  let selected = $state(0);
  let linkNote = $state(false);
  let linkTimer: ReturnType<typeof setTimeout> | undefined;

  // First run: the library is not configured yet. Stays up until mail has been imported.
  let onboarding = $state(false);
  let showImport = $state(false);
  let showRebuild = $state<"confirm" | "now" | null>(null);

  const status = $derived(store.status);
  const openError = $derived(status?.configured ? status.open_error : null);
  const ready = $derived(status !== null && status.configured && !status.open_error && !onboarding);
  const modalOpen = $derived(showImport || showRebuild !== null);

  let decided = false;
  $effect(() => {
    if (!status) return;
    if (!decided) {
      decided = true;
      onboarding = !status.configured;
    } else if (onboarding && status.message_count > 0) {
      onboarding = false;
    }
  });

  onMount(() => {
    void refreshStatus();
    const un = onOpenFailed(() => {
      linkNote = true;
      clearTimeout(linkTimer);
      linkTimer = setTimeout(() => (linkNote = false), 4000);
    });
    // Menu items only act on the normal screen, and never on top of another dialog.
    const unImport = onMenuImport(() => {
      if (ready && !modalOpen) showImport = true;
    });
    const unRebuild = onMenuRebuild(() => {
      if (ready && !modalOpen) showRebuild = "confirm";
    });
    return () => {
      clearTimeout(linkTimer);
      for (const u of [un, unImport, unRebuild]) void u.then((f) => f());
    };
  });
  let list: ResultsList | undefined = $state();
  let pane: ReadingPane | undefined = $state();

  const threads = $derived(store.results?.threads ?? []);
  const terms = $derived(store.results?.terms ?? []);
  const thread = $derived(threads[selected] ?? null);

  // A new result set: start at the top and drop cached threads (bodies may have changed).
  $effect(() => {
    void store.results;
    selected = 0;
    clearThreadCache();
  });

  // Prefetch the next row's thread so ArrowDown opens instantly.
  $effect(() => {
    const next = threads[selected + 1];
    if (next) prefetchThread(next.thrid, terms);
  });

  function targetOf(el: Element | null): KeyTarget {
    if (el?.closest("#search-area")) return "search";
    if (el?.closest("#reading-pane-region")) return "pane";
    return "list";
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // WKWebView may refuse the async clipboard API; fall back to a selection copy.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || modalOpen) return;
    const action = handleKey(
      { key: e.key, metaKey: e.metaKey, target: targetOf(document.activeElement) },
      { selected, count: threads.length, query: store.query },
    );
    if (action.type === "none") return;
    e.preventDefault();
    switch (action.type) {
      case "focusSearch": {
        const input = document.querySelector<HTMLInputElement>("#search-area input");
        input?.focus();
        input?.select();
        break;
      }
      case "select":
        selected = action.index;
        break;
      case "focusPane":
        pane?.focus();
        break;
      case "focusList":
        list?.focus();
        break;
      case "clear":
        store.query = "";
        break;
      case "copy":
        if (thread) void copy(copyText(thread));
        break;
    }
  }
</script>

<svelte:window {onkeydown} />

{#if ready}
  <div class="app">
    <header class="search-region"><SearchBox /></header>
    {#if status?.needs_rebuild}
      <p class="banner" role="status">
        Search index needs rebuilding
        <button onclick={() => (showRebuild = "now")} disabled={showRebuild !== null}>Rebuild Index</button>
      </p>
    {/if}
    {#if linkNote}<p class="toast" role="status">Could not open the link.</p>{/if}
    <!-- Results on screen are out of date while the library is busy or the last search failed. -->
    <div class="panes" class:stale={store.busy || store.error !== null}>
      <section id="results-region" class="results-region" aria-label="Results">
        <ResultsList bind:this={list} {selected} onselect={(i) => (selected = i)} />
      </section>
      <section id="reading-pane-region" class="reading-region" aria-label="Reading pane">
        <ReadingPane bind:this={pane} {thread} {terms} />
      </section>
    </div>
  </div>
{:else if status && onboarding}
  <FirstRun path={status.path} onimport={() => (showImport = true)} />
{:else if status && openError}
  <OpenError path={status.path} reason={openError} />
{:else if store.statusError && !status}
  <main class="status-error">
    <p role="alert">{store.statusError}</p>
    <button onclick={() => void refreshStatus()}>Try again</button>
  </main>
{/if}

{#if showImport}
  <ImportDialog onclose={() => { showImport = false; void refreshStatus(); }} />
{/if}
{#if showRebuild}
  <RebuildDialog confirm={showRebuild === "confirm"} onclose={() => (showRebuild = null)} />
{/if}

<style>
  :global(:root) {
    color-scheme: light dark;
    --bg: #f5f5f7;
    --panel: #ffffff;
    --fg: #1d1d1f;
    --muted: #6e6e73;
    --border: #d2d2d7;
    --input-bg: #ffffff;
    --chip-bg: #e8f0fe;
    --chip-fg: #1a3d7c;
    --chip-hover: #cfdffc;
    --accent: #0a60ff;
    --accent-fg: #ffffff;
    --accent-ring: rgba(10, 96, 255, 0.25);
    --shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #1c1c1e;
      --panel: #2c2c2e;
      --fg: #f2f2f7;
      --muted: #98989f;
      --border: #48484a;
      --input-bg: #1c1c1e;
      --chip-bg: #263a5c;
      --chip-fg: #cfe0ff;
      --chip-hover: #35507d;
      --accent: #4c8dff;
      --accent-fg: #0b0b0c;
      --accent-ring: rgba(76, 141, 255, 0.35);
      --shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    }
  }
  :global(html, body) {
    height: 100%;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  }
  :global(#app) {
    height: 100%;
  }
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .search-region {
    flex: none;
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .toast {
    margin: 0;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--muted);
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .banner {
    margin: 0;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(255, 170, 0, 0.18);
    border-bottom: 1px solid var(--border);
  }
  .banner button {
    font: inherit;
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input-bg);
    color: var(--fg);
  }
  .status-error {
    max-width: 520px;
    margin: 12vh auto 0;
    padding: 0 24px;
  }
  .panes.stale {
    opacity: 0.5;
  }
  .results-region {
    flex: 0 0 40%;
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }
  .reading-region {
    flex: 1 1 60%;
    min-width: 0;
    overflow: auto;
    background: var(--panel);
  }
</style>
