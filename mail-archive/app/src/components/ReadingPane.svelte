<script lang="ts">
  import { save } from "@tauri-apps/plugin-dialog";
  import * as api from "../lib/api";
  import { safeFilename } from "../lib/filename";
  import { formatFull, formatSize } from "../lib/format";
  import { loadThread } from "../lib/threads";
  import { store } from "../lib/store.svelte";

  let {
    thread,
    terms,
  }: {
    /** The selected conversation, or null for the empty state. */
    thread: api.ThreadHit | null;
    /** Highlight terms from the search; passed to get_thread so body_url carries them. */
    terms: string[];
  } = $props();

  let root: HTMLElement | undefined = $state();
  let messages: api.MessageView[] = $state([]);
  let loadedFor: api.ThreadId | null = $state(null);
  let failed: string | null = $state(null);
  let threadBusy = $state(false);
  let retry = $state(0);
  /** Per-message override of the default expanded state, by message id. */
  let toggled: Record<number, boolean> = $state({});
  let note: string | null = $state(null);

  export function focus() {
    root?.focus();
  }

  // Load on selection change; a newer selection wins.
  $effect(() => {
    const th = thread;
    const ts = terms;
    void retry;
    toggled = {};
    note = null;
    if (!th) {
      messages = [];
      loadedFor = null;
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    failed = null;
    messages = [];
    loadedFor = null;
    loadThread(th.thrid, ts).then(
      (ms) => {
        if (!live) return;
        threadBusy = false;
        messages = [...ms].sort((a, b) => a.date - b.date || a.id - b.id);
        loadedFor = th.thrid;
      },
      (err) => {
        if (!live) return;
        if (api.isBusy(err)) {
          threadBusy = true;
          // Keep trying every 2 s until it succeeds or the selection changes.
          timer = setTimeout(() => retry++, 2000);
        } else {
          threadBusy = false;
          failed = api.errorText(err);
        }
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });

  /** Bodies come from mailbody://, which answers 503 while an import runs, so they are not
   * shown then; when busy clears the iframes are created again (that is the retry). */
  const busyNow = $derived(store.busy || threadBusy);

  const expandedByDefault = $derived.by(() => {
    const matched = new Set(thread?.matched ?? []);
    // No matched message (e.g. an empty query): open the newest.
    if (!messages.some((m) => matched.has(m.id)) && messages.length) {
      return new Set([messages[messages.length - 1].id]);
    }
    return matched;
  });
  const isOpen = (id: number) => toggled[id] ?? expandedByDefault.has(id);
  const toggle = (id: number) => (toggled[id] = !isOpen(id));

  const who = (a: api.Address | null) =>
    a === null ? "(unknown sender)" : a.name ? `${a.name} <${a.addr}>` : a.addr;
  const whoList = (l: api.Address[]) => l.map(who).join(", ");
  const shortWho = (a: api.Address | null) => (a === null ? "(unknown sender)" : a.name || a.addr);

  async function open(m: api.MessageView, a: api.AttachmentInfo) {
    note = null;
    try {
      await api.openAttachment(m.id, a.part_index);
    } catch (e) {
      note = api.errorText(e);
    }
  }

  async function saveAs(m: api.MessageView, a: api.AttachmentInfo) {
    note = null;
    try {
      const dest = await save({ defaultPath: safeFilename(a.filename) });
      if (!dest) return;
      await api.saveAttachment(m.id, a.part_index, dest);
    } catch (e) {
      note = api.errorText(e);
    }
  }
</script>

<article class="pane" bind:this={root} tabindex="-1" aria-label="Conversation">
  {#if !thread}
    <p class="empty">Select a conversation to read it.</p>
  {:else}
    <h2 class="subject">{thread.subject || "(no subject)"}</h2>
    {#if failed}
      <p class="status" role="alert">{failed}</p>
    {:else if threadBusy}
      <p class="status" role="status">Body unavailable while the library is busy</p>
    {/if}
    {#if note}<p class="status" role="alert">{note}</p>{/if}
    {#if loadedFor !== thread.thrid && !failed && !threadBusy}
      <p class="status" role="status">Loading…</p>
    {/if}
    {#each loadedFor === thread.thrid ? messages : [] as m (m.id)}
      <section class="msg" class:open={isOpen(m.id)}>
        <button
          class="head"
          type="button"
          aria-expanded={isOpen(m.id)}
          onclick={() => toggle(m.id)}
        >
          <span class="from">{shortWho(m.from)}</span>
          <span class="when">{formatFull(m.date)}</span>
        </button>
        {#if isOpen(m.id)}
          <dl class="meta">
            <dt>From</dt><dd>{who(m.from)}</dd>
            {#if m.to.length}<dt>To</dt><dd>{whoList(m.to)}</dd>{/if}
            {#if m.cc.length}<dt>Cc</dt><dd>{whoList(m.cc)}</dd>{/if}
          </dl>
          {#if m.labels.length}
            <div class="labels">{#each m.labels as l}<span class="tag">{l}</span>{/each}</div>
          {/if}
          {#if m.attachments.length}
            <div class="atts">
              {#each m.attachments as a (a.part_index)}
                <span class="att">
                  <button
                    class="chip"
                    type="button"
                    title="Open"
                    onclick={() => open(m, a)}
                    oncontextmenu={(e) => {
                      e.preventDefault();
                      void saveAs(m, a);
                    }}
                  >
                    📎 {safeFilename(a.filename)} <small>{formatSize(a.size)}</small>
                  </button>
                  <button class="save" type="button" aria-label="Save As" title="Save As…" onclick={() => saveAs(m, a)}>↓</button>
                </span>
              {/each}
            </div>
          {/if}
          {#if m.blocked_remote > 0}
            <p class="blocked">{m.blocked_remote} remote images blocked</p>
          {/if}
          {#if m.body_failed}
            <p class="status" role="status">This message could not be displayed</p>
          {:else if busyNow}
            <p class="status" role="status">Body unavailable while the library is busy</p>
          {:else}
            <!-- Sandbox: popups only. No scripts, no same-origin, no forms, no top navigation.
                 Fixed viewport-relative height, the body scrolls inside (see report). -->
            <iframe class="body" title="Message body" sandbox="allow-popups" src={m.body_url}></iframe>
          {/if}
        {/if}
      </section>
    {/each}
  {/if}
</article>

<style>
  .pane {
    padding: 12px 16px 24px;
    outline: none;
  }
  .subject {
    margin: 0 0 8px;
    font-size: 18px;
  }
  .empty,
  .status,
  .blocked {
    color: var(--muted);
    font-size: 12px;
    margin: 6px 0;
  }
  .msg {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 8px 0;
    overflow: hidden;
  }
  .head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    border: 0;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .from {
    font-weight: 600;
  }
  .when {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 8px 12px 0;
    font-size: 12px;
  }
  .meta dt {
    color: var(--muted);
  }
  .meta dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .labels,
  .atts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 12px 0;
  }
  .tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--chip-bg);
    color: var(--chip-fg);
  }
  .att {
    display: inline-flex;
  }
  .chip,
  .save {
    border: 1px solid var(--border);
    background: var(--input-bg);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .chip {
    border-radius: 12px 0 0 12px;
  }
  .save {
    border-left: 0;
    border-radius: 0 12px 12px 0;
  }
  .blocked {
    margin: 8px 12px 0;
  }
  .body {
    display: block;
    width: 100%;
    height: clamp(240px, 60vh, 800px);
    border: 0;
    margin-top: 8px;
    background: #fff;
    color-scheme: light;
  }
</style>
