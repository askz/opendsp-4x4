<script lang="ts">
  // Latching button. `pressed: null` means the state is unknown (the device cannot
  // report it); pressing it sets an explicit state.
  import type { Snippet } from "svelte";
  import type { SyncEntry } from "../state/editor.ts";

  interface Props {
    pressed: boolean | null;
    onchange: (pressed: boolean) => void;
    children: Snippet;
    tone?: "accent" | "warn" | "bad";
    title?: string;
    status?: SyncEntry;
    disabled?: boolean;
  }

  let { pressed, onchange, children, tone = "accent", title, status, disabled = false }: Props = $props();
  const hint = $derived(
    pressed === null ? `${title ? `${title}: ` : ""}unknown (the device can't report it). Click to set.`
      : status?.status === "failed" ? `Not applied on the device: ${status.error ?? "write failed"}`
      : title,
  );
</script>

<button
  type="button"
  class="toggle {tone}"
  class:on={pressed === true}
  class:unknown={pressed === null}
  data-status={status?.status}
  aria-pressed={pressed === null ? "mixed" : pressed}
  title={hint}
  {disabled}
  onclick={() => onchange(pressed !== true)}
>{@render children()}{#if pressed === null}<span class="q">?</span>{/if}</button>

<style>
  .toggle { min-width: 34px; padding: 0 8px; font-weight: 600; font-size: 12px; }
  .toggle.on.accent { background: var(--accent-dim); border-color: var(--accent); }
  .toggle.on.warn { background: #5c4516; border-color: var(--warn); color: #ffe3a8; }
  .toggle.on.bad { background: #5e2320; border-color: var(--bad); color: #ffd3d0; }
  .toggle.unknown { border-style: dashed; color: var(--text-dim); }
  .toggle[data-status="failed"] { box-shadow: inset 0 -2px 0 var(--bad); }
  .toggle[data-status="offline"] { box-shadow: inset 0 -2px 0 var(--warn); }
  .q { margin-left: 3px; font-weight: 400; color: var(--text-faint); }
</style>
