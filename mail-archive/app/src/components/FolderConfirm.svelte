<script lang="ts">
  let { path, onyes, onno }: { path: string; onyes: () => void; onno: () => void } = $props();
</script>

<div class="confirm" role="alertdialog" aria-label="Use this folder?">
  <p>
    This folder is not empty and does not look like a Mail Archive library. Create a library in it anyway?
  </p>
  <p class="path">{path}</p>
  <div class="actions">
    <button onclick={onno}>Cancel</button>
    <button onclick={onyes}>Use this folder</button>
  </div>
</div>

<style>
  .confirm {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid #c77700;
    border-radius: 6px;
    background: rgba(255, 170, 0, 0.14);
  }
  .confirm p {
    margin: 0 0 6px;
  }
  .path {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12px;
    word-break: break-all;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  button {
    font: inherit;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input-bg);
    color: var(--fg);
  }
</style>
