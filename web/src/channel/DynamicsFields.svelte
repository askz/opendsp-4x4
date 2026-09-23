<script lang="ts">
  // Compressor (outputs) or noise gate (inputs) parameters.
  import { device } from "../state/device.svelte.ts";
  import { COMP_RANGES, GATE_RANGES, type Range } from "../state/params.ts";
  import type { Compressor, Gate } from "../state/model.ts";
  import NumberField from "../ui/NumberField.svelte";
  import { formatDb } from "../ui/format.ts";
  import { RATIO_LABELS } from "../ui/labels.ts";

  let { ch, kind }: { ch: number; kind: "comp" | "gate" } = $props();

  const channel = $derived(device.ch(ch));
  const status = $derived(device.syncOf({ kind, ch }));
  const seal = () => device.seal();

  function setComp(patch: Partial<Compressor>): void {
    device.setComp(ch, { ...channel.comp!, ...patch });
  }
  function setGate(patch: Partial<Gate>): void {
    device.setGate(ch, { ...channel.gate!, ...patch });
  }
  const whole = (v: number) => v.toFixed(0);
  const timeStep = (range: Range) => (range.max >= 2000 ? 10 : 1);
</script>

<div class="fields">
  {#if kind === "comp" && channel.comp}
    {@const comp = channel.comp}
    <NumberField label="Threshold" value={comp.thresholdDb} min={COMP_RANGES.thresholdDb.min} max={COMP_RANGES.thresholdDb.max}
                 step={0.5} format={(v) => formatDb(v)} unit="dB" {status} onend={seal}
                 onchange={(thresholdDb) => setComp({ thresholdDb })} />
    <label class="select">
      <span class="label">Ratio</span>
      <select value={comp.ratioIndex} onchange={(event) => { setComp({ ratioIndex: Number(event.currentTarget.value) }); seal(); }}>
        {#each RATIO_LABELS as label, index (index)}<option value={index}>{label}</option>{/each}
      </select>
    </label>
    <NumberField label="Knee" value={comp.kneeDb} min={COMP_RANGES.kneeDb.min} max={COMP_RANGES.kneeDb.max}
                 step={1} format={whole} unit="dB" {status} onend={seal} width="64px"
                 onchange={(kneeDb) => setComp({ kneeDb })} />
    <NumberField label="Attack" value={comp.attackMs} min={COMP_RANGES.attackMs.min} max={COMP_RANGES.attackMs.max}
                 step={timeStep(COMP_RANGES.attackMs)} format={whole} unit="ms" {status} onend={seal}
                 onchange={(attackMs) => setComp({ attackMs })} />
    <NumberField label="Release" value={comp.releaseMs} min={COMP_RANGES.releaseMs.min} max={COMP_RANGES.releaseMs.max}
                 step={timeStep(COMP_RANGES.releaseMs)} format={whole} unit="ms" {status} onend={seal}
                 onchange={(releaseMs) => setComp({ releaseMs })} />
  {:else if kind === "gate" && channel.gate}
    {@const gate = channel.gate}
    <NumberField label="Threshold" value={gate.thresholdDb} min={GATE_RANGES.thresholdDb.min} max={GATE_RANGES.thresholdDb.max}
                 step={0.5} format={(v) => formatDb(v)} unit="dB" {status} onend={seal}
                 onchange={(thresholdDb) => setGate({ thresholdDb })} />
    <NumberField label="Attack" value={gate.attackMs} min={GATE_RANGES.attackMs.min} max={GATE_RANGES.attackMs.max}
                 step={timeStep(GATE_RANGES.attackMs)} format={whole} unit="ms" {status} onend={seal}
                 onchange={(attackMs) => setGate({ attackMs })} />
    <NumberField label="Hold" value={gate.holdMs} min={GATE_RANGES.holdMs.min} max={GATE_RANGES.holdMs.max}
                 step={timeStep(GATE_RANGES.holdMs)} format={whole} unit="ms" {status} onend={seal}
                 onchange={(holdMs) => setGate({ holdMs })} />
    <NumberField label="Release" value={gate.releaseMs} min={GATE_RANGES.releaseMs.min} max={GATE_RANGES.releaseMs.max}
                 step={timeStep(GATE_RANGES.releaseMs)} format={whole} unit="ms" {status} onend={seal}
                 onchange={(releaseMs) => setGate({ releaseMs })} />
  {/if}
</div>

<style>
  .fields { display: flex; flex-wrap: wrap; gap: 10px 12px; align-items: flex-end; }
  .select { display: inline-flex; flex-direction: column; gap: 2px; }
  .select select { width: 90px; }
</style>
