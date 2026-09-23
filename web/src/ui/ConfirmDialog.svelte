<script lang="ts">
  // Modal confirmation for destructive actions (native <dialog>: focus trap + Escape).
  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { open, title, message, confirmLabel, danger = false, onconfirm, oncancel }: Props = $props();
  let dialog: HTMLDialogElement;

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} oncancel={(event) => { event.preventDefault(); oncancel(); }}>
  <h2>{title}</h2>
  <p>{message}</p>
  <div class="buttons">
    <button type="button" onclick={oncancel}>Cancel</button>
    <button type="button" class={danger ? "danger" : "primary"} onclick={onconfirm}>{confirmLabel}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px)); padding: 16px; color: var(--text);
    background: var(--surface-2); border: 1px solid var(--line-strong); border-radius: var(--radius);
  }
  dialog::backdrop { background: rgb(0 0 0 / .55); }
  h2 { margin: 0 0 8px; font-size: 14px; }
  p { margin: 0 0 16px; color: var(--text-dim); }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; }
</style>
