// Reactive device model + controller. The UI mutates the model (instant feedback)
// and each change is sent through the Connection's request channel, where queued
// writes to the same parameter coalesce, so no UI-side debouncing is needed.
// Engineering-unit params are converted to wire values via the Calibration seam.
import { Connection, type ConnectionPhase, type SyncReason } from "./connection.ts";
import { platformLinkProvider } from "../transport/platform.ts";
import { ProtocolError, emptyStats, type ChannelStats } from "../transport/channel.ts";
import type { Dsp, DeviceInfo } from "../dsp.ts";
import { defaultCalibration, type Calibration } from "../eq/calibration.ts";
import { gainRawToDb } from "../protocol/control.ts";
import { thresholdRawToDb, samplesToMs, rawToQ, peqIndexToHz } from "../protocol/blocks.ts";
import type { PresetReadback } from "../protocol/readback.ts";
import { makeChannels, OUT_BASE, DEFAULT_BAND_FREQS, type Channel } from "./model.ts";
import type { ChannelEq } from "../eq/types.ts";

const DEFAULTS_KEY = "opendsp-defaults";
const METER_INTERVAL_MS = 100;
const MAX_ISSUES = 50;

export interface Issue {
  at: number;
  message: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DeviceStore {
  phase = $state<ConnectionPhase>("idle");
  connectionError = $state("");
  info = $state<DeviceInfo | null>(null);
  productName = $state("");
  stats = $state<ChannelStats>(emptyStats());
  /** Label of the long-running device operation in progress (recall/store), or "". */
  busy = $state("");
  issues = $state<Issue[]>([]);

  presetName = $state("");
  presetNames = $state<string[]>([]);
  activePreset = $state(-1);
  hasDefaults = $state(typeof localStorage !== "undefined" && localStorage.getItem(DEFAULTS_KEY) !== null);
  channels = $state<Channel[]>(makeChannels());
  routing = $state<number[]>([0x01, 0x02, 0x04, 0x08]); // Out1..4 input masks (default diagonal)
  selected = $state(-1); // selected channel index; -1 = nothing open (collapsed overview on load)
  eqLink = $state<Record<number, number>>({}); // output index -> linked partner (symmetric); EQ edits mirror

  readonly connection: Connection;
  private readonly cal: Calibration = defaultCalibration;
  private meterRun = 0;

  constructor() {
    this.connection = new Connection(platformLinkProvider(), {
      sync: (dsp, reason) => this.hydrate(dsp, reason),
      started: (dsp) => this.startMeters(dsp),
      ended: () => this.stopMeters(),
    });
    this.connection.onChange((snapshot) => {
      this.phase = snapshot.phase;
      this.connectionError = snapshot.error;
      this.info = snapshot.info;
      this.productName = snapshot.productName;
      this.stats = snapshot.stats;
    });
    this.phase = this.connection.snapshot.phase;
  }

  get connected(): boolean { return this.phase === "ready"; }
  get supported(): boolean { return this.phase !== "unsupported"; }
  get lastIssue(): Issue | undefined { return this.issues[this.issues.length - 1]; }
  get selectedChannel(): Channel | undefined { return this.channels[this.selected]; }
  ch(index: number): Channel { return this.channels[index]!; }
  /** Collapse the open node → all-collapsed patch-board overview. */
  collapse(): void { this.selected = -1; }

  connect(): Promise<void> { return this.connection.connect(); }
  autoConnect(): Promise<void> { return this.connection.autoConnect(); }
  disconnect(): Promise<void> { return this.connection.disconnect(); }
  clearIssues(): void { this.issues = []; }

  // --- readback ---

  private async hydrate(dsp: Dsp, reason: SyncReason): Promise<void> {
    const image = await dsp.presetImage();
    const activePreset = await dsp.activePreset();
    const presetNames = reason === "connect" ? await dsp.presetNames() : this.presetNames;
    this.applyImage(image);
    this.activePreset = activePreset;
    this.presetNames = presetNames;
  }

  /** Mirror a decoded preset image into the model. Mute and PEQ bypass have no readback. */
  private applyImage(image: PresetReadback): void {
    this.presetName = image.presetName;
    image.inputs.forEach((record, i) => {
      const ch = this.ch(i);
      if (record.name) ch.name = record.name;
      ch.gainDb = gainRawToDb(record.gainRaw);
      ch.polarity = record.polarity;
      ch.gate = {
        attackMs: record.gate.atkRaw, releaseMs: record.gate.relRaw, holdMs: record.gate.holdRaw,
        thresholdDb: thresholdRawToDb(record.gate.thrRaw),
      };
    });
    image.outputs.forEach((record, i) => {
      const ch = this.ch(OUT_BASE + i);
      if (record.name) ch.name = record.name;
      ch.gainDb = gainRawToDb(record.gainRaw);
      ch.polarity = record.polarity;
      ch.delayMs = samplesToMs(record.delaySamples);
      this.routing[i] = record.routingMask;
      ch.comp = {
        ratioIndex: record.comp.ratioIndex, kneeDb: record.comp.kneeRaw,
        attackMs: record.comp.atkRaw, releaseMs: record.comp.relRaw, thresholdDb: thresholdRawToDb(record.comp.thrRaw),
      };
      if (ch.eq) {
        ch.eq.hpf = { freqHz: this.cal.xoverRawToHz(record.hpfRaw), slope: record.hpfSlope };
        ch.eq.lpf = { freqHz: this.cal.xoverRawToHz(record.lpfRaw), slope: record.lpfSlope };
        ch.eq.bands = record.bands.map((band) => {
          const freqHz = peqIndexToHz(band.freqIdx);
          return {
            freqHz, type: band.type, bypass: false,
            gainDb: this.cal.peqGainRawToDb(band.gainRaw, band.type),
            bwOct: this.cal.qToBwOct(rawToQ(band.qRaw), freqHz),
          };
        });
      }
    });
  }

  // --- meters ---

  private startMeters(dsp: Dsp): void {
    const run = ++this.meterRun;
    void this.meterLoop(dsp, run);
  }

  private stopMeters(): void {
    this.meterRun++;
    for (const ch of this.channels) ch.meter = 0;
  }

  /** Poll the 8 I/O levels at ~10 Hz on the background lane (user writes always go first). */
  private async meterLoop(dsp: Dsp, run: number): Promise<void> {
    while (run === this.meterRun) {
      const started = performance.now();
      try {
        const levels = await dsp.levels();
        if (levels && run === this.meterRun) levels.forEach((level, i) => { this.ch(i).meter = level; });
      } catch {
        // failures are counted by the Connection's transaction monitor
      }
      await sleep(Math.max(0, METER_INTERVAL_MS - (performance.now() - started)));
    }
  }

  // --- issue log ---

  private report(label: string, error: unknown): void {
    if (error instanceof ProtocolError && error.kind === "closed") return; // the Connection reports the loss
    const issue = { at: Date.now(), message: `${label}: ${messageOf(error)}` };
    this.issues = [...this.issues.slice(-(MAX_ISSUES - 1)), issue];
  }

  /** Fire-and-forget a device write; failures land in the issue log. */
  private send(label: string, op: (dsp: Dsp) => Promise<unknown>): void {
    const dsp = this.connection.dsp;
    if (!dsp) return;
    op(dsp).catch((error: unknown) => this.report(label, error));
  }

  private async runBusy(label: string, op: (dsp: Dsp) => Promise<void>): Promise<void> {
    const dsp = this.connection.dsp;
    if (!dsp || this.busy) return;
    this.busy = label;
    try {
      await op(dsp);
    } catch (error) {
      this.report(label, error);
    } finally {
      this.busy = "";
    }
  }

  // --- channel basics ---
  setGainDb(i: number, db: number): void { this.ch(i).gainDb = db; this.send(`${this.ch(i).name} gain`, (d) => d.setLevelDb(i, db)); }
  setMute(i: number, on: boolean): void { this.ch(i).mute = on; this.send(`${this.ch(i).name} mute`, (d) => d.mute(i, on)); }
  setPolarity(i: number, inv: boolean): void { this.ch(i).polarity = inv; this.send(`${this.ch(i).name} polarity`, (d) => d.setPolarity(i, inv)); }

  // --- EQ (commit reads the already-mutated band; UI mutates eq directly for instant draw) ---
  commitPeqBand(i: number, band: number): void {
    this.sendPeqBand(i, band);
    const p = this.eqLink[i];
    if (p !== undefined && this.ch(p).eq) {
      Object.assign(this.ch(p).eq!.bands[band]!, $state.snapshot(this.ch(i).eq!.bands[band]!));
      this.sendPeqBand(p, band);
    }
  }
  private sendPeqBand(i: number, band: number): void {
    const b = this.ch(i).eq!.bands[band]!;
    const params = {
      freqHz: b.freqHz, q: this.cal.bwOctToQ(b.bwOct, b.freqHz),
      gainRaw: this.cal.peqGainDbToRaw(b.gainDb, b.type), type: b.type, bypass: b.bypass,
    };
    this.send(`${this.ch(i).name} PEQ band ${band + 1}`, (d) => d.peqBand(i, band, params));
  }
  commitHpf(i: number): void { this.sendHpf(i); const p = this.eqLink[i]; if (p !== undefined && this.ch(p).eq) { this.ch(p).eq!.hpf = { ...$state.snapshot(this.ch(i).eq!.hpf) }; this.sendHpf(p); } }
  commitLpf(i: number): void { this.sendLpf(i); const p = this.eqLink[i]; if (p !== undefined && this.ch(p).eq) { this.ch(p).eq!.lpf = { ...$state.snapshot(this.ch(i).eq!.lpf) }; this.sendLpf(p); } }
  private sendHpf(i: number): void {
    const { freqHz, slope } = this.ch(i).eq!.hpf;
    const raw = this.cal.xoverHzToRaw(freqHz);
    this.send(`${this.ch(i).name} high-pass`, (d) => d.crossoverHpf(i, raw, slope));
  }
  private sendLpf(i: number): void {
    const { freqHz, slope } = this.ch(i).eq!.lpf;
    const raw = this.cal.xoverHzToRaw(freqHz);
    this.send(`${this.ch(i).name} low-pass`, (d) => d.crossoverLpf(i, raw, slope));
  }

  /** Reset one PEQ band to its default (centre freq, 0 dB, 1 oct, peak). */
  resetBand(i: number, band: number): void {
    const b = this.ch(i).eq!.bands[band]!;
    b.freqHz = DEFAULT_BAND_FREQS[band] ?? 1000; b.gainDb = 0; b.bwOct = 1; b.type = 0; b.bypass = false;
    this.commitPeqBand(i, band);
  }
  /** Copy a whole channel's EQ (7 bands + crossover) to another output and push it. */
  copyEqTo(src: number, dst: number): void {
    const s = this.ch(src).eq; if (!s || !this.ch(dst).eq) return;
    this.ch(dst).eq = structuredClone($state.snapshot(s)) as ChannelEq;
    this.pushEq(dst);
  }
  private pushEq(i: number): void {
    const eq = this.ch(i).eq; if (!eq) return;
    for (let b = 0; b < eq.bands.length; b++) this.sendPeqBand(i, b);
    this.sendHpf(i); this.sendLpf(i);
  }
  /** Link two outputs' EQ so edits to either mirror to the other (and sync b←a now). */
  linkEq(a: number, b: number): void {
    this.eqLink = { ...this.eqLink, [a]: b, [b]: a };
    this.copyEqTo(a, b);
  }
  unlinkEq(a: number): void {
    const b = this.eqLink[a]; const next = { ...this.eqLink };
    delete next[a]; if (b !== undefined) delete next[b];
    this.eqLink = next;
  }

  // --- dynamics / delay / routing ---
  setDelayMs(i: number, ms: number): void { this.ch(i).delayMs = ms; this.send(`${this.ch(i).name} delay`, (d) => d.delayMs(i, ms)); }
  commitComp(i: number): void { const c = { ...this.ch(i).comp! }; this.send(`${this.ch(i).name} compressor`, (d) => d.compressor(i, c)); }
  commitGate(i: number): void { const g = { ...this.ch(i).gate! }; this.send(`${this.ch(i).name} gate`, (d) => d.gate(i, g)); }
  setRouting(outIndex: number, mask: number): void {
    this.routing[outIndex - OUT_BASE] = mask;
    this.send(`${this.ch(outIndex).name} routing`, (d) => d.routing(outIndex, mask));
  }

  // --- presets / global ---

  /** Recall a preset slot, then re-read the device so the UI shows what is actually loaded. */
  recallPreset(slot: number): Promise<void> {
    return this.runBusy(`Recall preset ${slot + 1}`, async (dsp) => {
      await dsp.recallPreset(slot);
      await this.connection.resync();
    });
  }

  /** Store the live state into a preset slot, then refresh that slot's name and the active slot. */
  storePreset(slot: number): Promise<void> {
    return this.runBusy(`Store preset ${slot + 1}`, async (dsp) => {
      await dsp.storePreset(slot);
      const name = await dsp.presetName(slot);
      this.presetNames = this.presetNames.map((existing, i) => (i === slot ? name : existing));
      this.activePreset = await dsp.activePreset();
    });
  }

  testTone(source: number, freqIndex = 0): void { this.send("Test tone", (d) => d.testTone(source, freqIndex)); }
  setPassword(pw: string): void { this.send("Lock password", (d) => d.setPassword(pw)); }

  // --- defaults snapshot (browser localStorage; not a device preset slot) ---
  saveDefaults(): void {
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ channels: this.channels, routing: this.routing }));
      this.hasDefaults = true;
    } catch (error) {
      this.report("Save defaults", error);
    }
  }
  async restoreDefaults(): Promise<void> {
    let snapshot: { channels: Channel[]; routing: number[] };
    try {
      snapshot = JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? "null");
      if (!Array.isArray(snapshot?.channels) || snapshot.channels.length !== 8
        || !Array.isArray(snapshot.routing) || snapshot.routing.length !== 4) throw new Error("saved snapshot is malformed");
    } catch (error) {
      this.report("Restore defaults", error);
      return;
    }
    this.channels = snapshot.channels.map((ch) => ({ ...ch, meter: 0 }));
    this.routing = snapshot.routing;
    await this.pushAll();
  }
  /** Re-send every channel's full state to the device (Restore Defaults). */
  async pushAll(): Promise<void> {
    await this.runBusy("Restore defaults", async (dsp) => {
      for (let i = 0; i < this.channels.length; i++) {
        const ch = this.channels[i]!;
        await dsp.setLevelDb(i, ch.gainDb);
        await dsp.setPolarity(i, ch.polarity);
        await dsp.mute(i, ch.mute);
        if (ch.gate) await dsp.gate(i, ch.gate);
        if (!ch.isOutput) continue;
        if (ch.delayMs != null) await dsp.delayMs(i, ch.delayMs);
        if (ch.comp) await dsp.compressor(i, ch.comp);
        await dsp.routing(i, this.routing[i - OUT_BASE] ?? 0);
        if (!ch.eq) continue;
        await dsp.crossoverHpf(i, this.cal.xoverHzToRaw(ch.eq.hpf.freqHz), ch.eq.hpf.slope);
        await dsp.crossoverLpf(i, this.cal.xoverHzToRaw(ch.eq.lpf.freqHz), ch.eq.lpf.slope);
        for (let band = 0; band < ch.eq.bands.length; band++) {
          const b = ch.eq.bands[band]!;
          await dsp.peqBand(i, band, {
            freqHz: b.freqHz, q: this.cal.bwOctToQ(b.bwOct, b.freqHz),
            gainRaw: this.cal.peqGainDbToRaw(b.gainDb, b.type), type: b.type, bypass: b.bypass,
          });
        }
      }
    });
  }
}

export const device = new DeviceStore();
