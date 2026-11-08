<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  let { title, children }: { title: string; children: Snippet } = $props();

  let dialog: HTMLDivElement;
  const FOCUSABLE =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const focusFirst = () => (focusables()[0] ?? dialog).focus();

  // Take focus on open (so keystrokes never reach the search box behind),
  // keep it inside while open, and give it back on close.
  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusFirst();
    const onfocusin = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) focusFirst();
    };
    document.addEventListener("focusin", onfocusin);
    return () => {
      document.removeEventListener("focusin", onfocusin);
      if (previous?.isConnected) previous.focus();
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const f = focusables();
    const active = document.activeElement;
    if (f.length === 0) {
      e.preventDefault();
      dialog.focus();
    } else if (e.shiftKey && (active === f[0] || !f.includes(active as HTMLElement))) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && (active === f[f.length - 1] || !f.includes(active as HTMLElement))) {
      e.preventDefault();
      f[0].focus();
    }
  }
</script>

<div class="overlay">
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    tabindex="-1"
    bind:this={dialog}
    {onkeydown}
  >
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
    outline: none;
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
