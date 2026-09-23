<script lang="ts">
  import { device } from "./state/device.svelte.ts";
  import PatchBoard from "./components/PatchBoard.svelte";
  import PresetPads from "./components/PresetPads.svelte";
  import TestTonePanel from "./components/TestTonePanel.svelte";
  import LockDialog from "./components/LockDialog.svelte";

  const PHASE_LABEL = {
    unsupported: "Unsupported browser", idle: "Not connected", connecting: "Connecting…",
    syncing: "Reading device…", ready: "Connected", lost: "Connection lost",
  } as const;
  const status = $derived(
    device.busy ? `${device.busy}…`
      : device.connected ? device.info?.firmware || device.info?.version || device.productName
      : device.connectionError || PHASE_LABEL[device.phase],
  );
  const working = $derived(device.phase === "connecting" || device.phase === "syncing");
  let showSystem = $state(false);
</script>

<header class="top">
  <strong>openDSP-4x4</strong><span class="muted"> · t.racks DSP 4x4 Mini Pro</span>
  <span class="spacer"></span>
  {#if device.lastIssue}
    <button class="issue" title={device.issues.map((i) => i.message).join("\n")} onclick={() => device.clearIssues()}>
      {device.issues.length} issue{device.issues.length === 1 ? "" : "s"}: {device.lastIssue.message}
    </button>
  {/if}
  <span class="dot" class:ok={device.connected} class:busy={working}></span>
  <span class="status" class:ok={device.connected} title={status}>{status}</span>
  {#if device.connected}
    <button onclick={() => device.disconnect()}>Disconnect</button>
  {:else}
    <button class="primary" disabled={!device.supported || working} onclick={() => device.connect()}>Connect DSP…</button>
  {/if}
</header>

<PresetPads />

{#if !device.supported}<div class="warn-box">WebHID isn't available — use <b>Chrome</b> or <b>Edge</b> on desktop.</div>{/if}

<PatchBoard />

<!-- Fixed bottom bar: System expander, then the tagline at the very bottom. The
     tagline (not the tappable toggle) sits over the Android nav/gesture area. -->
<div class="bottombar">
  {#if showSystem}<div class="system">
    <TestTonePanel /><div class="vline"></div><LockDialog /><div class="vline"></div>
    <div class="defaults">
      <strong class="hd">Defaults <span class="muted">(this browser)</span></strong>
      <div class="drow">
        <button onclick={() => device.saveDefaults()} disabled={!device.connected}>Save current</button>
        <button class="primary" onclick={() => device.restoreDefaults()} disabled={!device.connected || !device.hasDefaults}>Restore</button>
      </div>
      <span class="muted">{device.hasDefaults ? "snapshot saved — Restore re-sends it to the DSP" : "no snapshot yet — Save the current setup first"}</span>
    </div>
  </div>{/if}
  <button class="systoggle" class:on={showSystem} onclick={() => (showSystem = !showSystem)}>System {showSystem ? "▾" : "▴"}</button>
  <footer class="agpl muted">
    openDSP-4x4 · <a href="https://www.gnu.org/licenses/agpl-3.0.html">AGPL-3.0</a> ·
    <a href="https://github.com/GlassOnTin/opendsp-4x4">source</a> ·
    <a href="https://ko-fi.com/glassontin">Ko-fi ☕</a> · not affiliated with Thomann
  </footer>
</div>

<style>
  .top { display: flex; align-items: center; gap: .55rem; padding: calc(.6rem + var(--safe-top, 0px)) 1rem .6rem; border-bottom: 1px solid var(--line); background: var(--bg-panel); }
  .spacer { flex: 1; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--bad); box-shadow: 0 0 8px var(--bad); }
  .dot.ok { background: var(--good); box-shadow: 0 0 8px var(--good); }
  .dot.busy { background: var(--warn); box-shadow: 0 0 8px var(--warn); }
  .issue { max-width: 36ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .78rem; color: var(--warn); border-color: var(--warn); }
  .status { font-size: .82rem; color: var(--text-dim); max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status.ok { color: var(--good); }
  button.on { border-color: var(--accent); }
  .warn-box { margin: .6rem 1rem; background: #4a2b00; color: #ffd9a0; padding: .55rem .8rem; border-radius: var(--radius); }
  .bottombar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; flex-direction: column; background: var(--bg-panel); border-top: 1px solid var(--line); padding-bottom: var(--safe-bottom, 0px); }
  .systoggle { width: 100%; border: none; border-radius: 0; padding: .55rem; background: var(--bg-panel); color: var(--text-dim); font: inherit; }
  .systoggle.on { color: var(--accent); }
  :global(body) { padding-bottom: calc(4.2rem + var(--safe-bottom, 0px)); } /* clear toggle + tagline */
  .system { display: flex; gap: 1rem; align-items: center; padding: .7rem .9rem; border-bottom: 1px solid var(--line); flex-wrap: wrap; max-height: 55vh; overflow: auto; }
  .vline { width: 1px; align-self: stretch; background: var(--line); }
  .defaults { display: flex; flex-direction: column; gap: .45rem; }
  .defaults .hd { font-size: .82rem; color: var(--text-dim); }
  .drow { display: flex; gap: .4rem; }
  .agpl { padding: .5rem 1rem; border-top: 1px solid var(--line); font-size: .72rem; }
  .agpl a { color: var(--accent); }
</style>
