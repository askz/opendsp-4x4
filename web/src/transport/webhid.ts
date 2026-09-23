// WebHID link for desktop Chrome/Edge. The device is a no-report-ID HID with
// 64-byte interrupt in/out, so reports go out via sendReport(0, …) and come back
// through the `inputreport` event. (WebHID is desktop-only; Android uses native.ts.)
import type { HidLink } from "./link.ts";

export const VENDOR_ID = 0x0168;
export const PRODUCT_ID = 0x0821;
const REPORT_ID = 0;

const isDsp = (device: HIDDevice) => device.vendorId === VENDOR_ID && device.productId === PRODUCT_ID;

export class WebHidLink implements HidLink {
  private readonly device: HIDDevice;
  private readonly reportListeners = new Set<(report: Uint8Array) => void>();
  private readonly disconnectListeners = new Set<() => void>();

  static supported(): boolean {
    return typeof navigator !== "undefined" && "hid" in navigator;
  }

  /** Prompt the user to pick the DSP. Must be called from a user gesture. */
  static async request(): Promise<WebHidLink | null> {
    if (!WebHidLink.supported()) throw new Error("WebHID is unavailable: use Chrome or Edge on desktop.");
    const [device] = await navigator.hid.requestDevice({ filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }] });
    return device ? new WebHidLink(device) : null;
  }

  /** An already-granted DSP, without prompting. */
  static async existing(): Promise<WebHidLink | null> {
    if (!WebHidLink.supported()) return null;
    const device = (await navigator.hid.getDevices()).find(isDsp);
    return device ? new WebHidLink(device) : null;
  }

  /** Notify when an already-granted DSP is plugged in. Returns an unsubscribe function. */
  static onAttach(listener: (link: WebHidLink) => void): () => void {
    if (!WebHidLink.supported()) return () => {};
    const handler = (event: HIDConnectionEvent) => {
      if (isDsp(event.device)) listener(new WebHidLink(event.device));
    };
    navigator.hid.addEventListener("connect", handler);
    return () => navigator.hid.removeEventListener("connect", handler);
  }

  private constructor(device: HIDDevice) {
    this.device = device;
  }

  get productName(): string {
    return this.device.productName || "DSP 4x4 Mini Pro";
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener("inputreport", this.handleReport);
    navigator.hid.addEventListener("disconnect", this.handleDisconnect);
  }

  async close(): Promise<void> {
    this.device.removeEventListener("inputreport", this.handleReport);
    navigator.hid.removeEventListener("disconnect", this.handleDisconnect);
    if (this.device.opened) await this.device.close().catch(() => undefined);
  }

  async write(report: Uint8Array): Promise<void> {
    await this.device.sendReport(REPORT_ID, report as BufferSource);
  }

  onReport(listener: (report: Uint8Array) => void): () => void {
    this.reportListeners.add(listener);
    return () => this.reportListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private readonly handleReport = (event: HIDInputReportEvent): void => {
    const view = event.data;
    const report = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    for (const listener of this.reportListeners) listener(report);
  };

  private readonly handleDisconnect = (event: HIDConnectionEvent): void => {
    if (event.device !== this.device) return;
    for (const listener of this.disconnectListeners) listener();
  };
}
