<script lang="ts">
  import { tick } from "svelte";
  import * as api from "../lib/api";
  import { applySuggestion, currentToken, insertOperator, removeSpan, type Token } from "../lib/chips";
  import { store } from "../lib/store.svelte";
  import ChipRow from "./ChipRow.svelte";

  const DEBOUNCE_MS = 100;
  const PAGE_SIZE = 200;

  let input: HTMLInputElement;
  let searchSeq = 0;
  let suggestSeq = 0;

  let suggestions = $state<string[]>([]);
  let active = $state(0);
  let token = $state<Token | null>(null);

  // Debounced search; each request carries a sequence number so an older
  // response that arrives late is dropped.
  $effect(() => {
    const q = store.query;
    const timer = setTimeout(() => void runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  async function runSearch(q: string) {
    const seq = ++searchSeq;
    try {
      const res = await api.search(q, 0, PAGE_SIZE);
      if (seq !== searchSeq) return;
      store.results = res;
      store.resultsQuery = q;
      store.busy = false;
      store.error = null;
    } catch (err) {
      if (seq !== searchSeq) return;
      if (api.isBusy(err)) {
        store.busy = true;
      } else {
        store.busy = false;
        store.error = api.errorText(err);
      }
    }
  }

  async function updateSuggestions() {
    const tok = currentToken(input.value, input.selectionStart ?? input.value.length);
    const seq = ++suggestSeq;
    if (!tok.operator || (tok.operator !== "label" && tok.prefix === "")) {
      closeSuggestions();
      return;
    }
    try {
      const list = await api.autocomplete(tok.operator === "label" ? "label" : "address", tok.prefix);
      if (seq !== suggestSeq) return;
      suggestions = list;
      token = tok;
      active = 0;
    } catch {
      if (seq === suggestSeq) closeSuggestions();
    }
  }

  function closeSuggestions() {
    suggestSeq++;
    suggestions = [];
    token = null;
  }

  async function accept(value: string) {
    if (!token) return;
    const r = applySuggestion(store.query, token, value);
    closeSuggestions();
    store.query = r.query;
    await tick();
    input.setSelectionRange(r.caret, r.caret);
    input.focus();
  }

  function onkeydown(e: KeyboardEvent) {
    if (suggestions.length === 0) return;
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      void accept(suggestions[active]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % suggestions.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSuggestions();
    }
  }

  const chips = $derived(store.results?.chips ?? []);
  const hints = $derived(store.results?.hints ?? []);
  const stale = $derived(store.resultsQuery !== store.query);

  function removeChip(chip: api.Chip) {
    store.query = removeSpan(store.resultsQuery, chip.start, chip.end);
    input.focus();
  }
  function addOperator(op: string) {
    store.query = insertOperator(store.query, op);
    input.focus();
  }
</script>

<section class="search" id="search-area">
  <div class="box">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      bind:this={input}
      bind:value={store.query}
      type="search"
      role="combobox"
      aria-expanded={suggestions.length > 0}
      aria-controls="suggestions"
      aria-label="Search mail"
      autofocus
      autocomplete="off"
      spellcheck="false"
      placeholder="Search mail — try from:, after:, has:attachment, label:"
      oninput={updateSuggestions}
      onclick={updateSuggestions}
      onkeyup={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") void updateSuggestions();
      }}
      onblur={closeSuggestions}
      {onkeydown}
    />
    {#if suggestions.length > 0}
      <ul class="suggestions" id="suggestions" role="listbox">
        {#each suggestions as s, i (s)}
          <li
            role="option"
            aria-selected={i === active}
            class:active={i === active}
            onmousedown={(e) => {
              e.preventDefault();
              void accept(s);
            }}>{s}</li>
        {/each}
      </ul>
    {/if}
  </div>

  <ChipRow {chips} {hints} {stale} onremove={removeChip} oninsert={addOperator} />

  {#if store.busy}
    <p class="status" role="status">Import in progress — search will resume when it finishes.</p>
  {:else if store.error}
    <p class="status" role="status">{store.error}</p>
  {/if}
</section>

<style>
  .search {
    padding: 16px 20px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .box {
    position: relative;
    margin-bottom: 10px;
  }
  input {
    box-sizing: border-box;
    width: 100%;
    font: inherit;
    font-size: 20px;
    padding: 12px 16px;
    color: var(--fg);
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    outline: none;
  }
  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-ring);
  }
  .suggestions {
    position: absolute;
    z-index: 20;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    margin: 0;
    padding: 4px 0;
    list-style: none;
    max-height: 280px;
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  .suggestions li {
    padding: 6px 16px;
    cursor: pointer;
  }
  .suggestions li.active {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .status {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
