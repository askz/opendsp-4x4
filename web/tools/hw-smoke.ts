// Hardware smoke test: runs the production transport stack (RequestChannel, Dsp,
// Connection) against a real DSP 4x4 Mini Pro through Linux hidraw.
//
//   npm run hw:smoke -- /dev/hidrawN
//
// It changes Out 1 gain during the test and restores it, then re-recalls the
// active preset (discarding unsaved live edits).
import { Connection, type ConnectionPhase } from "../src/state/connection.ts";
import type { LinkProvider } from "../src/transport/platform.ts";
import type { Dsp } from "../src/dsp.ts";
import { gainRawToDb } from "../src/protocol/control.ts";
import { HidrawLink } from "./hidraw-link.ts";

const OUT1 = 0x04;
const RAMP_STEPS = 60;

const devicePath = process.argv[2];
if (!devicePath) {
  console.error("usage: hw-smoke <hidraw device path>");
  process.exit(2);
}

const failures: string[] = [];
function check(condition: boolean, label: string): void {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures.push(label);
}

const since = (started: number) => `${(performance.now() - started).toFixed(0)} ms`;

async function out1GainDb(dsp: Dsp): Promise<number> {
  return gainRawToDb((await dsp.presetImage()).outputs[0]!.gainRaw);
}

async function main(): Promise<void> {
  const provider: LinkProvider = {
    supported: () => true,
    pick: async () => new HidrawLink(devicePath!),
    existing: async () => new HidrawLink(devicePath!),
    onAttach: () => () => {},
  };
  let syncMs = 0;
  const connection = new Connection(provider, {
    sync: async (dsp) => {
      const started = performance.now();
      await dsp.presetImage();
      await dsp.presetNames();
      await dsp.activePreset();
      syncMs = performance.now() - started;
    },
    started: () => {},
    ended: () => {},
  });
  const phases: ConnectionPhase[] = [];
  connection.onChange((snapshot) => {
    if (phases[phases.length - 1] !== snapshot.phase) phases.push(snapshot.phase);
  });

  try {
    await exercise(connection, phases, () => syncMs);
  } finally {
    await connection.dispose();
  }
}

async function exercise(connection: Connection, phases: ConnectionPhase[], syncMs: () => number): Promise<void> {
  let started = performance.now();
  await connection.connect();
  console.log(`connect: ${phases.join(" → ")} in ${since(started)} (sync ${syncMs().toFixed(0)} ms)`);
  check(connection.snapshot.phase === "ready", `connected (${connection.snapshot.error || connection.snapshot.info?.firmware})`);
  const dsp = connection.dsp;
  if (!dsp) return;

  const originalGain = await out1GainDb(dsp);
  console.log(`Out1 gain before: ${originalGain} dB`);

  // meters on the background lane while a fader-style burst goes on the control lane
  let metering = true;
  let meterPolls = 0;
  const meterLoop = (async () => {
    while (metering) {
      await dsp.levels();
      meterPolls++;
    }
  })();

  started = performance.now();
  const ramp = Array.from({ length: RAMP_STEPS }, (_, i) => -12 + (12 * i) / (RAMP_STEPS - 1));
  await Promise.all(ramp.map((db) => dsp.setLevelDb(OUT1, db)));
  const rampMs = performance.now() - started;
  const afterRamp = await out1GainDb(dsp);
  check(afterRamp === 0, `ramp of ${RAMP_STEPS} coalesced writes lands on the last value (${afterRamp} dB) in ${rampMs.toFixed(0)} ms`);

  await dsp.setLevelDb(OUT1, -6.5);
  check((await out1GainDb(dsp)) === -6.5, "single write reads back exactly (-6.5 dB)");
  await dsp.setLevelDb(OUT1, originalGain);
  check((await out1GainDb(dsp)) === originalGain, `gain restored to ${originalGain} dB`);

  metering = false;
  await meterLoop;
  check(meterPolls > 0, `meters kept polling during writes (${meterPolls} polls)`);

  const slot = await dsp.activePreset();
  const retriesBefore = connection.snapshot.stats.retries;
  started = performance.now();
  await dsp.recallPreset(slot);
  const recallMs = performance.now() - started;
  check(connection.snapshot.stats.retries === retriesBefore, `recall preset ${slot + 1} acked in ${recallMs.toFixed(0)} ms without a re-send`);
  started = performance.now();
  await connection.resync();
  check(connection.snapshot.phase === "ready", `resync after recall in ${since(started)}`);

  const { stats } = connection.snapshot;
  console.log("stats:", JSON.stringify(stats));
  check(stats.failures === 0, "no failed transactions");
  check(stats.retries === 0, "no retries");
  check(stats.strayReports === 0 && stats.badReports === 0, "no stray or corrupt reports");
  check(stats.coalesced > 0, `writes coalesced (${stats.coalesced})`);
}

main()
  .catch((error: unknown) => {
    failures.push(String(error));
    console.error(error);
  })
  .finally(() => {
    console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
    process.exit(failures.length ? 1 : 0);
  });
