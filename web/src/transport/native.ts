// Native USB link for the Android WebView shell. The Kotlin side exposes a byte
// pipe as window.AndroidUsb and pushes events back through two global callbacks:
// __dsp_onReport(base64) for every inbound report and __dsp_onState(connected)
// whenever the device opens, fails to open, or goes away.
import type { HidLink } from "./link.ts";

interface AndroidUsbBridge {
  /** Find the device, asking for permission if needed; the outcome arrives via __dsp_onState. */
  open(): void;
  /** Write one report (base64). Returns false if the USB transfer failed. */
  write(b64: string): boolean;
  close(): void;
  isConnected(): boolean;
}

type Host = {
  AndroidUsb?: AndroidUsbBridge;
  __dsp_onReport?: (b64: string) => void;
  __dsp_onState?: (connected: boolean) => void;
};
const host = (): Host => globalThis as unknown as Host;

const OPEN_TIMEOUT_MS = 30000;

const reportListeners = new Set<(report: Uint8Array) => void>();
const stateListeners = new Set<(connected: boolean) => void>();

function installHostCallbacks(): void {
  host().__dsp_onReport = (b64) => {
    const report = fromB64(b64);
    for (const listener of reportListeners) listener(report);
  };
  host().__dsp_onState = (connected) => {
    for (const listener of [...stateListeners]) listener(connected);
  };
}

function requireBridge(): AndroidUsbBridge {
  const bridge = host().AndroidUsb;
  if (!bridge) throw new Error("Android USB bridge unavailable");
  return bridge;
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class NativeLink implements HidLink {
  readonly productName = "DSP 4x4 Mini Pro";
  private readonly disconnectListeners = new Set<() => void>();
  private readonly ownReportListeners = new Set<(report: Uint8Array) => void>();
  private unsubscribeState: (() => void) | null = null;

  /** True when running inside the Android shell. */
  static supported(): boolean {
    return typeof host().AndroidUsb !== "undefined";
  }

  /** True when the device is already open (the USB attach intent pre-grants permission). */
  static connected(): boolean {
    return host().AndroidUsb?.isConnected() ?? false;
  }

  /** Notify when the shell opens the device on its own (USB attach intent). */
  static onAttach(listener: (link: NativeLink) => void): () => void {
    if (!NativeLink.supported()) return () => {};
    installHostCallbacks();
    const handler = (connected: boolean) => {
      if (connected) listener(new NativeLink());
    };
    stateListeners.add(handler);
    return () => stateListeners.delete(handler);
  }

  async open(): Promise<void> {
    const bridge = requireBridge();
    installHostCallbacks();
    if (!bridge.isConnected()) await this.awaitOpen(bridge);
    const onState = (connected: boolean) => {
      if (connected) return;
      for (const listener of this.disconnectListeners) listener();
    };
    stateListeners.add(onState);
    this.unsubscribeState = () => stateListeners.delete(onState);
  }

  async close(): Promise<void> {
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    for (const listener of this.ownReportListeners) reportListeners.delete(listener);
    this.ownReportListeners.clear();
    host().AndroidUsb?.close();
  }

  async write(report: Uint8Array): Promise<void> {
    if (requireBridge().write(toB64(report)) === false) throw new Error("USB transfer failed");
  }

  onReport(listener: (report: Uint8Array) => void): () => void {
    this.ownReportListeners.add(listener);
    reportListeners.add(listener);
    return () => {
      this.ownReportListeners.delete(listener);
      reportListeners.delete(listener);
    };
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private awaitOpen(bridge: AndroidUsbBridge): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stateListeners.delete(onState);
        reject(new Error("USB permission/connect timeout"));
      }, OPEN_TIMEOUT_MS);
      const onState = (connected: boolean) => {
        stateListeners.delete(onState);
        clearTimeout(timer);
        if (connected) resolve();
        else reject(new Error("DSP not found or USB permission denied"));
      };
      stateListeners.add(onState);
      bridge.open();
    });
  }
}
