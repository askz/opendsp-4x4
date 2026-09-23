import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeLink } from "../src/transport/native.ts";

const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const fromB64 = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

type Host = typeof globalThis & {
  AndroidUsb?: unknown;
  __dsp_onReport?: (b64: string) => void;
  __dsp_onState?: (connected: boolean) => void;
};
const host = globalThis as Host;

interface FakeBridge {
  connected: boolean;
  writes: Uint8Array[];
  writeResult: boolean;
  /** What open() does: grant (true), deny (false), or nothing (null). */
  openOutcome: boolean | null;
}

function installBridge(initial: Partial<FakeBridge> = {}): FakeBridge {
  const bridge: FakeBridge = { connected: false, writes: [], writeResult: true, openOutcome: true, ...initial };
  host.AndroidUsb = {
    open() {
      if (bridge.openOutcome === null) return;
      bridge.connected = bridge.openOutcome;
      host.__dsp_onState?.(bridge.openOutcome);
    },
    close() {
      bridge.connected = false;
      host.__dsp_onState?.(false);
    },
    isConnected: () => bridge.connected,
    write(b64: string) {
      bridge.writes.push(fromB64(b64));
      return bridge.writeResult;
    },
  };
  return bridge;
}

test("open asks the shell for the device and resolves once it is granted", async () => {
  installBridge({ connected: false, openOutcome: true });
  const link = new NativeLink();
  await link.open();
  assert.equal(NativeLink.connected(), true);
  await link.close();
});

test("open rejects when the device is missing or permission is denied", async () => {
  installBridge({ connected: false, openOutcome: false });
  await assert.rejects(new NativeLink().open(), /not found or USB permission denied/);
});

test("reports and written frames survive the base64 round trip", async () => {
  const bridge = installBridge({ connected: true });
  const link = new NativeLink();
  const received: number[][] = [];
  link.onReport((report) => received.push(Array.from(report)));
  await link.open();
  const frame = Uint8Array.from([0x10, 0x02, 0x00, 0x01, 0x01, 0x13, 0x10, 0x03, 0x13]);
  await link.write(frame);
  assert.deepEqual(Array.from(bridge.writes[0]!), Array.from(frame));
  host.__dsp_onReport!(toB64(Uint8Array.from([0x10, 0x02, 0x01, 0xff])));
  assert.deepEqual(received, [[0x10, 0x02, 0x01, 0xff]]);
  await link.close();
});

test("a failed USB transfer rejects the write", async () => {
  installBridge({ connected: true, writeResult: false });
  const link = new NativeLink();
  await link.open();
  await assert.rejects(link.write(new Uint8Array(64)), /USB transfer failed/);
  await link.close();
});

test("the shell reporting the device gone fires onDisconnect", async () => {
  installBridge({ connected: true });
  const link = new NativeLink();
  let disconnects = 0;
  link.onDisconnect(() => { disconnects++; });
  await link.open();
  host.__dsp_onState!(false);
  assert.equal(disconnects, 1);
  await link.close();
  assert.equal(disconnects, 1); // our own close does not count as a disconnect
});

test("onAttach fires when the shell opens the device on its own", async () => {
  installBridge({ connected: false });
  const attached: NativeLink[] = [];
  const stop = NativeLink.onAttach((link) => attached.push(link));
  host.__dsp_onState!(true);
  stop();
  host.__dsp_onState!(true);
  assert.equal(attached.length, 1);
});
