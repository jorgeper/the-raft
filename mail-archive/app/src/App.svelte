<script lang="ts">
  import SearchBox from "./components/SearchBox.svelte";
</script>

<div class="app">
  <header class="search-region"><SearchBox /></header>
  <div class="panes">
    <!-- Task 16 mounts ResultsList here (left, ~40%). -->
    <section id="results-region" class="results-region" aria-label="Results"></section>
    <!-- Task 16 mounts ReadingPane here (right, ~60%). -->
    <section id="reading-pane-region" class="reading-region" aria-label="Reading pane"></section>
  </div>
</div>

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
  .results-region {
    flex: 0 0 40%;
    min-width: 0;
    overflow: auto;
    border-right: 1px solid var(--border);
  }
  .reading-region {
    flex: 1 1 60%;
    min-width: 0;
    overflow: auto;
    background: var(--panel);
  }
</style>
