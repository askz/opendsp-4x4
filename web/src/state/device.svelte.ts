// Reactive facade for the UI: connection status, the editable device model (through
// the Editor, which handles undo, links and delivery tracking), presets, meters and
// the issue log.
import { Connection, type ConnectionPhase, type SyncReason } from "./connection.ts";
import { Editor, createEditorState, type EditorState, type SyncEntry } from "./editor.ts";
import { modelFromReadback } from "./hydrate.ts";
import { paramKey, describeParam, type ParamRef, type ParamValue } from "./params.ts";
import { parsePresetFile, presetFileName, serializePresetFile, PresetFileError } from "./presetFile.ts";
import { CHANNEL_COUNT, DEFAULT_BAND_FREQS, defaultBand, defaultModel, type Channel, type Compressor, type Gate } from "./model.ts";
import { platformLinkProvider } from "../transport/platform.ts";
import { ProtocolError, emptyStats, type ChannelStats } from "../transport/channel.ts";
import type { Dsp, DeviceInfo } from "../dsp.ts";
import { defaultCalibration } from "../eq/calibration.ts";
import type { Crossover, PeqBand } from "../eq/types.ts";

const METER_INTERVAL_MS = 100;
const MAX_ISSUES = 50;
const MAX_FILE_ISSUES_LOGGED = 5;

export interface Issue {
  at: number;
  message: string;
}

export interface ExportedFile {
  name: string;
  text: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DeviceStore {
  phase = $state<ConnectionPhase>("idle");
  connectionError = $state("");
  info = $state<DeviceInfo | null>(null);
  productName = $state("");
  stats = $state<ChannelStats>(emptyStats());
  /** Label of the long-running operation in progress (recall/store/import), or "". */
  busy = $state("");
  issues = $state<Issue[]>([]);

  presetNames = $state<string[]>([]);
  activePreset = $state(-1);
  edit = $state<EditorState>(createEditorState(defaultModel()));
  meters = $state<number[]>(new Array(CHANNEL_COUNT).fill(0));
  selected = $state(-1); // selected channel index; -1 = nothing open

  readonly connection: Connection;
  readonly editor: Editor;
  private readonly cal = defaultCalibration;
  private meterRun = 0;

  constructor() {
    this.editor = new Editor(this.edit, {
      dsp: () => this.connection.dsp,
      cal: this.cal,
      onError: (label, error) => this.report(label, error),
    });
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

  // --- read access ---

  get connected(): boolean { return this.phase === "ready"; }
  get supported(): boolean { return this.phase !== "unsupported"; }
  get channels(): Channel[] { return this.edit.model.channels; }
  get routing(): number[] { return this.edit.model.routing; }
  get presetName(): string { return this.edit.model.presetName; }
  get eqLink(): Record<number, number> { return this.edit.links; }
  get modified(): boolean { return this.edit.modified; }
  get undoLabel(): string | null { return this.edit.undoLabel; }
  get redoLabel(): string | null { return this.edit.redoLabel; }
  get lastIssue(): Issue | undefined { return this.issues[this.issues.length - 1]; }
  get selectedChannel(): Channel | undefined { return this.channels[this.selected]; }
  /** Parameters the device has not confirmed, by status. */
  get unsynced(): { pending: number; failed: number; offline: number } {
    const counts = { pending: 0, failed: 0, offline: 0 };
    for (const entry of Object.values(this.edit.sync)) counts[entry.status]++;
    return counts;
  }
  ch(index: number): Channel { return this.edit.model.channels[index]!; }
  syncOf(ref: ParamRef): SyncEntry | undefined { return this.edit.sync[paramKey(ref)]; }
  collapse(): void { this.selected = -1; }

  // --- connection ---

  connect(): Promise<void> { return this.connection.connect(); }
  autoConnect(): Promise<void> { return this.connection.autoConnect(); }
  disconnect(): Promise<void> { return this.connection.disconnect(); }
  clearIssues(): void { this.issues = []; }

  // --- edits (all go through the Editor) ---

  setGainDb(ch: number, db: number): void { this.change({ kind: "gain", ch }, db); }
  setMute(ch: number, on: boolean): void { this.change({ kind: "mute", ch }, on); }
  setPolarity(ch: number, invert: boolean): void { this.change({ kind: "polarity", ch }, invert); }
  setDelayMs(ch: number, ms: number): void { this.change({ kind: "delay", ch }, ms); }
  setRouting(outCh: number, mask: number): void { this.change({ kind: "routing", ch: outCh }, mask); }
  setBand(ch: number, band: number, value: PeqBand): void { this.change({ kind: "peq", ch, band }, value); }
  setHpf(ch: number, value: Crossover): void { this.change({ kind: "hpf", ch }, value); }
  setLpf(ch: number, value: Crossover): void { this.change({ kind: "lpf", ch }, value); }
  setComp(ch: number, value: Compressor): void { this.change({ kind: "comp", ch }, value); }
  setGate(ch: number, value: Gate): void { this.change({ kind: "gate", ch }, value); }

  /** Reset one PEQ band to its default (centre freq, 0 dB, 1 oct, peak, active). */
  resetBand(ch: number, band: number): void {
    this.change({ kind: "peq", ch, band }, defaultBand(DEFAULT_BAND_FREQS[band] ?? 1000), false);
  }

  copyEqTo(src: number, dst: number): void { this.guard("Copy EQ", () => this.editor.copyEq(src, dst)); }
  linkEq(a: number, b: number): void { this.guard("Link EQ", () => this.editor.link(a, b)); }
  unlinkEq(ch: number): void { this.editor.unlink(ch); }
  undo(): void { void this.editor.undo(); }
  redo(): void { void this.editor.redo(); }
  /** End a gesture (pointer up) so the next edit is a separate undo step. */
  seal(): void { this.editor.seal(); }
  resendUnsynced(): void { void this.editor.resendUnsynced(); }

  private change(ref: ParamRef, value: ParamValue, merge = true): void {
    this.guard(describeParam(ref, this.edit.model), () => this.editor.set(ref, value, { merge }));
  }

  private guard(label: string, op: () => Promise<boolean>): void {
    try {
      void op();
    } catch (error) {
      this.report(label, error);
    }
  }

  // --- presets ---

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
      this.editor.markStored();
    });
  }

  exportPresetFile(): ExportedFile {
    const savedAt = new Date();
    return { name: presetFileName(this.presetName, savedAt), text: serializePresetFile(this.edit.model, savedAt) };
  }

  /** Validate a preset file and apply it as one undoable edit (only differing values are sent). */
  async importPresetFile(text: string): Promise<void> {
    if (this.busy) return;
    this.busy = "Import preset file";
    try {
      const parsed = parsePresetFile(text);
      const delivered = await this.editor.setMany(`Import ${parsed.presetName || "preset file"}`, parsed.assignments);
      if (!delivered && this.connected) this.report("Import preset file", new Error("some parameters were not confirmed by the device"));
    } catch (error) {
      this.report("Import preset file", error);
      if (error instanceof PresetFileError) {
        for (const issue of error.issues.slice(0, MAX_FILE_ISSUES_LOGGED)) this.report("Import preset file", new Error(issue));
      }
    } finally {
      this.busy = "";
    }
  }

  testTone(source: number, freqIndex = 0): void { this.send("Test tone", (d) => d.testTone(source, freqIndex)); }
  setPassword(pw: string): void { this.send("Lock password", (d) => d.setPassword(pw)); }

  // --- readback ---

  private async hydrate(dsp: Dsp, reason: SyncReason): Promise<void> {
    const image = await dsp.presetImage();
    const activePreset = await dsp.activePreset();
    const presetNames = reason === "connect" ? await dsp.presetNames() : this.presetNames;
    this.editor.load(modelFromReadback(image, this.cal, reason === "resync" ? this.edit.model : undefined));
    this.activePreset = activePreset;
    this.presetNames = presetNames;
  }

  // --- meters ---

  private startMeters(dsp: Dsp): void {
    const run = ++this.meterRun;
    void this.meterLoop(dsp, run);
  }

  private stopMeters(): void {
    this.meterRun++;
    this.meters = new Array(CHANNEL_COUNT).fill(0);
  }

  /** Poll the 8 I/O levels at ~10 Hz on the background lane (user writes always go first). */
  private async meterLoop(dsp: Dsp, run: number): Promise<void> {
    while (run === this.meterRun) {
      const started = performance.now();
      try {
        const levels = await dsp.levels();
        if (levels && run === this.meterRun) this.meters = levels;
      } catch {
        // failures are counted by the Connection's transaction monitor
      }
      await sleep(Math.max(0, METER_INTERVAL_MS - (performance.now() - started)));
    }
  }

  // --- issue log / helpers ---

  private report(label: string, error: unknown): void {
    if (error instanceof ProtocolError && error.kind === "closed") return; // the Connection reports the loss
    const issue = { at: Date.now(), message: `${label}: ${messageOf(error)}` };
    this.issues = [...this.issues.slice(-(MAX_ISSUES - 1)), issue];
  }

  /** Fire-and-forget a non-parameter command; failures land in the issue log. */
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
}

export const device = new DeviceStore();
