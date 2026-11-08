<script lang="ts">
  import { autocomplete, type Chip, type Hint } from "../lib/api";

  interface Props {
    chips: Chip[];
    hints: Hint[];
    /** True while the chips describe an older query text; ✕ is disabled then. */
    stale?: boolean;
    onremove: (chip: Chip) => void;
    /** Receives an `operator:value` string, e.g. `after:2020-01-01`. */
    oninsert: (op: string) => void;
  }
  let { chips, hints, stale = false, onremove, oninsert }: Props = $props();

  let labelMenuOpen = $state(false);
  let labels = $state<string[]>([]);

  async function toggleLabels() {
    labelMenuOpen = !labelMenuOpen;
    if (!labelMenuOpen) return;
    try {
      labels = await autocomplete("label", "");
    } catch {
      labels = [];
    }
  }

  function pickLabel(name: string) {
    labelMenuOpen = false;
    oninsert(`label:${name}`);
  }

  function pickDate(op: "after" | "before", el: HTMLInputElement) {
    if (!el.value) return;
    oninsert(`${op}:${el.value}`);
    el.value = "";
  }
</script>

<div class="chip-row" data-testid="chip-row">
  <ul class="chips" aria-label="Active filters">
    {#each chips as chip (chip.start + ":" + chip.end)}
      <li class="chip">
        <span>{chip.label}</span>
        <button
          type="button"
          class="x"
          aria-label={`Remove ${chip.label}`}
          disabled={stale}
          onclick={() => onremove(chip)}>✕</button>
      </li>
    {/each}
  </ul>

  <div class="adders">
    <div class="menu-wrap">
      <button type="button" class="add" aria-expanded={labelMenuOpen} onclick={toggleLabels}>+ label</button>
      {#if labelMenuOpen}
        <ul class="menu" role="menu">
          {#each labels as name (name)}
            <li role="none">
              <button type="button" role="menuitem" onclick={() => pickLabel(name)}>{name}</button>
            </li>
          {:else}
            <li class="empty">No labels</li>
          {/each}
        </ul>
      {/if}
    </div>
    <span class="add date">
      + date
      <label>after <input type="date" aria-label="After date" onchange={(e) => pickDate("after", e.currentTarget)} /></label>
      <label>before <input type="date" aria-label="Before date" onchange={(e) => pickDate("before", e.currentTarget)} /></label>
    </span>
  </div>
</div>

{#if hints.length > 0}
  <p class="hints" data-testid="hints">{hints.map((h) => h.message).join(" · ")}</p>
{/if}

<style>
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 10px;
    border-radius: 999px;
    background: var(--chip-bg);
    color: var(--chip-fg);
    font-size: 13px;
  }
  .x {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    line-height: 1;
    font-size: 11px;
  }
  .x:hover:not(:disabled) {
    background: var(--chip-hover);
  }
  .x:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .adders {
    display: flex;
    gap: 8px;
    margin-left: auto;
    align-items: center;
    color: var(--muted);
    font-size: 13px;
  }
  .add {
    border: 1px dashed var(--border);
    background: transparent;
    color: var(--muted);
    border-radius: 999px;
    padding: 2px 10px;
    cursor: pointer;
    font: inherit;
  }
  .date {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    cursor: default;
  }
  .date input {
    font: inherit;
    color: inherit;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    z-index: 10;
    right: 0;
    top: 30px;
    min-width: 200px;
    max-height: 260px;
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .menu button {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    color: var(--fg);
    padding: 6px 12px;
    font: inherit;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--chip-bg);
  }
  .empty {
    padding: 6px 12px;
    color: var(--muted);
  }
  .hints {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
