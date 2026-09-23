<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    children: Snippet;
    actions?: Snippet;
    class?: string;
  }

  let { title, children, actions, class: className = "" }: Props = $props();
</script>

<section class="section {className}">
  <header>
    <h2>{title}</h2>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .section { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); min-width: 0; }
  header {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px var(--gap); min-height: 30px; padding: 4px 10px;
    border-bottom: 1px solid var(--line);
  }
  h2 { margin: 0; flex: 1 0 auto; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--text-dim); }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .body { padding: 10px; }
</style>
