// High-level DSP client over a RequestChannel. Builds confirmed command frames and
// decodes replies. Parameter writes go on the control lane with a per-parameter
// coalesce key (latest value wins while queued); meter polls go on the background lane.
import type { RequestChannel } from "./transport/channel.ts";
import type { Reply } from "./protocol/frame.ts";
import { PRESET_SLOT_COUNT } from "./protocol/commands.ts";
import {
  muteFrame, levelDbFrame, polarityFrame,
  recallPresetFrame, storePresetFrame, getVersionFrame, getFirmwareVersionFrame, getStatusFrame,
  getActivePresetFrame, getLevelsFrame, readPresetNameFrame, readChannelFrame, finalizeFrame,
  testToneFrame, setPasswordFrame,
} from "./protocol/control.ts";
import {
  peqBandFrame, crossoverHpfFrame, crossoverLpfFrame, delayMsFrame,
  compressorFrame, gateFrame, routingFrame,
} from "./protocol/blocks.ts";
import {
  levelsFromReply, reconstructPresetImage, parsePresetImage, type PresetReadback,
} from "./protocol/readback.ts";

const CHANNEL_PAGE_COUNT = 9;
const CHANNEL_PAGE_SIZE = 50;

const ascii = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\0[\s\S]*$/, "").trim();

export interface DeviceInfo {
  status: number;
  version: string;
  firmware: string;
}

export interface PeqBandParams { freqHz: number; q: number; gainRaw: number; type: number; bypass?: boolean }
export interface CompressorParams { ratioIndex: number; kneeDb: number; attackMs: number; releaseMs: number; thresholdDb: number }
export interface GateParams { attackMs: number; releaseMs: number; holdMs: number; thresholdDb: number }

export class Dsp {
  private readonly channel: RequestChannel;

  constructor(channel: RequestChannel) {
    this.channel = channel;
  }

  // --- queries ---

  /** Status wake-up (the device answers 0x13 only after 0x10), then both version strings. */
  async identify(): Promise<DeviceInfo> {
    const status = (await this.query(getStatusFrame())).data[0] ?? 0;
    const version = ascii((await this.query(getVersionFrame())).data);
    const firmware = ascii((await this.query(getFirmwareVersionFrame())).data);
    return { status, version, firmware };
  }

  async activePreset(): Promise<number> {
    return (await this.query(getActivePresetFrame())).data[0] ?? 0;
  }

  async presetName(slot: number): Promise<string> {
    return ascii((await this.query(readPresetNameFrame(slot))).data.slice(1));
  }

  async presetNames(): Promise<string[]> {
    const names: string[] = [];
    for (let slot = 0; slot < PRESET_SLOT_COUNT; slot++) names.push(await this.presetName(slot));
    return names;
  }

  /** Read the nine channel-state pages and decode the live 450-byte preset image. */
  async presetImage(): Promise<PresetReadback> {
    const pages: Uint8Array[] = [];
    for (let index = 0; index < CHANNEL_PAGE_COUNT; index++) {
      const data = (await this.query(readChannelFrame(index))).data;
      if (data.length < CHANNEL_PAGE_SIZE + 1) throw new Error(`channel page ${index} is truncated (${data.length} bytes)`);
      pages[index] = data.slice(1, CHANNEL_PAGE_SIZE + 1);
    }
    return parsePresetImage(reconstructPresetImage(pages));
  }

  /** Poll the 8 in/out levels (0..1, In A–D then Out 1–4). */
  async levels(): Promise<number[] | null> {
    const reply = await this.channel.request(getLevelsFrame(), { lane: "background", coalesceKey: "levels" });
    return levelsFromReply(reply);
  }

  /** Finish the startup handshake, as the vendor editor does after its readback. */
  finalize(): Promise<Reply> { return this.query(finalizeFrame()); }

  // --- parameter writes ---

  mute(chan: number, on: boolean): Promise<Reply> { return this.write(muteFrame(chan, on), `mute:${chan}`); }
  setPolarity(chan: number, invert: boolean): Promise<Reply> { return this.write(polarityFrame(chan, invert), `polarity:${chan}`); }
  setLevelDb(chan: number, db: number): Promise<Reply> { return this.write(levelDbFrame(chan, db), `level:${chan}`); }
  peqBand(chan: number, band: number, params: PeqBandParams): Promise<Reply> {
    return this.write(peqBandFrame(chan, band, params), `peq:${chan}:${band}`);
  }
  crossoverHpf(chan: number, freqRaw: number, slope: number): Promise<Reply> {
    return this.write(crossoverHpfFrame(chan, freqRaw, slope), `hpf:${chan}`);
  }
  crossoverLpf(chan: number, freqRaw: number, slope: number): Promise<Reply> {
    return this.write(crossoverLpfFrame(chan, freqRaw, slope), `lpf:${chan}`);
  }
  delayMs(chan: number, ms: number): Promise<Reply> { return this.write(delayMsFrame(chan, ms), `delay:${chan}`); }
  compressor(chan: number, params: CompressorParams): Promise<Reply> { return this.write(compressorFrame(chan, params), `comp:${chan}`); }
  gate(chan: number, params: GateParams): Promise<Reply> { return this.write(gateFrame(chan, params), `gate:${chan}`); }
  routing(outChan: number, inputMask: number): Promise<Reply> { return this.write(routingFrame(outChan, inputMask), `routing:${outChan}`); }
  testTone(source: number, freqIndex = 0): Promise<Reply> { return this.write(testToneFrame(source, freqIndex), "tone"); }
  setPassword(pw: string): Promise<Reply> { return this.write(setPasswordFrame(pw)); }

  // --- presets ---

  recallPreset(slot: number): Promise<Reply> { return this.write(recallPresetFrame(checkSlot(slot))); }
  storePreset(slot: number): Promise<Reply> { return this.write(storePresetFrame(checkSlot(slot))); }

  private query(frame: Uint8Array): Promise<Reply> {
    return this.channel.request(frame);
  }

  private write(frame: Uint8Array, coalesceKey?: string): Promise<Reply> {
    return this.channel.request(frame, { coalesceKey });
  }
}

function checkSlot(slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PRESET_SLOT_COUNT) {
    throw new RangeError(`preset slot must be 0..${PRESET_SLOT_COUNT - 1}, got ${slot}`);
  }
  return slot;
}
