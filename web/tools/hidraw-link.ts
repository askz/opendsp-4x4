// Linux hidraw implementation of HidLink, for driving the real device from Node
// (hardware smoke tests, protocol probing). Not part of the web bundle.
import { open, type FileHandle } from "node:fs/promises";
import type { HidLink } from "../src/transport/link.ts";
import { REPORT_SIZE } from "../src/transport/link.ts";
import { getStatusFrame } from "../src/protocol/control.ts";

const CLOSE_GRACE_MS = 200;

export class HidrawLink implements HidLink {
  readonly productName: string;
  private readonly path: string;
  private readonly reportListeners = new Set<(report: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private handle: FileHandle | null = null;
  private reading: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
    this.productName = `hidraw ${path}`;
  }

  async open(): Promise<void> {
    this.handle = await open(this.path, "r+");
    this.reading = this.readLoop(this.handle);
  }

  /** A pending hidraw read blocks a libuv worker until a report arrives, so solicit
   *  one last reply to unblock it before closing the file. */
  async close(): Promise<void> {
    const handle = this.handle;
    if (!handle) return;
    this.handle = null;
    await HidrawLink.writeTo(handle, getStatusFrame()).catch(() => undefined);
    await Promise.race([this.reading, new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS))]);
    await handle.close().catch(() => undefined);
  }

  async write(report: Uint8Array): Promise<void> {
    if (!this.handle) throw new Error("hidraw link is closed");
    await HidrawLink.writeTo(this.handle, report);
  }

  private static async writeTo(handle: FileHandle, report: Uint8Array): Promise<void> {
    const withReportId = new Uint8Array(REPORT_SIZE + 1);
    withReportId.set(report.subarray(0, REPORT_SIZE), 1);
    await handle.write(withReportId, 0, withReportId.length, null);
  }

  onReport(listener: (report: Uint8Array) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private async readLoop(handle: FileHandle): Promise<void> {
    const buffer = new Uint8Array(REPORT_SIZE);
    try {
      while (this.handle === handle) {
        const { bytesRead } = await handle.read(buffer, 0, REPORT_SIZE, null);
        if (bytesRead > 0 && this.handle === handle) {
          const report = buffer.slice(0, bytesRead);
          for (const listener of this.reportListeners) listener(report);
        }
      }
    } catch {
      if (this.handle === handle) for (const listener of this.disconnectListeners) listener();
    }
  }
}
