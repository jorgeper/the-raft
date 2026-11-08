<script lang="ts">
  import { tick } from "svelte";
  import * as api from "../lib/api";
  import { formatDate, highlightParts, resultsHeader } from "../lib/format";
  import { store } from "../lib/store.svelte";

  /** Fixed row height in px; windowing relies on it. */
  const ROW_HEIGHT = 64;
  const OVERSCAN = 10;
  const PAGE_SIZE = 200;
  const LOAD_AHEAD = 50;

  let {
    selected,
    onselect,
  }: {
    /** Index of the selected thread. */
    selected: number;
    /** Called when a row is clicked. Keyboard selection is handled by the App. */
    onselect: (index: number) => void;
  } = $props();

  let scroller: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let viewHeight = $state(0);
  /** The result set a page request is in flight for (reactive: finishing re-runs the check). */
  let loadingFor: object | null = $state.raw(null);
  /** The result set whose last page load failed; cleared by the next scroll. */
  let failedFor: object | null = null;
  /** The result set for which the last page came back short (nothing more to load). */
  let exhausted: object | null = null;

  const threads = $derived(store.results?.threads ?? []);
  const terms = $derived(store.results?.terms ?? []);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  const lastVisible = $derived(Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT));
  const last = $derived(Math.min(threads.length, lastVisible + OVERSCAN));
  const rows = $derived(threads.slice(first, last).map((t, i) => ({ t, i: first + i })));

  export function focus() {
    scroller?.focus();
  }

  function measure() {
    if (!scroller) return;
    failedFor = null;
    scrollTop = scroller.scrollTop;
    viewHeight = scroller.clientHeight;
  }

  // Track the viewport height (absent in jsdom, where tests set clientHeight and scroll).
  $effect(() => {
    if (!scroller) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    return () => ro.disconnect();
  });

  // A new result set starts at the top, even if the selection was already row 0.
  $effect(() => {
    void store.results;
    if (scroller) scroller.scrollTop = 0;
    scrollTop = 0;
  });

  // Keep the selected row on screen (keyboard selection).
  $effect(() => {
    const idx = selected;
    if (!scroller || idx < 0) return;
    const top = idx * ROW_HEIGHT;
    const h = scroller.clientHeight;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_HEIGHT > scroller.scrollTop + h) scroller.scrollTop = top + ROW_HEIGHT - h;
    void tick().then(measure);
  });

  // Next page when within LOAD_AHEAD rows of the end. Everything is scoped to the result set
  // object, so a page for an old set is dropped and the new set is checked afresh.
  $effect(() => {
    const res = store.results;
    if (!res || loadingFor === res || failedFor === res || exhausted === res) return;
    // A first page shorter than a full page is the whole result set.
    if (res.threads.length < PAGE_SIZE || lastVisible < res.threads.length - LOAD_AHEAD) return;
    loadingFor = res;
    const offset = res.threads.length;
    const query = store.resultsQuery;
    api
      .search(query, offset, PAGE_SIZE)
      .then((page) => {
        // Clear before pushing: the push re-runs this effect, which must see it idle.
        if (loadingFor === res) loadingFor = null;
        if (store.results !== res) return;
        const seen = new Set(res.threads.map((t) => t.thrid));
        if (page.threads.length < PAGE_SIZE) exhausted = res;
        res.threads.push(...page.threads.filter((t) => !seen.has(t.thrid)));
      })
      .catch(() => {
        // Busy or failed: retry on the next scroll, not in a loop.
        if (loadingFor === res) loadingFor = null;
        failedFor = res;
      });
  });

  const sendersOf = (t: api.ThreadHit) =>
    (t.senders.length ? t.senders.join(", ") : "(unknown sender)") +
    (t.message_count > 1 ? ` (${t.message_count})` : "");
</script>

{#snippet hl(text: string)}
  {#each highlightParts(text, terms) as p}{#if p.mark}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
{/snippet}

<div class="list">
  {#if store.results}
    <div class="header" role="status">{resultsHeader(store.results)}</div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="scroller"
    bind:this={scroller}
    onscroll={measure}
    role="listbox"
    aria-label="Conversations"
    tabindex="0"
  >
    <div class="spacer" style:height="{threads.length * ROW_HEIGHT}px">
      {#each rows as { t, i } (t.thrid)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="row"
          class:selected={i === selected}
          role="option"
          tabindex="-1"
          aria-selected={i === selected}
          style:top="{i * ROW_HEIGHT}px"
          style:height="{ROW_HEIGHT}px"
          onclick={() => onselect(i)}
        >
          <div class="line1">
            <span class="senders">{@render hl(sendersOf(t))}</span>
            {#if t.has_attachment}<span class="clip" title="Has attachment" aria-label="Has attachment">📎</span>{/if}
            <span class="date">{formatDate(t.latest_date)}</span>
          </div>
          <div class="subject">{@render hl(t.subject || "(no subject)")}</div>
          <div class="snippet">{@render hl(t.snippet)}</div>
        </div>
      {/each}
    </div>
    {#if store.results && threads.length === 0}
      <p class="empty">No messages match.</p>
    {/if}
  </div>
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .header {
    flex: none;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    position: relative;
    outline: none;
  }
  .scroller:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent-ring);
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    box-sizing: border-box;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    cursor: default;
  }
  .row.selected {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .row.selected .snippet,
  .row.selected .date {
    color: inherit;
    opacity: 0.8;
  }
  .line1 {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .senders {
    flex: 1;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .date {
    flex: none;
    font-size: 12px;
    color: var(--muted);
  }
  .clip {
    flex: none;
    font-size: 11px;
  }
  .subject,
  .snippet {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .snippet {
    font-size: 12px;
    color: var(--muted);
  }
  mark {
    background: rgba(255, 214, 0, 0.55);
    color: inherit;
    border-radius: 2px;
  }
  .empty {
    padding: 16px 12px;
    color: var(--muted);
  }
</style>
