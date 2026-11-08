<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<div class="overlay">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <h2 id="modal-title">{title}</h2>
    {@render children()}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    z-index: 10;
  }
  .dialog {
    width: min(560px, calc(100vw - 48px));
    padding: 20px 24px;
    background: var(--panel);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 17px;
  }
  .dialog :global(.actions) {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .dialog :global(.warning) {
    margin: 12px 0 0;
    padding: 10px 12px;
    border: 1px solid #c77700;
    border-radius: 6px;
    background: rgba(255, 170, 0, 0.14);
  }
  .dialog :global(.muted) {
    color: var(--muted);
  }
  .dialog :global(.summary) {
    font-size: 15px;
    margin: 0 0 8px;
  }
</style>
